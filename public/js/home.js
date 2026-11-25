import { $, el, api, store, niceDate, t } from './common.js';

document.title = t('home.title');
const form = $('#createForm');
const error = $('#createError');
const dateInput = $('#date');

// Dates are picked in the guest's own time zone.
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
dateInput.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const title = $('#title').value.trim();
    const date = dateInput.value;
    const { code, hostKey } = await api('/rooms', { method: 'POST', body: { title, date } });
    store.set('jodi:host:' + code, JSON.stringify({ key: hostKey, title, date }));
    location.href = `/host?w=${code}#k=${hostKey}`;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  }
});

// Rooms made earlier on this phone, so the couple can find their way back.
const rooms = [];
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('jodi:host:')) continue;
    const v = JSON.parse(localStorage.getItem(k));
    if (v && v.key) rooms.push({ code: k.slice(10), ...v });
  }
} catch {}
if (rooms.length) {
  $('#mine').hidden = false;
  $('#mineList').append(
    ...rooms.map((r) =>
      el('p', null, el('a', { href: `/host?w=${r.code}#k=${r.key}` }, r.title || r.code), r.date ? ` · ${niceDate(r.date)}` : ''),
    ),
  );
}
