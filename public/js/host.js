// The couple's side: the QR card, a headcount, and a way to remove people.
/* global qrcode */
import { $, el, api, toast, sideLabel, store, niceDate } from './common.js';

const code = (new URLSearchParams(location.search).get('w') || '').toUpperCase();
const KEY = 'jodi:host:' + code;
const view = $('#view');

// The key travels after the # so it is never sent to a server in the address or logged.
let saved = {};
try {
  saved = JSON.parse(store.get(KEY) || '{}') || {};
} catch {}
const hostKey = new URLSearchParams(location.hash.slice(1)).get('k') || saved.key || '';
const guestLink = `${location.origin}/room?w=${code}`;
const call = (path, opts = {}) => api(`/rooms/${code}${path}`, { ...opts, token: hostKey });

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const box = el('div', { class: 'qr' });
  // Built by the QR library from our own link, never from anything a guest typed.
  box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  return box;
}

function problem(message, hint) {
  view.replaceChildren(el('div', { class: 'paper center stack' }, el('h2', { text: message }), hint && el('p', { class: 'muted', text: hint }), el('a', { class: 'btn', href: '/' }, 'Go to the start')));
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Could not copy. Press and hold the link to copy it.');
  }
}

function draw(data) {
  store.set(KEY, JSON.stringify({ key: hostKey, title: data.title, date: data.date }));
  document.title = `${data.title} · your room · Jodi`;
  const closes = new Date(data.closesAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const flagged = data.guests.filter((g) => g.reports.length).length;

  $('#tableCard').replaceChildren(
    el('p', { text: data.title }),
    el('h1', { text: 'Single? Scan me.' }),
    qrSvg(guestLink),
    el('p', { text: 'Find out who else at this wedding is single.' }),
    el('p', { text: 'Your contact is shared only if you both like each other.' }),
    el('p', { class: 'tiny', text: 'Free. No app to install. Everything is deleted three days after the wedding.' }),
  );

  view.replaceChildren(
    el('header', { class: 'masthead' }, el('p', { class: 'kicker', text: 'Your room for' }), el('h1', null, el('span', { text: data.title })), el('p', { class: 'muted', text: niceDate(data.date) })),

    el(
      'div',
      { class: 'warn' },
      el('b', { text: 'Keep this page. ' }),
      'Its link is your only key to the room: there is no password. Bookmark it or send it to yourself now.',
      el('div', null, el('button', { class: 'linkish', type: 'button', onclick: () => copy(`${location.origin}/host?w=${code}#k=${hostKey}`, 'Your host link is copied. Keep it private.') }, 'Copy my host link')),
    ),

    el(
      'section',
      { class: 'paper stack center' },
      el('h2', { text: 'The card for your guests' }),
      qrSvg(guestLink),
      el('p', { class: 'muted', text: 'Print it and leave it where people queue: the entrance, the food counters, the photo booth.' }),
      el('button', { class: 'btn', type: 'button', onclick: () => print() }, 'Print the table card'),
      el(
        'div',
        { class: 'linkbox' },
        el('input', { type: 'text', readonly: true, value: guestLink, 'aria-label': 'Link for guests', onfocus: (e) => e.target.select() }),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => copy(guestLink, 'Guest link copied. Share it in the wedding WhatsApp group.') }, 'Copy'),
      ),
    ),

    el(
      'section',
      { class: 'stats' },
      el('div', { class: 'paper stat' }, el('b', { text: data.guests.length }), data.guests.length === 1 ? 'single guest joined' : 'single guests joined'),
      el('div', { class: 'paper stat' }, el('b', { text: data.matches }), data.matches === 1 ? 'jodi so far' : 'jodis so far'),
    ),

    el(
      'section',
      { class: 'paper' },
      el('h2', { text: 'Who has joined' }),
      el('p', { class: 'muted', text: 'You can see who joined so that you can remove anyone who should not be here. You cannot see who liked whom, or who matched: that stays between them.' }),
      flagged ? el('p', { class: 'guest flag', text: `${flagged} ${flagged === 1 ? 'person has' : 'people have'} been reported by other guests.` }) : null,
      data.guests.length
        ? data.guests.map((g) =>
            el(
              'div',
              { class: 'guest' },
              el(
                'div',
                null,
                el('b', { text: `${g.name}, ${g.age}` }),
                ' ',
                el('span', { class: `tag s-${g.side}`, text: sideLabel(g.side) }),
                g.reports.length ? el('div', { class: 'flag', text: `Reported ${g.reports.length}×` + (g.reports.filter(Boolean).length ? ': ' + g.reports.filter(Boolean).join(' · ') : '') }) : null,
              ),
              el(
                'button',
                {
                  class: 'btn small danger',
                  type: 'button',
                  onclick: async () => {
                    if (!confirm(`Remove ${g.name} from the room? Their profile, likes and matches are deleted.`)) return;
                    try {
                      await call('/host/guest/' + g.id, { method: 'DELETE' });
                      toast(`${g.name} was removed.`);
                      load();
                    } catch (e) {
                      toast(e.message);
                    }
                  },
                },
                'Remove',
              ),
            ),
          )
        : el('p', { text: 'Nobody yet. People join once the card is out at the venue.' }),
    ),

    el(
      'section',
      { class: 'stack' },
      el('h2', { text: 'How to use this' }),
      el(
        'ol',
        { class: 'steps' },
        el('li', null, el('b', { text: 'Save this page' }), el('span', { text: 'Bookmark it, or copy your host link and send it to yourself.' })),
        el('li', null, el('b', { text: 'Print the card' }), el('span', { text: 'Two or three copies are plenty. You can also share the guest link in your wedding WhatsApp group the day before.' })),
        el('li', null, el('b', { text: 'Ask the emcee or DJ to mention it once' }), el('span', { text: 'Something like: “Single? There is a card by the entrance for you.” Most people join right after.' })),
        el('li', null, el('b', { text: 'That is all' }), el('span', { text: `The room closes by itself on ${closes} and everything in it is deleted.` })),
      ),
    ),

    el(
      'section',
      { class: 'stack center' },
      el(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          onclick: async () => {
            if (!confirm('Close the room now and delete every profile, photo and match? This cannot be undone.')) return;
            try {
              await call('/host', { method: 'DELETE' });
              store.del(KEY);
              problem('The room is closed', 'Everything in it was deleted.');
            } catch (e) {
              toast(e.message);
            }
          },
        },
        'Close the room and delete everything now',
      ),
    ),
  );
}

async function load() {
  if (!/^[A-Z0-9]{8}$/.test(code) || !hostKey) {
    return problem('This is not a full host link', 'Open the link you saved when you made the room.');
  }
  try {
    draw(await call('/host'));
  } catch (e) {
    if (e.status === 404 || e.status === 410) store.del(KEY);
    problem(e.message);
  }
}

load();
setInterval(() => {
  if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) call('/host').then(draw).catch(() => {});
}, 30_000);
