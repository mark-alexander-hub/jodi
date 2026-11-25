// Jodi: a private singles' corner for one wedding.
// One Cloudflare Worker: serves the pages in /public and the JSON API under /api.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, easy to read off a card
const DAY = 86_400_000;
const KEEP_DAYS = 3; // everything is deleted this many days after the wedding
const LIKE_LIMIT = 10;
const ROOM_GUEST_LIMIT = 500;
const ROOMS_PER_HOUR = 40; // a simple brake so nobody can flood the site with rooms
const MAX_BODY = 300_000;
const MAX_PHOTO = 200_000; // base64 characters, about 150 KB

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rooms (
     code TEXT PRIMARY KEY, title TEXT NOT NULL, wedding_date TEXT NOT NULL,
     host_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS guests (
     id TEXT PRIMARY KEY, room TEXT NOT NULL, token_hash TEXT NOT NULL,
     name TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL, seeking TEXT NOT NULL,
     side TEXT NOT NULL, wearing TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
     contact_kind TEXT NOT NULL, contact TEXT NOT NULL, photo TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS guests_room ON guests(room)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS guests_token ON guests(token_hash)`,
  `CREATE TABLE IF NOT EXISTS likes (
     room TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (from_id, to_id))`,
  `CREATE INDEX IF NOT EXISTS likes_to ON likes(to_id)`,
  `CREATE TABLE IF NOT EXISTS reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, from_id TEXT NOT NULL,
     about_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS reports_room ON reports(room)`,
];

// Every refusal has a short code. The pages translate the code; this English text is the fallback.
const MESSAGES = {
  too_big: "That is too big to send. Try a smaller photo.",
  bad_request: "Could not read that request.",
  name: "Please add your first name.",
  age: "You need to be 18 or older to join.",
  gender: "Please choose who you are.",
  seeking: "Please choose who you would like to meet.",
  side: "Please choose whose side you are on.",
  contact_kind: "Please choose how a match can reach you.",
  insta: "That Instagram name does not look right.",
  phone: "That phone number does not look right.",
  photo: "That photo could not be used. Please try another one.",
  agree: "Please confirm you are 18 or older and happy to join.",
  room_404: "We could not find that wedding. Check the link or scan the card again.",
  room_closed: "This wedding corner has closed and everything in it was deleted.",
  join_first: "Please join first.",
  profile_gone: "Your profile is no longer here. You can join again.",
  host_bad: "That host link is not valid for this wedding.",
  couple_names: "Please add the couple’s names.",
  date: "Please pick the wedding date.",
  date_past: "That date has already passed.",
  date_far: "Please pick a date within the next year.",
  flood: "A lot of rooms are being made right now. Please try again in a little while.",
  busy: "Could not create the room. Please try again.",
  full: "This wedding corner is full.",
  person_gone: "That person is no longer here.",
  no_photo: "No photo.",
  not_found: "Not found.",
  like_limit: "You have used all {n} likes. Take one back to like someone else.",
  server: "Something went wrong on our side. Please try again.",
};

class HttpError extends Error {
  constructor(status, code, vars) {
    super((MESSAGES[code] || code).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')));
    this.status = status;
    this.code = code;
    this.vars = vars;
  }
}
const fail = (code, status = 400, vars) => {
  throw new HttpError(status, code, vars);
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// The tables are created on first use, so a fresh deploy needs no setup step.
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const randomCode = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const sha256 = async (s) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

function bearer(req) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) fail('too_big', 413);
  try {
    const body = JSON.parse(text || '{}');
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  fail('bad_request');
}

const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function validateProfile(body, { partial = false } = {}) {
  const p = {};
  p.name = clean(body.name, 30);
  if (p.name.length < 1) fail('name');
  p.age = Number(body.age);
  if (!Number.isInteger(p.age) || p.age < 18 || p.age > 99) fail('age');
  p.gender = ['woman', 'man', 'other'].includes(body.gender) ? body.gender : fail('gender');
  p.seeking = ['women', 'men', 'everyone'].includes(body.seeking)
    ? body.seeking
    : fail('seeking');
  p.side = ['bride', 'groom', 'both'].includes(body.side) ? body.side : fail('side');
  p.wearing = clean(body.wearing, 60);
  p.about = clean(body.about, 160);
  p.contactKind = ['instagram', 'whatsapp'].includes(body.contactKind)
    ? body.contactKind
    : fail('contact_kind');
  if (p.contactKind === 'instagram') {
    p.contact = clean(body.contact, 40).replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(p.contact)) fail('insta');
  } else {
    const raw = clean(body.contact, 24);
    p.contact = (raw.startsWith('+') ? '+' : '') + raw.replace(/\D/g, '');
    if (!/^\+?\d{8,15}$/.test(p.contact)) fail('phone');
  }
  if (body.photo === undefined || body.photo === '') p.photo = undefined; // leave as it is
  else if (body.photo === null) p.photo = null; // remove
  else if (typeof body.photo === 'string' && body.photo.length <= MAX_PHOTO && /^\/9j\/[A-Za-z0-9+/]+=*$/.test(body.photo))
    p.photo = body.photo;
  else fail('photo');
  if (!partial && body.agree !== true) fail('agree');
  return p;
}

const accepts = (seeking, gender) =>
  seeking === 'everyone' || (seeking === 'women' && gender === 'woman') || (seeking === 'men' && gender === 'man');
const visible = (a, b) => accepts(a.seeking, b.gender) && accepts(b.seeking, a.gender);

const card = (g) => ({
  id: g.id,
  name: g.name,
  age: g.age,
  side: g.side,
  wearing: g.wearing,
  about: g.about,
  photo: g.has_photo ? g.updated_at : 0, // 0 = no photo, otherwise a version stamp
});

async function purgeRoom(db, code) {
  await db.batch([
    db.prepare('DELETE FROM likes WHERE room = ?').bind(code),
    db.prepare('DELETE FROM reports WHERE room = ?').bind(code),
    db.prepare('DELETE FROM guests WHERE room = ?').bind(code),
    db.prepare('DELETE FROM rooms WHERE code = ?').bind(code),
  ]);
}

async function purgeExpired(db) {
  const { results } = await db.prepare('SELECT code FROM rooms WHERE expires_at < ?').bind(Date.now()).all();
  for (const r of results) await purgeRoom(db, r.code);
  return results.length;
}

async function removeGuest(db, id) {
  await db.batch([
    db.prepare('DELETE FROM likes WHERE from_id = ?1 OR to_id = ?1').bind(id),
    db.prepare('DELETE FROM reports WHERE from_id = ?1 OR about_id = ?1').bind(id),
    db.prepare('DELETE FROM guests WHERE id = ?').bind(id),
  ]);
}

async function loadRoom(db, code) {
  const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();
  if (!room) fail('room_404', 404);
  if (room.expires_at < Date.now()) {
    await purgeRoom(db, code);
    fail('room_closed', 410);
  }
  return room;
}

async function loadGuest(req, db, room) {
  const token = bearer(req);
  if (!token) fail('join_first', 401);
  const me = await db
    .prepare(
      `SELECT id, room, name, age, gender, seeking, side, wearing, about, contact_kind, contact,
              (photo IS NOT NULL) AS has_photo, updated_at
       FROM guests WHERE token_hash = ? AND room = ?`,
    )
    .bind(await sha256(token), room.code)
    .first();
  if (!me) fail('profile_gone', 401);
  return me;
}

async function requireHost(req, room) {
  const key = bearer(req);
  if (!key || (await sha256(key)) !== room.host_hash) fail('host_bad', 403);
}

const meView = (g) => ({
  ...card(g),
  gender: g.gender,
  seeking: g.seeking,
  contactKind: g.contact_kind,
  contact: g.contact,
});

async function createRoom(req, db) {
  const body = await readBody(req);
  const title = clean(body.title, 60);
  if (title.length < 2) fail('couple_names');
  const date = String(body.date || '');
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
  if (Number.isNaN(when)) fail('date');
  const now = Date.now();
  if (when < now - 2 * DAY) fail('date_past');
  if (when > now + 400 * DAY) fail('date_far');

  await purgeExpired(db);
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE created_at > ?').bind(now - 3_600_000).first();
  if (recent.n >= ROOMS_PER_HOUR) fail('flood', 429);
  const hostKey = randomToken();
  const hostHash = await sha256(hostKey);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(8);
    const res = await db
      .prepare(
        'INSERT OR IGNORE INTO rooms (code, title, wedding_date, host_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(code, title, date, hostHash, now, when + (KEEP_DAYS + 1) * DAY)
      .run();
    if (res.meta.changes === 1) return json({ code, hostKey }, 201);
  }
  fail('busy', 503);
}

async function roomInfo(db, room) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM guests WHERE room = ?').bind(room.code).first();
  return json({
    code: room.code,
    title: room.title,
    date: room.wedding_date,
    closesAt: room.expires_at,
    joined: row.n,
    keepDays: KEEP_DAYS,
    likeLimit: LIKE_LIMIT,
  });
}

async function join(req, db, room) {
  const p = validateProfile(await readBody(req));
  const row = await db.prepare('SELECT COUNT(*) AS n FROM guests WHERE room = ?').bind(room.code).first();
  if (row.n >= ROOM_GUEST_LIMIT) fail('full', 409);
  const id = randomToken().slice(0, 16);
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO guests (id, room, token_hash, name, age, gender, seeking, side, wearing, about,
                           contact_kind, contact, photo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, room.code, await sha256(token), p.name, p.age, p.gender, p.seeking, p.side, p.wearing, p.about,
      p.contactKind, p.contact, p.photo ?? null, now, now)
    .run();
  return json({ id, token }, 201);
}

async function updateMe(req, db, me) {
  const p = validateProfile(await readBody(req), { partial: true });
  const now = Date.now();
  const base = [p.name, p.age, p.gender, p.seeking, p.side, p.wearing, p.about, p.contactKind, p.contact, now];
  const set = 'name=?, age=?, gender=?, seeking=?, side=?, wearing=?, about=?, contact_kind=?, contact=?, updated_at=?';
  if (p.photo === undefined) {
    await db.prepare(`UPDATE guests SET ${set} WHERE id = ?`).bind(...base, me.id).run();
  } else {
    await db.prepare(`UPDATE guests SET ${set}, photo=? WHERE id = ?`).bind(...base, p.photo, me.id).run();
  }
  return json({ ok: true });
}

async function listPeople(db, room, me) {
  const [guests, mine, theirs, blocks] = await db.batch([
    db
      .prepare(
        `SELECT id, name, age, gender, seeking, side, wearing, about, contact_kind, contact,
                (photo IS NOT NULL) AS has_photo, updated_at
         FROM guests WHERE room = ? AND id != ? ORDER BY created_at DESC`,
      )
      .bind(room.code, me.id),
    db.prepare('SELECT to_id AS id FROM likes WHERE from_id = ?').bind(me.id),
    db.prepare('SELECT from_id AS id FROM likes WHERE to_id = ?').bind(me.id),
    db.prepare('SELECT from_id, about_id FROM reports WHERE from_id = ?1 OR about_id = ?1').bind(me.id),
  ]);
  const iLike = new Set(mine.results.map((r) => r.id));
  const likesMe = new Set(theirs.results.map((r) => r.id));
  const hidden = new Set(blocks.results.map((r) => (r.from_id === me.id ? r.about_id : r.from_id)));

  const people = [];
  const matches = [];
  for (const g of guests.results) {
    if (hidden.has(g.id)) continue;
    if (iLike.has(g.id) && likesMe.has(g.id)) {
      matches.push({ ...card(g), contactKind: g.contact_kind, contact: g.contact });
    } else if (visible(me, g)) {
      // Never say whether they liked me: that only shows once it is mutual.
      people.push({ ...card(g), liked: iLike.has(g.id) });
    }
  }
  return json({ me: meView(me), people, matches, likesLeft: Math.max(0, LIKE_LIMIT - iLike.size) });
}

async function isHidden(db, a, b) {
  const row = await db
    .prepare('SELECT 1 AS x FROM reports WHERE (from_id = ?1 AND about_id = ?2) OR (from_id = ?2 AND about_id = ?1) LIMIT 1')
    .bind(a, b)
    .first();
  return !!row;
}

async function loadTarget(db, room, me, id) {
  const g = await db
    .prepare(
      `SELECT id, name, age, gender, seeking, side, wearing, about, contact_kind, contact,
              (photo IS NOT NULL) AS has_photo, updated_at
       FROM guests WHERE id = ? AND room = ?`,
    )
    .bind(String(id || ''), room.code)
    .first();
  if (!g || g.id === me.id || !visible(me, g) || (await isHidden(db, me.id, g.id)))
    fail('person_gone', 404);
  return g;
}

async function like(req, db, room, me) {
  const body = await readBody(req);
  const target = await loadTarget(db, room, me, body.to);
  const [already, count] = await db.batch([
    db.prepare('SELECT 1 AS x FROM likes WHERE from_id = ? AND to_id = ?').bind(me.id, target.id),
    db.prepare('SELECT COUNT(*) AS n FROM likes WHERE from_id = ?').bind(me.id),
  ]);
  let used = count.results[0].n;
  if (!already.results.length) {
    if (used >= LIKE_LIMIT)
      fail('like_limit', 409, { n: LIKE_LIMIT });
    await db
      .prepare('INSERT OR IGNORE INTO likes (room, from_id, to_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(room.code, me.id, target.id, Date.now())
      .run();
    used++;
  }
  const back = await db.prepare('SELECT 1 AS x FROM likes WHERE from_id = ? AND to_id = ?').bind(target.id, me.id).first();
  return json({
    match: !!back,
    person: back ? { ...card(target), contactKind: target.contact_kind, contact: target.contact } : undefined,
    likesLeft: Math.max(0, LIKE_LIMIT - used),
  });
}

async function unlike(db, me, id) {
  await db.prepare('DELETE FROM likes WHERE from_id = ? AND to_id = ?').bind(me.id, String(id || '')).run();
  return json({ ok: true });
}

async function report(req, db, room, me) {
  const body = await readBody(req);
  const target = await db.prepare('SELECT id FROM guests WHERE id = ? AND room = ?').bind(String(body.about || ''), room.code).first();
  if (!target || target.id === me.id) fail('person_gone', 404);
  await db.batch([
    db
      .prepare('INSERT INTO reports (room, from_id, about_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(room.code, me.id, target.id, clean(body.reason, 200), Date.now()),
    db
      .prepare('DELETE FROM likes WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)')
      .bind(me.id, target.id),
  ]);
  return json({ ok: true });
}

async function photo(req, db, room, id) {
  const key = bearer(req);
  const isHost = key && (await sha256(key)) === room.host_hash;
  if (!isHost) {
    const me = await loadGuest(req, db, room);
    if (me.id !== id) {
      const g = await db.prepare('SELECT id, gender, seeking FROM guests WHERE id = ? AND room = ?').bind(id, room.code).first();
      if (!g || !visible(me, g) || (await isHidden(db, me.id, id))) fail('no_photo', 404);
    }
  }
  const row = await db.prepare('SELECT photo FROM guests WHERE id = ? AND room = ?').bind(id, room.code).first();
  if (!row || !row.photo) fail('no_photo', 404);
  const bytes = Uint8Array.from(atob(row.photo), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' },
  });
}

async function hostView(db, room) {
  const [guests, reports, matches] = await db.batch([
    db
      .prepare('SELECT id, name, age, side, created_at, (photo IS NOT NULL) AS has_photo, updated_at FROM guests WHERE room = ? ORDER BY created_at DESC')
      .bind(room.code),
    db.prepare('SELECT about_id, reason FROM reports WHERE room = ?').bind(room.code),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM likes a JOIN likes b ON a.from_id = b.to_id AND a.to_id = b.from_id
         WHERE a.room = ? AND a.from_id < a.to_id`,
      )
      .bind(room.code),
  ]);
  const flagged = new Map();
  for (const r of reports.results) {
    if (!flagged.has(r.about_id)) flagged.set(r.about_id, []);
    flagged.get(r.about_id).push(r.reason);
  }
  // The couple sees who joined so they can remove gatecrashers. They never see likes or who matched whom.
  return json({
    code: room.code,
    title: room.title,
    date: room.wedding_date,
    closesAt: room.expires_at,
    keepDays: KEEP_DAYS,
    matches: matches.results[0].n,
    guests: guests.results.map((g) => ({
      id: g.id,
      name: g.name,
      age: g.age,
      side: g.side,
      joinedAt: g.created_at,
      photo: g.has_photo ? g.updated_at : 0,
      reports: flagged.get(g.id) || [],
    })),
  });
}

