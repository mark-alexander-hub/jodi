// End-to-end check of the API. Start the app first (npm run dev), then: npm test
// Optional: BASE=https://your-site.example npm test
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let passed = 0;

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, type };
}

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log('  ok  ' + name);
    })
    .catch((e) => {
      console.error('FAIL  ' + name + '\n      ' + e.message);
      process.exitCode = 1;
    });
}

const today = new Date().toISOString().slice(0, 10);
const person = (over) => ({
  name: 'Test',
  age: 27,
  gender: 'woman',
  seeking: 'men',
  side: 'bride',
  wearing: 'green saree',
  about: 'Here for the biryani',
  contactKind: 'instagram',
  contact: '@test.person',
  agree: true,
  ...over,
});
// Smallest valid JPEG header in base64 is enough for the server-side check.
const tinyJpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

let room, hostKey, asha, ravi, kiran, uncle;

await check('create a room', async () => {
  const r = await call('/rooms', { method: 'POST', body: { title: 'Asha & Rahul', date: today } });
  assert.equal(r.status, 201);
  assert.match(r.data.code, /^[A-Z0-9]{8}$/);
  room = r.data.code;
  hostKey = r.data.hostKey;
});

await check('reject a room with no names or a past date', async () => {
  assert.equal((await call('/rooms', { method: 'POST', body: { title: '', date: today } })).status, 400);
  assert.equal((await call('/rooms', { method: 'POST', body: { title: 'Old', date: '2020-01-01' } })).status, 400);
});

