/* ── Shared site header behaviour ────────────────────────────────────────────
   Theme, font size, language and mobile-menu controls for the standalone pages
   (legal documents, trust pages). Mirrors the header controls on index.html and
   shares the same bmc_* localStorage keys, so a preference set on one page is
   still in effect on the next.

   index.html keeps its own copy of these functions because they are wired into
   its full-page translation dictionary. The pages loading this file have no
   translated body copy, so the dictionary here covers the header strings only.

   Load with <script defer src="/assets/site-header.js"></script>. The pre-paint
   snippet that applies the saved theme before first paint stays inline in each
   page's <head> — it has to run before the stylesheet renders.
   ────────────────────────────────────────────────────────────────────────── */

const DICT = {
  "nav.register": { en:"Register/ Block", hi:"रजिस्टर/ब्लॉक करें", mr:"नोंदणी/ब्लॉक करा", gu:"નોંધણી/બ્લોક કરો", bn:"নিবন্ধন/ব্লক করুন", te:"నమోదు/బ్లాక్ చేయండి", ta:"பதிவு/முடக்கு", kn:"ನೋಂದಣಿ/ಬ್ಲಾಕ್ ಮಾಡಿ", or:"ପଞ୍ଜୀକରଣ/ବ୍ଲକ୍ କରନ୍ତୁ", ml:"രജിസ്റ്റർ/ബ്ലോക്ക് ചെയ്യുക" },
  "a11y.font":    { en:"Font size", hi:"फ़ॉन्ट आकार", mr:"फॉन्ट आकार", gu:"ફોન્ટ કદ", bn:"ফন্টের আকার", te:"ఫాంట్ పరిమాణం", ta:"எழுத்துரு அளவு", kn:"ಫಾಂಟ್ ಗಾತ್ರ", or:"ଫଣ୍ଟ ଆକାର", ml:"ഫോണ്ട് വലുപ്പം" },
  "a11y.lang":    { en:"Language", hi:"भाषा", mr:"भाषा", gu:"ભાષા", bn:"ভাষা", te:"భాష", ta:"மொழி", kn:"ಭಾಷೆ", or:"ଭାଷା", ml:"ഭാഷ" },
};

/* localStorage wrapper with in-memory fallback for Private Browsing */
const store = (function() {
  const mem = {};
  return {
    get(k, fallback) {
      fallback = (fallback !== undefined) ? fallback : null;
      try { const v = localStorage.getItem(k); return v !== null ? v : fallback; }
      catch { return k in mem ? mem[k] : fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); }
      catch { mem[k] = v; }
    }
  };
})();

let currentLang  = store.get('bmc_lang', 'en');
let currentFont  = store.get('bmc_font', 'md');
let currentTheme = store.get('bmc_theme', 'dark');

function t(key) { return DICT[key]?.[currentLang] || DICT[key]?.en || key; }

function applyTranslations() {
  const html = document.documentElement;
  html.setAttribute('data-lang', currentLang);
  html.lang = currentLang;

  const set = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = t(key);
  };

  set('nav-cta',       'nav.register');
  set('mnav-cta',      'nav.register');
  set('txt-a11y-font', 'a11y.font');
  set('txt-a11y-lang', 'a11y.lang');
  set('txt-m-font',    'a11y.font');
  set('txt-m-lang',    'a11y.lang');

  ['en','hi','mr','gu','bn','te','ta','kn','or','ml'].forEach(l => {
    ['lang-'+l, 'mlang-'+l].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const active = l === currentLang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  });
}

/* Allowlists prevent arbitrary values being stored in localStorage or set on
   html attrs when someone calls setLang()/setFont() from the browser console */
const ALLOWED_LANGS = new Set(['en', 'hi', 'mr', 'gu', 'bn', 'te', 'ta', 'kn', 'or', 'ml']);
const ALLOWED_FONTS = new Set(['sm', 'md', 'lg', 'xl']);

function setLang(l) {
  if (!ALLOWED_LANGS.has(l)) return;
  currentLang = l;
  store.set('bmc_lang', l);
  applyTranslations();
  closeAllDropdowns();
}

function setFont(f) {
  if (!ALLOWED_FONTS.has(f)) return;
  currentFont = f;
  store.set('bmc_font', f);
  document.documentElement.setAttribute('data-font-size', f);
  document.querySelectorAll('[data-size]').forEach(btn => {
    const active = btn.dataset.size === f;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  store.set('bmc_theme', currentTheme);
  applyTheme();
}

function toggleDropdown(id) {
  const dd  = document.getElementById(id);
  if (!dd) return;
  const btn = document.getElementById(id.replace('-dd', '-dd-btn'));
  const wasOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) {
    dd.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const first = dd.querySelector('button, a, [tabindex]');
    if (first) first.focus();
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => {
    d.classList.remove('open');
    const btn = document.getElementById(d.id.replace('-dd', '-dd-btn'));
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-icon-btn') && !e.target.closest('.dropdown')) {
    closeAllDropdowns();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllDropdowns();
});

function toggleMobileMenu() {
  const m   = document.getElementById('mobile-menu');
  const btn = document.getElementById('mobile-menu-btn');
  if (!m || !btn) return;
  const open = m.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  btn.textContent = open ? '✕' : '☰';
}
function closeMobileMenu() {
  const m   = document.getElementById('mobile-menu');
  const btn = document.getElementById('mobile-menu-btn');
  if (!m || !btn) return;
  m.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open navigation menu');
  btn.textContent = '☰';
}

applyTheme();
setFont(ALLOWED_FONTS.has(currentFont) ? currentFont : 'md');
applyTranslations();
