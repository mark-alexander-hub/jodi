// The guest's side: join, look around, like, and see matches.
import { $, el, icon, api, toast, sideLabel, store, coupleTitle, firstLetter, dayAndMonth, t } from './common.js';

const code = (new URLSearchParams(location.search).get('w') || '').toUpperCase();
const KEY = 'jodi:guest:' + code;
const SEEN = 'jodi:seen:' + code;
const view = $('#view');
const tabs = $('#tabs');
const sheet = $('#sheet');
const matchDlg = $('#matchDlg');

let room = null;
let token = store.get(KEY);
let state = { me: null, people: [], matches: [], likesLeft: 0 };
let tab = 'people';
let lastDrawn = '';

const call = (path, opts = {}) => api(`/rooms/${code}${path}`, { ...opts, token });

/* ---------- photos ---------- */
const photoCache = new Map();
function loadPhoto(p) {
  const k = p.id + ':' + p.photo;
  if (!photoCache.has(k)) {
    photoCache.set(
      k,
      fetch(`/api/rooms/${code}/photo/${p.id}`, { headers: { authorization: 'Bearer ' + token } })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? URL.createObjectURL(b) : null))
        .catch(() => null),
    );
  }
  return photoCache.get(k);
}

function thumb(p) {
  const box = el('div', { class: `thumb s-${p.side}` }, el('span', { class: 'initial', text: firstLetter(p.name) }));
  if (p.photo) {
    loadPhoto(p).then((url) => {
      if (url) box.replaceChildren(el('img', { src: url, alt: '' }));
    });
  }
  return box;
}

// Crop to a 4:5 portrait and squeeze to a small JPEG before it leaves the phone.
async function shrink(file) {
  let src = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!src) {
    src = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
  }
  const W = 480;
  const H = 600;
  const scale = Math.max(W / src.width, H / src.height);
  const cw = W / scale;
  const ch = H / scale;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d').drawImage(src, (src.width - cw) / 2, (src.height - ch) * 0.35, cw, ch, 0, 0, W, H);
  let q = 0.8;
  let data;
  do {
    data = c.toDataURL('image/jpeg', q).split(',')[1];
    q -= 0.1;
  } while (data.length > 180_000 && q > 0.3);
  return data;
}

/* ---------- shared pieces ---------- */
// A small drawing kept in the page as <symbol id="art-name">.
function art(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'art');
  s.setAttribute('viewBox', '0 0 160 112');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', '#art-' + name);
  s.append(u);
  return s;
}

const masthead = () =>
  el('header', { class: 'masthead' }, el('p', { class: 'kicker', text: t('room.kicker') }), el('h1', null, coupleTitle(room.title)));

const smallHead = (title) => el('header', { class: 'stack' }, el('p', { class: 'kicker', text: room.title }), el('h2', { text: title }));

function promises() {
  const item = (ico, head, text) => el('li', null, icon(ico), el('div', null, el('b', { text: head }), el('span', { text })));
  return el(
    'ul',
    { class: 'promise' },
    item('eye', t('pr.see.h'), t('pr.see.p')),
    item('lock', t('pr.hide.h'), t('pr.hide.p')),
    item('clock', t('pr.gone.h', { date: dayAndMonth(room.closesAt) }), t('pr.gone.p')),
  );
}

function howTo() {
  const step = (head, text) => el('li', null, el('b', { text: head }), el('span', { text }));
  return el(
    'ol',
    { class: 'steps' },
    step(t('how.1h'), t('how.1p')),
    step(t('how.2h'), t('how.2p', { n: room.likeLimit })),
    step(t('how.3h'), t('how.3p')),
    step(t('how.4h'), t('how.4p')),
  );
}

function problem(message, hint, retry) {
  tabs.hidden = true;
  document.body.classList.remove('has-tabs');
  view.replaceChildren(
    el(
      'div',
      { class: 'paper center stack' },
      el('h2', { text: message }),
      hint && el('p', { class: 'muted', text: hint }),
      retry && el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, t('try')),
    ),
  );
}