await check('room info is public but shows no people', async () => {
  const r = await call(`/rooms/${room}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.title, 'Asha & Rahul');
  assert.equal(r.data.joined, 0);
  assert.equal(r.data.guests, undefined);
});

await check('unknown room is a 404', async () => {
  assert.equal((await call('/rooms/ZZZZZZZZ')).status, 404);
});

await check('join needs 18+, consent and a valid contact', async () => {
  assert.equal((await call(`/rooms/${room}/join`, { method: 'POST', body: person({ age: 17 }) })).status, 400);
  assert.equal((await call(`/rooms/${room}/join`, { method: 'POST', body: person({ agree: false }) })).status, 400);
  assert.equal((await call(`/rooms/${room}/join`, { method: 'POST', body: person({ contact: 'bad name!' }) })).status, 400);
  assert.equal((await call(`/rooms/${room}/join`, { method: 'POST', body: person({ photo: 'not-a-photo' }) })).status, 400);
});

await check('four guests join', async () => {
  const j = async (over) => {
    const r = await call(`/rooms/${room}/join`, { method: 'POST', body: person(over) });
    assert.equal(r.status, 201);
    return r.data;
  };
  asha = await j({ name: 'Asha', photo: tinyJpeg });
  ravi = await j({ name: 'Ravi', gender: 'man', seeking: 'women', side: 'groom', contactKind: 'whatsapp', contact: '+91 98765 43210' });
  kiran = await j({ name: 'Kiran', gender: 'man', seeking: 'men', side: 'both' });
  uncle = await j({ name: 'Uncle', gender: 'man', seeking: 'women', side: 'groom', age: 52 });
});

await check('people list needs a profile', async () => {
  assert.equal((await call(`/rooms/${room}/people`)).status, 401);
  assert.equal((await call(`/rooms/${room}/people`, { token: 'wrong' })).status, 401);
});

await check('you only see people whose preference matches yours', async () => {
  const a = await call(`/rooms/${room}/people`, { token: asha.token });
  assert.deepEqual(a.data.people.map((p) => p.name).sort(), ['Ravi', 'Uncle']);
  const k = await call(`/rooms/${room}/people`, { token: kiran.token });
  assert.equal(k.data.people.length, 0);
});

await check('the list never carries contact details, gender or preference', async () => {
  const a = await call(`/rooms/${room}/people`, { token: asha.token });
  for (const p of a.data.people) {
    assert.equal(p.contact, undefined);
    assert.equal(p.contactKind, undefined);
    assert.equal(p.gender, undefined);
    assert.equal(p.seeking, undefined);
  }
  assert.equal(a.data.me.contact, 'test.person');
});

await check('a one-way like stays secret', async () => {
  const r = await call(`/rooms/${room}/like`, { method: 'POST', token: ravi.token, body: { to: asha.id } });
  assert.equal(r.status, 200);
  assert.equal(r.data.match, false);
  assert.equal(r.data.person, undefined);
  const a = await call(`/rooms/${room}/people`, { token: asha.token });
  assert.equal(a.data.matches.length, 0);
  const raviCard = a.data.people.find((p) => p.name === 'Ravi');
  assert.equal(raviCard.liked, false);
  assert.equal(Object.keys(raviCard).some((k) => /likes?me|likedby/i.test(k)), false);
});

await check('liking someone outside your preference is refused', async () => {
  const r = await call(`/rooms/${room}/like`, { method: 'POST', token: kiran.token, body: { to: asha.id } });
  assert.equal(r.status, 404);
});

await check('a mutual like is a match and shares contact both ways', async () => {
  const r = await call(`/rooms/${room}/like`, { method: 'POST', token: asha.token, body: { to: ravi.id } });
  assert.equal(r.data.match, true);
  assert.equal(r.data.person.contactKind, 'whatsapp');
  assert.equal(r.data.person.contact, '+919876543210');
  const rv = await call(`/rooms/${room}/people`, { token: ravi.token });
  assert.equal(rv.data.matches.length, 1);
  assert.equal(rv.data.matches[0].contact, 'test.person');
  assert.equal(rv.data.people.some((p) => p.name === 'Asha'), false);
});

await check('photos are only served to people who can see you', async () => {
  const yes = await call(`/rooms/${room}/photo/${asha.id}`, { token: ravi.token });
  assert.equal(yes.status, 200);
  assert.equal(yes.type, 'image/jpeg');
  assert.equal((await call(`/rooms/${room}/photo/${asha.id}`, { token: kiran.token })).status, 404);
  assert.equal((await call(`/rooms/${room}/photo/${asha.id}`)).status, 401);
});

await check('taking a like back removes the match', async () => {
  await call(`/rooms/${room}/like/${ravi.id}`, { method: 'DELETE', token: asha.token });
  const rv = await call(`/rooms/${room}/people`, { token: ravi.token });
  assert.equal(rv.data.matches.length, 0);
  await call(`/rooms/${room}/like`, { method: 'POST', token: asha.token, body: { to: ravi.id } });
});

await check('reporting someone hides you from each other', async () => {
  const r = await call(`/rooms/${room}/report`, { method: 'POST', token: asha.token, body: { about: uncle.id, reason: 'not single' } });
  assert.equal(r.status, 200);
  const a = await call(`/rooms/${room}/people`, { token: asha.token });
  assert.equal(a.data.people.some((p) => p.name === 'Uncle'), false);
  const u = await call(`/rooms/${room}/people`, { token: uncle.token });
  assert.equal(u.data.people.some((p) => p.name === 'Asha'), false);
  assert.equal((await call(`/rooms/${room}/like`, { method: 'POST', token: uncle.token, body: { to: asha.id } })).status, 404);
});

await check('editing a profile keeps the photo unless it is removed', async () => {
  const r = await call(`/rooms/${room}/me`, { method: 'PUT', token: asha.token, body: person({ name: 'Asha K', wearing: 'red lehenga' }) });
  assert.equal(r.status, 200);
  let me = (await call(`/rooms/${room}/me`, { token: asha.token })).data.me;
  assert.equal(me.name, 'Asha K');
  assert.ok(me.photo > 0);
  await call(`/rooms/${room}/me`, { method: 'PUT', token: asha.token, body: person({ name: 'Asha K', photo: null }) });
  me = (await call(`/rooms/${room}/me`, { token: asha.token })).data.me;
  assert.equal(me.photo, 0);
});

await check('the host link is needed for the host page', async () => {
  assert.equal((await call(`/rooms/${room}/host`)).status, 403);
  assert.equal((await call(`/rooms/${room}/host`, { token: asha.token })).status, 403);
});

await check('the host sees who joined and reports, never who liked whom', async () => {
  const h = await call(`/rooms/${room}/host`, { token: hostKey });
  assert.equal(h.status, 200);
  assert.equal(h.data.guests.length, 4);
  assert.equal(h.data.matches, 1);
  assert.deepEqual(h.data.guests.find((g) => g.name === 'Uncle').reports, ['not single']);
  const text = JSON.stringify(h.data);
  assert.equal(/test\.person|9876543210|likes/i.test(text), false);
});

await check('the host can remove a guest', async () => {
  await call(`/rooms/${room}/host/guest/${uncle.id}`, { method: 'DELETE', token: hostKey });
  assert.equal((await call(`/rooms/${room}/people`, { token: uncle.token })).status, 401);
});

await check('the like limit holds', async () => {
  const r2 = (await call('/rooms', { method: 'POST', body: { title: 'Limit test', date: today } })).data;
  const me = (await call(`/rooms/${r2.code}/join`, { method: 'POST', body: person({ name: 'Picker' }) })).data;
  const others = [];
  for (let i = 0; i < 11; i++)
    others.push((await call(`/rooms/${r2.code}/join`, { method: 'POST', body: person({ name: 'M' + i, gender: 'man', seeking: 'women' }) })).data);
  let last;
  for (const o of others) last = await call(`/rooms/${r2.code}/like`, { method: 'POST', token: me.token, body: { to: o.id } });
  assert.equal(last.status, 409);
  const list = await call(`/rooms/${r2.code}/people`, { token: me.token });
  assert.equal(list.data.likesLeft, 0);
  assert.equal((await call(`/rooms/${r2.code}/host`, { method: 'DELETE', token: r2.hostKey })).status, 200);
});

await check('a guest can delete their own profile', async () => {
  assert.equal((await call(`/rooms/${room}/me`, { method: 'DELETE', token: kiran.token })).status, 200);
  assert.equal((await call(`/rooms/${room}/me`, { token: kiran.token })).status, 401);
});

await check('closing the room deletes everything', async () => {
  assert.equal((await call(`/rooms/${room}/host`, { method: 'DELETE', token: hostKey })).status, 200);
  assert.equal((await call(`/rooms/${room}`)).status, 404);
  assert.equal((await call(`/rooms/${room}/people`, { token: asha.token })).status, 404);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