async function route(req, env, url) {
  const db = env.DB;
  const m = req.method;
  const parts = url.pathname.split('/').filter(Boolean); // api, rooms, CODE, ...
  if (parts[1] !== 'rooms') fail('not_found', 404);
  if (parts.length === 2) return m === 'POST' ? createRoom(req, db) : fail('not_found', 404);

  const code = parts[2].toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) fail('room_404', 404);
  const room = await loadRoom(db, code);
  const [a = '', b = '', c = ''] = parts.slice(3);

  if (a === '' && m === 'GET') return roomInfo(db, room);
  if (a === 'join' && m === 'POST') return join(req, db, room);
  if (a === 'photo' && m === 'GET') return photo(req, db, room, b);

  if (a === 'host') {
    await requireHost(req, room);
    if (b === '' && m === 'GET') return hostView(db, room);
    if (b === '' && m === 'DELETE') {
      await purgeRoom(db, room.code);
      return json({ ok: true });
    }
    if (b === 'guest' && c && m === 'DELETE') {
      const g = await db.prepare('SELECT id FROM guests WHERE id = ? AND room = ?').bind(c, room.code).first();
      if (g) await removeGuest(db, g.id);
      return json({ ok: true });
    }
    fail('not_found', 404);
  }

  const me = await loadGuest(req, db, room);
  if (a === 'me' && m === 'GET') return json({ me: meView(me) });
  if (a === 'me' && m === 'PUT') return updateMe(req, db, me);
  if (a === 'me' && m === 'DELETE') {
    await removeGuest(db, me.id);
    return json({ ok: true });
  }
  if (a === 'people' && m === 'GET') return listPeople(db, room, me);
  if (a === 'like' && m === 'POST') return like(req, db, room, me);
  if (a === 'like' && b && m === 'DELETE') return unlike(db, me, b);
  if (a === 'report' && m === 'POST') return report(req, db, room, me);
  fail('not_found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      await ensureSchema(env.DB);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code, vars: e.vars }, e.status);
      console.error(e);
      return json({ error: MESSAGES.server, code: 'server' }, 500);
    }
  },

  // Daily sweep so closed weddings are deleted even if nobody visits them again.
  async scheduled(event, env) {
    await ensureSchema(env.DB);
    await purgeExpired(env.DB);
  },
};