/* ---------- welcome ---------- */
function showWelcome() {
  tabs.hidden = true;
  document.body.classList.remove('has-tabs');
  view.replaceChildren(
    masthead(),
    el(
      'div',
      { class: 'stack' },
      el('p', { class: 'lede center', text: t('w.lede') }),
      room.joined >= 3 && el('p', { class: 'count', text: t('w.count', { n: room.joined }) }),
      el('button', { class: 'btn', type: 'button', id: 'joinStart', onclick: () => showForm(null) }, t('w.join')),
      el('div', { class: 'paper henna' }, promises()),
      el('p', { class: 'muted center', text: t('w.not') }),
    ),
  );
  scrollTo(0, 0);
}

/* ---------- join / edit form ---------- */
function showForm(me) {
  tabs.hidden = true;
  document.body.classList.remove('has-tabs');
  let photoData; // undefined = unchanged, null = remove, string = new photo

  const text = (id, label, opts = {}, hint) =>
    el(
      'div',
      { class: 'field' },
      el('label', { for: id }, label, hint && el('span', { class: 'hint', text: hint })),
      el(opts.area ? 'textarea' : 'input', { id, name: id, type: opts.area ? null : opts.type || 'text', ...opts.attrs, value: opts.value ?? '' }),
    );
  const pick = (name, legend, options, current, hint) =>
    el(
      'fieldset',
      null,
      el('legend', null, legend, hint && el('span', { class: 'hint', text: hint })),
      el(
        'div',
        { class: 'choices' },
        options.map(([v, l]) => el('label', null, el('input', { type: 'radio', name, value: v, checked: current === v }), el('span', { text: l }))),
      ),
    );

  const preview = el('div', { class: 'thumb s-bride' }, me && me.photo ? null : icon('camera'));
  if (me && me.photo) loadPhoto(me).then((url) => url && preview.replaceChildren(el('img', { src: url, alt: '' })));
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const removeBtn = el('button', { class: 'linkish', type: 'button', hidden: !(me && me.photo) }, t('f.remove'));
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      photoData = await shrink(f);
      preview.replaceChildren(el('img', { src: 'data:image/jpeg;base64,' + photoData, alt: '' }));
      removeBtn.hidden = false;
    } catch {
      toast(t('f.photoBad'));
    }
  });
  removeBtn.addEventListener('click', () => {
    photoData = null;
    fileInput.value = '';
    preview.replaceChildren(icon('camera'));
    removeBtn.hidden = true;
  });

  const contactInput = el('input', { id: 'contact', name: 'contact', type: 'text', maxlength: 40, autocomplete: 'off', autocapitalize: 'none', value: me ? me.contact : '' });
  const contactLabel = el('label', { for: 'contact' });
  const setContactLabel = (kind) => {
    contactLabel.textContent = t(kind === 'whatsapp' ? 'f.wa' : 'f.insta');
    contactInput.placeholder = kind === 'whatsapp' ? '+91 98765 43210' : '@yourname';
    contactInput.inputMode = kind === 'whatsapp' ? 'tel' : 'text';
  };
  setContactLabel(me ? me.contactKind : 'instagram');

  const error = el('p', { class: 'error', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit' }, t(me ? 'f.save' : 'f.joinBtn'));

  const form = el(
    'form',
    { class: 'paper', novalidate: true },
    text('name', t('f.name'), { attrs: { maxlength: 30, autocomplete: 'given-name' }, value: me?.name }),
    text('age', t('f.age'), { type: 'number', attrs: { min: 18, max: 99, inputmode: 'numeric' }, value: me?.age }, t('f.ageHint')),
    pick('gender', t('f.gender'), [['woman', t('g.woman')], ['man', t('g.man')], ['other', t('g.other')]], me?.gender),
    pick('seeking', t('f.seeking'), [['men', t('s.men')], ['women', t('s.women')], ['everyone', t('s.everyone')]], me?.seeking, t('f.seekHint')),
    pick('side', t('f.side'), [['bride', t('sd.bride')], ['groom', t('sd.groom')], ['both', t('sd.both')]], me?.side),
    text('wearing', t('f.wear'), { attrs: { maxlength: 60, placeholder: t('f.wearPh') }, value: me?.wearing }, t('f.wearHint')),
    text('about', t('f.about'), { area: true, attrs: { maxlength: 160, placeholder: t('f.aboutPh') }, value: me?.about }, t('f.optional')),
    el(
      'div',
      { class: 'field' },
      el('label', null, t('f.photo'), el('span', { class: 'hint', text: t('f.photoHint') })),
      el(
        'div',
        { class: 'photo-pick' },
        preview,
        el('div', null, el('button', { class: 'btn small ghost', type: 'button', onclick: () => fileInput.click() }, t('f.choose')), el('div', null, removeBtn)),
        fileInput,
      ),
    ),
    pick('contactKind', t('f.contact'), [['instagram', 'Instagram'], ['whatsapp', 'WhatsApp']], me ? me.contactKind : 'instagram', t('f.contactHint')),
    el('div', { class: 'field' }, contactLabel, contactInput),
    !me && el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'agree' }), el('span', { text: t('f.agree') })),
    error,
    el('div', { class: 'field' }, submit),
    el('div', { class: 'center' }, el('button', { class: 'linkish', type: 'button', onclick: () => (me ? showMain() : showWelcome()) }, t('f.back'))),
  );
  form.addEventListener('change', (e) => {
    if (e.target.name === 'contactKind') setContactLabel(e.target.value);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const f = new FormData(form);
    const body = {
      name: f.get('name'),
      age: Number(f.get('age')),
      gender: f.get('gender'),
      seeking: f.get('seeking'),
      side: f.get('side'),
      wearing: f.get('wearing'),
      about: f.get('about'),
      contactKind: f.get('contactKind'),
      contact: f.get('contact'),
      photo: photoData,
      agree: me ? undefined : f.get('agree') === 'on',
    };
    submit.disabled = true;
    try {
      if (me) {
        await call('/me', { method: 'PUT', body });
      } else {
        const r = await call('/join', { method: 'POST', body });
        token = r.token;
        store.set(KEY, token);
      }
      await refresh();
      tab = me ? 'me' : 'people';
      showMain();
      toast(t(me ? 't.saved' : 't.in'));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  view.replaceChildren(smallHead(t(me ? 'f.h.edit' : 'f.h.new')), form);
  scrollTo(0, 0);
}

/* ---------- main ---------- */
async function refresh() {
  state = await call('/people');
  // Anyone new under "Jodis" since we last looked gets the celebration once.
  let seen = [];
  try {
    seen = JSON.parse(store.get(SEEN) || '[]');
  } catch {}
  const fresh = state.matches.filter((m) => !seen.includes(m.id));
  if (fresh.length) {
    store.set(SEEN, JSON.stringify([...seen, ...fresh.map((m) => m.id)]));
    if (!matchDlg.open) celebrate(fresh[0]);
  }
}

function showMain() {
  tabs.hidden = false;
  document.body.classList.add('has-tabs');
  lastDrawn = '';
  draw();
  scrollTo(0, 0);
}

function draw() {
  const stamp = tab + JSON.stringify(state);
  if (stamp === lastDrawn) return; // nothing changed, so do not replay the animations
  lastDrawn = stamp;
  for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'true' : 'false');
  const badge = $('#badge');
  badge.hidden = !state.matches.length;
  badge.textContent = state.matches.length;
  if (tab === 'people') drawPeople();
  else if (tab === 'matches') drawMatches();
  else drawMe();
}

const who = (p) => [p.name, ' ', el('small', { class: 'muted', text: p.age })];

function drawPeople() {
  const n = state.people.length;
  view.replaceChildren(
    masthead(),
    n ? el('p', { class: 'count', text: t('p.count', { n, l: state.likesLeft }) }) : null,
    n
      ? el(
          'div',
          { class: 'prints' },
          state.people.map((p) =>
            el(
              'button',
              { class: 'print', type: 'button', onclick: () => openPerson(p), 'aria-label': `${p.name}, ${p.age}, ${sideLabel(p.side)}${p.liked ? ', ' + t('p.liked') : ''}` },
              p.liked && el('span', { class: 'liked' }, icon('heart')),
              thumb(p),
              el('div', { class: 'who' }, p.name, ' ', el('small', { text: p.age })),
              p.wearing && el('div', { class: 'wear', text: p.wearing }),
              el('span', { class: `tag s-${p.side}`, text: sideLabel(p.side) }),
            ),
          ),
        )
      : el(
          'div',
          { class: 'paper empty stack' },
          art('chai'),
          el('h2', { text: t('p.early.h') }),
          el('p', { class: 'muted', text: t('p.early.p') }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => refresh().then(draw).catch((e) => toast(e.message)) }, t('p.again')),
        ),
  );
}

