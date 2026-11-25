// Languages. English is the source; the others are loaded only when chosen.
// To add a language: copy lang/en.js, translate the values, and add it to LANGS below.
import en from './lang/en.js';

export const LANGS = { en: 'English', hi: 'हिन्दी', kn: 'ಕನ್ನಡ', ta: 'தமிழ்' };
const LOCALES = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN' };
const KEY = 'jodi:lang';
const known = (l) => typeof l === 'string' && Object.hasOwn(LANGS, l);

function pick() {
  // 1. what this person chose before, 2. what the link asks for, 3. the phone's own language
  try {
    const saved = localStorage.getItem(KEY);
    if (known(saved)) return saved;
  } catch {}
  const asked = new URLSearchParams(location.search).get('lang');
  if (known(asked)) return asked;
  for (const l of navigator.languages || []) {
    const short = String(l).slice(0, 2).toLowerCase();
    if (known(short)) return short;
  }
  return 'en';
}

export const lang = pick();
export const locale = LOCALES[lang];

let own = en;
if (lang !== 'en') {
  try {
    own = (await import(`./lang/${lang}.js`)).default;
  } catch {
    own = en; // could not load, carry on in English
  }
}
document.documentElement.lang = lang;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '')) : s);

// t('key', { name: 'Asha' }). Falls back to English, then to the key itself.
export function t(key, vars) {
  return fill(own[key] ?? en[key] ?? key, vars);
}
export const has = (key) => own[key] != null;
// For the few places English needs a separate singular: uses "key.one" when n is 1 and the language has it.
export const tn = (key, n, vars) => t(n === 1 && has(key + '.one') ? key + '.one' : key, { n, ...vars });

export function setLang(l) {
  if (!known(l) || l === lang) return;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  history.replaceState(null, '', u);
  location.reload();
}

// The row of language buttons at the top of every page.
function langBar() {
  const nav = document.createElement('nav');
  nav.className = 'langs';
  nav.setAttribute('aria-label', 'Language');
  for (const [code, name] of Object.entries(LANGS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.lang = code;
    b.setAttribute('aria-pressed', code === lang ? 'true' : 'false');
    b.addEventListener('click', () => setLang(code));
    nav.append(b);
  }
  return nav;
}

// Text written straight into the HTML carries data-i18n="key" and is swapped here.
// The *_html strings are our own fixed text (never anything a guest typed), so innerHTML is safe.
export function applyStatic(root = document) {
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of root.querySelectorAll('[data-i18n-html]')) n.innerHTML = t(n.dataset.i18nHtml);
  for (const n of root.querySelectorAll('[data-i18n-ph]')) n.placeholder = t(n.dataset.i18nPh);
  for (const n of root.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  const slot = root.querySelector('#langs');
  if (slot && !slot.firstChild) slot.append(langBar());
}
applyStatic();
