// Small helpers shared by every page. No framework, no build step.

export const $ = (sel, root = document) => root.querySelector(sel);

// el('button', { class: 'btn', onclick: fn }, 'Text', childNode)
// Text always goes in as text, never as HTML, so nothing a guest types can run as code.
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) n.append(kid);
  return n;
}

const SVG = 'http://www.w3.org/2000/svg';
// Icons live once in each page as <symbol id="i-name">; this stamps a copy.
export function icon(name, cls = '') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'ico ' + cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

export async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('No connection. Check your internet and try again.');
    e.status = 0;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || 'Something went wrong. Please try again.');
    e.status = res.status;
    throw e;
  }
  return data;
}

let toastTimer;
export function toast(message) {
  let t = $('#toast');
  if (!t) {
    t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

export const sideLabel = (side) =>
  side === 'bride' ? 'Bride’s side' : side === 'groom' ? 'Groom’s side' : 'Friend of both';

export function niceDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Local storage that does not crash in private tabs.
export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

// "Asha & Rahul" with the joining word picked out in marigold.
export function coupleTitle(title) {
  const parts = String(title).split(/\s+(&|\+|and|weds)\s+/i);
  return el('span', null, parts.map((p, i) => (i % 2 ? [' ', el('i', { class: 'amp', text: p }), ' '] : p)));
}