function reach(p) {
  const insta = p.contactKind === 'instagram';
  const href = insta ? 'https://instagram.com/' + encodeURIComponent(p.contact) : 'https://wa.me/' + p.contact.replace(/\D/g, '');
  return el(
    'div',
    { class: 'reach' },
    el('p', { class: 'contact', text: insta ? '@' + p.contact : p.contact }),
    el('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer' }, t(insta ? 'm.insta' : 'm.wa')),
  );
}

const summary = (p) =>
  el(
    'div',
    { class: 'match-row' },
    thumb(p),
    el('div', null, el('h3', null, who(p)), el('span', { class: `tag s-${p.side}`, text: sideLabel(p.side) }), p.wearing && el('div', { class: 'muted', text: t('wearing', { x: p.wearing }) })),
  );

function drawMatches() {
  view.replaceChildren(
    smallHead(t('j.h')),
    state.matches.length
      ? el('div', { class: 'stack' }, state.matches.map((m) => el('div', { class: 'paper' }, summary(m), reach(m))))
      : el(
          'div',
          { class: 'paper empty stack' },
          art('chai'),
          el('h2', { text: t('j.none.h') }),
          el('p', { class: 'muted', text: t('j.none.p') }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => setTab('people') }, t('j.see')),
        ),
  );
}

