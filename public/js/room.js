// The guest's side: join, look around, like, and see matches.
import { $, el, icon, api, toast, sideLabel, store, coupleTitle } from './common.js';

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
  const initial = [...(p.name || '?').trim()][0] || '?';
  const t = el('div', { class: `thumb s-${p.side}` }, el('span', { class: 'initial', text: initial.toUpperCase() }));
  if (p.photo) {
    loadPhoto(p).then((url) => {
      if (url) t.replaceChildren(el('img', { src: url, alt: '' }));
    });
  }
  return t;
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

const masthead = (sub) =>
  el(
    'header',
    { class: 'masthead' },
    el('p', { class: 'kicker', text: 'The singles’ corner at' }),
    el('h1', null, coupleTitle(room.title)),
    sub && el('p', { class: 'muted', text: sub }),
  );

const closesOn = () =>
  new Date(room.closesAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function promises() {
  const item = (ico, head, text) => el('li', null, icon(ico), el('div', null, el('b', { text: head }), el('span', { text })));
  return el(
    'ul',
    { class: 'promise' },
    item('eye', 'Only other singles see you', 'People who have not joined see nothing. You are shown only to the people you asked to meet.'),
    item('lock', 'Your contact stays hidden', 'It is shared only when you and someone else like each other. A like that is not returned stays secret.'),
    item('clock', `Gone on ${closesOn()}`, 'Profiles, photos and likes are all deleted then. You can delete yours sooner.'),
  );
}

function howTo() {
  const step = (head, text) => el('li', null, el('b', { text: head }), el('span', { text }));
  return el(
    'ol',
    { class: 'steps' },
    step('Look around', 'Open “Who’s here” to see the other single guests. Tap a picture to read more.'),
    step('Like the ones you would like to meet', `You have ${room.likeLimit} likes, so choose with care. You can take a like back.`),
    step('Wait for a jodi', 'If they like you too, you both get each other’s Instagram or WhatsApp under “Jodis”.'),
    step('Go and say hello', 'You are at the same wedding. The paneer counter is a fine place to start.'),
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
      retry && el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Try again'),
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
      el('p', {
        class: 'lede center',
        text: 'Single, and wondering who else here is? This is a small private corner just for the guests of this wedding.',
      }),
      room.joined >= 3 && el('p', { class: 'count', text: `${room.joined} single guests have joined so far.` }),
      el('button', { class: 'btn', type: 'button', onclick: () => showForm(null) }, 'I’m single. Count me in'),
      el('div', { class: 'paper henna' }, promises()),
      el('p', { class: 'muted center', text: 'Not single? Just close this page. Nothing was saved.' }),
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
  const removeBtn = el('button', { class: 'linkish', type: 'button', hidden: !(me && me.photo) }, 'Remove photo');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      photoData = await shrink(f);
      preview.replaceChildren(el('img', { src: 'data:image/jpeg;base64,' + photoData, alt: '' }));
      removeBtn.hidden = false;
    } catch {
      toast('That photo could not be opened. Try another one.');
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
    contactLabel.textContent = kind === 'whatsapp' ? 'Your WhatsApp number' : 'Your Instagram name';
    contactInput.placeholder = kind === 'whatsapp' ? '+91 98765 43210' : '@yourname';
    contactInput.inputMode = kind === 'whatsapp' ? 'tel' : 'text';
  };
  setContactLabel(me ? me.contactKind : 'instagram');

  const error = el('p', { class: 'error', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit' }, me ? 'Save changes' : 'Join the corner');

  const form = el(
    'form',
    { class: 'paper', novalidate: true },
    text('name', 'First name', { attrs: { maxlength: 30, autocomplete: 'given-name' }, value: me?.name }),
    text('age', 'Age', { type: 'number', attrs: { min: 18, max: 99, inputmode: 'numeric' }, value: me?.age }, 'You must be 18 or older.'),
    pick('gender', 'I am', [['woman', 'A woman'], ['man', 'A man'], ['other', 'Another identity']], me?.gender),
    pick('seeking', 'I would like to meet', [['men', 'Men'], ['women', 'Women'], ['everyone', 'Everyone']], me?.seeking, 'You are shown only to people who are looking for you too.'),
    pick('side', 'I am here from', [['bride', 'The bride’s side'], ['groom', 'The groom’s side'], ['both', 'Friend of both']], me?.side),
    text('wearing', 'What are you wearing today?', { attrs: { maxlength: 60, placeholder: 'Blue kurta, near the DJ' }, value: me?.wearing }, 'Helps people recognise you across the hall.'),
    text('about', 'One line about you', { area: true, attrs: { maxlength: 160, placeholder: 'Here for the biryani. Will dance if asked twice.' }, value: me?.about }, 'Optional.'),
    el(
      'div',
      { class: 'field' },
      el('label', null, 'A photo', el('span', { class: 'hint', text: 'Optional. Without one, people see your first letter.' })),
      el(
        'div',
        { class: 'photo-pick' },
        preview,
        el('div', null, el('button', { class: 'btn small ghost', type: 'button', onclick: () => fileInput.click() }, 'Choose a photo'), el('div', null, removeBtn)),
        fileInput,
      ),
    ),
    pick('contactKind', 'If it is a jodi, they can reach me on', [['instagram', 'Instagram'], ['whatsapp', 'WhatsApp']], me ? me.contactKind : 'instagram', 'Shown only to people you match with.'),
    el('div', { class: 'field' }, contactLabel, contactInput),
    !me &&
      el(
        'label',
        { class: 'check' },
        el('input', { type: 'checkbox', name: 'agree' }),
        el('span', { text: 'I am 18 or older and single. I understand that other single guests here will see my profile, and that people I match with will see my contact.' }),
      ),
    error,
    el('div', { class: 'field' }, submit),
    el('div', { class: 'center' }, el('button', { class: 'linkish', type: 'button', onclick: () => (me ? showMain() : showWelcome()) }, 'Go back')),
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
      toast(me ? 'Saved.' : 'You are in. Have a look around.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  view.replaceChildren(el('header', { class: 'stack' }, el('p', { class: 'kicker', text: room.title }), el('h2', { text: me ? 'Change your profile' : 'Tell the others a little' })), form);
  scrollTo(0, 0);
}

/* ---------- main ---------- */
async function refresh() {
  const data = await call('/people');
  state = data;
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

function drawPeople() {
  const n = state.people.length;
  const likes = `${state.likesLeft} ${state.likesLeft === 1 ? 'like' : 'likes'} left`;
  view.replaceChildren(
    masthead(),
    n
      ? el('p', { class: 'count', text: `${n} single ${n === 1 ? 'guest' : 'guests'} for you to meet · ${likes}` })
      : null,
    n
      ? el(
          'div',
          { class: 'prints' },
          state.people.map((p) =>
            el(
              'button',
              { class: 'print', type: 'button', onclick: () => openPerson(p), 'aria-label': `${p.name}, ${p.age}, ${sideLabel(p.side)}${p.liked ? ', liked' : ''}` },
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
          el('h2', { text: 'You are early' }),
          el('p', { class: 'muted', text: 'Nobody you asked to meet has joined yet. More people scan the card as the evening goes on, so look again after the starters.' }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => refresh().then(draw).catch((e) => toast(e.message)) }, 'Look again'),
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
    el('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer' }, insta ? 'Say hello on Instagram' : 'Say hello on WhatsApp'),
  );
}

function drawMatches() {
  view.replaceChildren(
    el('header', { class: 'stack' }, el('p', { class: 'kicker', text: room.title }), el('h2', { text: 'Your jodis' })),
    state.matches.length
      ? el(
          'div',
          { class: 'stack' },
          state.matches.map((m) =>
            el(
              'div',
              { class: 'paper' },
              el(
                'div',
                { class: 'match-row' },
                thumb(m),
                el('div', null, el('h3', null, m.name, ' ', el('small', { class: 'muted', text: m.age })), el('span', { class: `tag s-${m.side}`, text: sideLabel(m.side) }), m.wearing && el('div', { class: 'muted', text: 'Wearing: ' + m.wearing })),
              ),
              reach(m),
            ),
          ),
        )
      : el(
          'div',
          { class: 'paper empty stack' },
          art('chai'),
          el('h2', { text: 'No jodi yet' }),
          el('p', { class: 'muted', text: 'When someone you liked likes you back, they appear here with their contact. Nobody is told about a like that is not returned.' }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => setTab('people') }, 'See who’s here'),
        ),
  );
}

function drawMe() {
  const me = state.me;
  view.replaceChildren(
    el('header', { class: 'stack' }, el('p', { class: 'kicker', text: room.title }), el('h2', { text: 'This is how you look' })),
    el(
      'div',
      { class: 'paper' },
      el(
        'div',
        { class: 'match-row' },
        thumb(me),
        el('div', null, el('h3', null, me.name, ' ', el('small', { class: 'muted', text: me.age })), el('span', { class: `tag s-${me.side}`, text: sideLabel(me.side) }), me.wearing && el('div', { class: 'muted', text: 'Wearing: ' + me.wearing })),
      ),
      me.about && el('p', { text: me.about }),
      el('p', { class: 'muted', text: `Matches reach you on ${me.contactKind === 'instagram' ? 'Instagram: @' + me.contact : 'WhatsApp: ' + me.contact}` }),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => showForm(me) }, 'Change my profile'),
    ),
    el('section', { class: 'stack' }, el('h2', { text: 'How to use this' }), howTo()),
    el('div', { class: 'paper' }, promises()),
    el(
      'div',
      { class: 'stack center' },
      el('button', { class: 'btn danger', type: 'button', onclick: leave }, 'Delete my profile now'),
      el('p', { class: 'muted', text: 'This removes your profile, photo, likes and matches straight away.' }),
    ),
  );
}

async function leave() {
  if (!confirm('Delete your profile, likes and matches? This cannot be undone.')) return;
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
  toast('Your profile was deleted.');
}

function setTab(t) {
  tab = t;
  draw();
  scrollTo(0, 0);
}
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});

/* ---------- a person's sheet ---------- */
function openPerson(p) {
  const likeBtn = el('button', { class: 'btn', type: 'button' });
  const paint = () => {
    likeBtn.replaceChildren(icon('heart'), p.liked ? 'Liked. Tap to take it back' : 'Like ' + p.name);
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
        toast('Liked. They will only find out if they like you too.');
      }
      paint();
      draw();
    } catch (e) {
      toast(e.message);
    }
    likeBtn.disabled = false;
  });

  const reportBox = el('div', { class: 'stack', hidden: true });
  const reason = el('textarea', { maxlength: 200, placeholder: 'What is wrong? (optional, the couple can read this)', 'aria-label': 'Reason' });
  reportBox.append(
    el('p', { class: 'muted', text: `You and ${p.name} will no longer see each other. The couple is told, and can remove them.` }),
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
            toast(`${p.name} is hidden.`);
          } catch (e) {
            toast(e.message);
          }
        },
      },
      'Hide and report',
    ),
  );

  sheet.replaceChildren(
    el('button', { class: 'close-x', type: 'button', 'aria-label': 'Close', onclick: () => sheet.close() }, icon('x')),
    el(
      'div',
      { class: 'sheet' },
      thumb(p),
      el('h2', { class: 'who' }, p.name, ' ', el('small', { text: p.age })),
      el('span', { class: `tag s-${p.side}`, text: sideLabel(p.side) }),
      p.wearing && el('p', null, el('b', { text: 'Wearing today: ' }), p.wearing),
      p.about && el('p', { class: 'about', text: p.about }),
      el('div', { class: 'row' }, likeBtn),
      el('p', { class: 'center' }, el('button', { class: 'linkish', type: 'button', onclick: () => (reportBox.hidden = !reportBox.hidden) }, 'Something is off about this person')),
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
    s.style.left = (i * 37) % 100 + '%';
    s.style.animationDelay = ((i * 0.13) % 1.6).toFixed(2) + 's';
    return s;
  });
  matchDlg.replaceChildren(
    el(
      'div',
      { class: 'match' },
      petals,
      el('p', { class: 'kicker', text: 'They like you too' }),
      el('h2', { text: 'It’s a jodi!' }),
      el('div', { class: 'pair' }, state.me ? thumb(state.me) : null, thumb(p)),
      el('p', { text: `You and ${p.name} liked each other. Go and say hello.` }),
      p.wearing && el('p', { class: 'muted', text: `Look for: ${p.wearing}` }),
      reach(p),
      el('p', null, el('button', { class: 'linkish', type: 'button', onclick: () => matchDlg.close() }, 'Keep looking around')),
    ),
  );
  matchDlg.showModal();
}
matchDlg.addEventListener('click', (e) => {
  if (e.target === matchDlg) matchDlg.close();
});

/* ---------- start ---------- */
async function start() {
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return problem('This link is missing its wedding code', 'Scan the card at the venue again, or ask the couple for the link.');
  }
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
      toast('Your profile is no longer in this corner.');
    } else if (e.status === 404 || e.status === 410) {
      problem(e.message);
    }
  }
}
setInterval(tick, 20_000);
document.addEventListener('visibilitychange', tick);

start();
