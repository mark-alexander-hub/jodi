// The couple's side: the QR card, a headcount, and a way to remove people.
/* global qrcode */
import { $, el, api, toast, sideLabel, store, niceDate, dayAndMonth, coupleTitle, t, tn, lang } from './common.js';

const code = (new URLSearchParams(location.search).get('w') || '').toUpperCase();
const KEY = 'jodi:host:' + code;
const view = $('#view');

// The key travels after the # so it is never sent to a server in the address or logged.
let saved = {};
try {
  saved = JSON.parse(store.get(KEY) || '{}') || {};
} catch {}
const hostKey = new URLSearchParams(location.hash.slice(1)).get('k') || saved.key || '';
// Guests open the room in the language the couple is using, unless they have picked their own.
const guestLink = `${location.origin}/room?w=${code}${lang === 'en' ? '' : '&lang=' + lang}`;
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
  view.replaceChildren(el('div', { class: 'paper center stack' }, el('h2', { text: message }), hint && el('p', { class: 'muted', text: hint }), el('a', { class: 'btn', href: '/' }, t('h.start'))));
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(t('t.copyFail'));
  }
}

const step = (n, vars) => el('li', null, el('b', { text: t(`h.how.${n}h`) }), el('span', { text: t(`h.how.${n}p`, vars) }));

function draw(data) {
  store.set(KEY, JSON.stringify({ key: hostKey, title: data.title, date: data.date }));
  document.title = `${data.title} · ${t('h.title')} · Jodi`;
  const flagged = data.guests.filter((g) => g.reports.length).length;

  $('#tableCard').replaceChildren(
    el('p', { text: data.title }),
    el('h1', { text: t('c.h') }),
    qrSvg(guestLink),
    el('p', { text: t('c.p1') }),
    el('p', { text: t('c.p2') }),
    el('p', { class: 'tiny', text: t('c.tiny') }),
  );

  view.replaceChildren(
    el('header', { class: 'masthead' }, el('p', { class: 'kicker', text: t('h.kicker') }), el('h1', null, coupleTitle(data.title)), el('p', { class: 'muted', text: niceDate(data.date) })),

    el(
      'div',
      { class: 'warn' },
      el('b', { text: t('h.keep.b') }),
      t('h.keep.p'),
      el('div', null, el('button', { class: 'linkish', type: 'button', onclick: () => copy(`${location.origin}/host?w=${code}#k=${hostKey}`, t('t.hostCopied')) }, t('h.copyHost'))),
    ),

    el(
      'section',
      { class: 'paper stack center' },
      el('h2', { text: t('h.card.h') }),
      qrSvg(guestLink),
      el('p', { class: 'muted', text: t('h.card.p') }),
      el('button', { class: 'btn', type: 'button', onclick: () => print() }, t('h.print')),
      el(
        'div',
        { class: 'linkbox' },
        el('input', { type: 'text', readonly: true, value: guestLink, 'aria-label': t('h.guestLink'), onfocus: (e) => e.target.select() }),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => copy(guestLink, t('t.guestCopied')) }, t('h.copy')),
      ),
    ),

    el(
      'section',
      { class: 'stats' },
      el('div', { class: 'paper stat' }, el('b', { text: data.guests.length }), tn('h.stat.guests', data.guests.length)),
      el('div', { class: 'paper stat' }, el('b', { text: data.matches }), tn('h.stat.jodis', data.matches)),
    ),

    el(
      'section',
      { class: 'paper' },
      el('h2', { text: t('h.who.h') }),
      el('p', { class: 'muted', text: t('h.who.p') }),
      flagged ? el('p', { class: 'flag', text: t('h.flagged', { n: flagged }) }) : null,
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
                g.reports.length ? el('div', { class: 'flag', text: t('h.reported', { n: g.reports.length }) + (g.reports.filter(Boolean).length ? ': ' + g.reports.filter(Boolean).join(' · ') : '') }) : null,
              ),
              el(
                'button',
                {
                  class: 'btn small danger',
                  type: 'button',
                  onclick: async () => {
                    if (!confirm(t('h.removeConfirm', { name: g.name }))) return;
                    try {
                      await call('/host/guest/' + g.id, { method: 'DELETE' });
                      toast(t('t.removed', { name: g.name }));
                      load();
                    } catch (e) {
                      toast(e.message);
                    }
                  },
                },
                t('h.remove'),
              ),
            ),
          )
        : el('p', { text: t('h.nobody') }),
    ),

    el('section', { class: 'stack' }, el('h2', { text: t('howto') }), el('ol', { class: 'steps' }, step(1), step(2), step(3), step(4, { date: dayAndMonth(data.closesAt) }))),

    el(
      'section',
      { class: 'stack center' },
      el(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          onclick: async () => {
            if (!confirm(t('h.closeConfirm'))) return;
            try {
              await call('/host', { method: 'DELETE' });
              store.del(KEY);
              problem(t('h.closed.h'), t('h.closed.p'));
            } catch (e) {
              toast(e.message);
            }
          },
        },
        t('h.close'),
      ),
    ),
  );
}

async function load() {
  if (!/^[A-Z0-9]{8}$/.test(code) || !hostKey) return problem(t('h.bad.h'), t('h.bad.p'));
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