function drawMe() {
  const me = state.me;
  view.replaceChildren(
    smallHead(t('me.h')),
    el(
      'div',
      { class: 'paper' },
      summary(me),
      me.about && el('p', { text: me.about }),
      el('p', { class: 'muted', text: t(me.contactKind === 'instagram' ? 'me.reach.insta' : 'me.reach.wa', { c: me.contact }) }),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => showForm(me) }, t('me.change')),
    ),
    el('section', { class: 'stack' }, el('h2', { text: t('howto') }), howTo()),
    el('div', { class: 'paper' }, promises()),
    el(
      'div',
      { class: 'stack center' },
      el('button', { class: 'btn danger', type: 'button', onclick: leave }, t('me.delete')),
      el('p', { class: 'muted', text: t('me.deleteNote') }),
    ),
  );
}

async function leave() {
  if (!confirm(t('me.confirm'))) return;
  try {
    await call('/me', { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 401) return toast(e.message);
  }
  token = null;
  store.del(KEY);
  store.del(SEEN);
  room = await api('/rooms/' + code).catch(() => room);
  showWelcome();
  toast(t('t.deleted'));
}

function setTab(next) {
  tab = next;
  draw();
  scrollTo(0, 0);
}
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});

/* ---------- a person's sheet ---------- */
function openPerson(p) {
  const likeBtn = el('button', { class: 'btn', type: 'button', id: 'likeBtn' });
  const paint = () => {
    likeBtn.replaceChildren(icon('heart'), p.liked ? t('s.liked') : t('s.like', { name: p.name }));
    likeBtn.classList.toggle('ghost', !!p.liked);
  };
  paint();
  likeBtn.addEventListener('click', async () => {
    likeBtn.disabled = true;
    try {
      if (p.liked) {
        await call('/like/' + p.id, { method: 'DELETE' });
        p.liked = false;
        state.likesLeft++;
      } else {
        const r = await call('/like', { method: 'POST', body: { to: p.id } });
        state.likesLeft = r.likesLeft;
        if (r.match) {
          sheet.close();
          await refresh();
          draw();
          return;
        }
        p.liked = true;
        toast(t('t.liked'));
      }
      paint();
      draw();
    } catch (e) {
      toast(e.message);
    }
    likeBtn.disabled = false;
  });

  const reportBox = el('div', { class: 'stack', hidden: true });
  const reason = el('textarea', { maxlength: 200, placeholder: t('s.reasonPh'), 'aria-label': t('s.reasonPh') });
  reportBox.append(
    el('p', { class: 'muted', text: t('s.offNote', { name: p.name }) }),
    reason,
    el(
      'button',
      {
        class: 'btn danger',
        type: 'button',
        onclick: async () => {
          try {
            await call('/report', { method: 'POST', body: { about: p.id, reason: reason.value } });
            sheet.close();
            await refresh();
            draw();
            toast(t('t.hidden', { name: p.name }));
          } catch (e) {
            toast(e.message);
          }
        },
      },
      t('s.hide'),
    ),
  );

  sheet.replaceChildren(
    el('button', { class: 'close-x', type: 'button', 'aria-label': t('close'), onclick: () => sheet.close() }, icon('x')),
    el(
      'div',
      { class: 'sheet' },
      thumb(p),
      el('h2', { class: 'who' }, p.name, ' ', el('small', { text: p.age })),
      el('span', { class: `tag s-${p.side}`, text: sideLabel(p.side) }),
      p.wearing && el('p', null, el('b', { text: t('s.wearing') }), p.wearing),
      p.about && el('p', { class: 'about', text: p.about }),
      el('div', { class: 'row' }, likeBtn),
      el('p', { class: 'center' }, el('button', { class: 'linkish', type: 'button', onclick: () => (reportBox.hidden = !reportBox.hidden) }, t('s.off'))),
      reportBox,
    ),
  );
  sheet.showModal();
}
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sheet.close(); // tap outside
});

/* ---------- the match moment ---------- */
function celebrate(p) {
  const petals = Array.from({ length: 22 }, (_, i) => {
    const s = el('span', { class: 'petal' });
    s.style.left = ((i * 37) % 100) + '%';
    s.style.animationDelay = ((i * 0.13) % 1.6).toFixed(2) + 's';
    return s;
  });
  matchDlg.replaceChildren(
    el(
      'div',
      { class: 'match' },
      petals,
      el('p', { class: 'kicker', text: t('x.kicker') }),
      el('h2', { text: t('x.h') }),
      el('div', { class: 'pair' }, state.me ? thumb(state.me) : null, thumb(p)),
      el('p', { text: t('x.p', { name: p.name }) }),
      p.wearing && el('p', { class: 'muted', text: t('x.look', { x: p.wearing }) }),
      reach(p),
      el('p', null, el('button', { class: 'linkish', type: 'button', id: 'keepLooking', onclick: () => matchDlg.close() }, t('x.keep'))),
    ),
  );
  matchDlg.showModal();
}
matchDlg.addEventListener('click', (e) => {
  if (e.target === matchDlg) matchDlg.close();
});

/* ---------- start ---------- */
async function start() {
  if (!/^[A-Z0-9]{8}$/.test(code)) return problem(t('e.nocode.h'), t('e.nocode.p'));
  try {
    room = await api('/rooms/' + code);
  } catch (e) {
    return problem(e.message, null, e.status === 0 || e.status >= 500);
  }
  document.title = `${room.title} · Jodi`;
  if (token) {
    try {
      await refresh();
      return showMain();
    } catch (e) {
      if (e.status !== 401) return problem(e.message, null, true);
      token = null;
      store.del(KEY);
    }
  }
  showWelcome();
}

// Quietly check for new people and new matches while the page is open.
async function tick() {
  if (!token || tabs.hidden || document.visibilityState !== 'visible' || sheet.open) return;
  try {
    await refresh();
    draw();
  } catch (e) {
    if (e.status === 401) {
      token = null;
      store.del(KEY);
      showWelcome();
      toast(t('t.gone'));
    } else if (e.status === 404 || e.status === 410) {
      problem(e.message);
    }
  }
}
setInterval(tick, 20_000);
document.addEventListener('visibilitychange', tick);

start();
