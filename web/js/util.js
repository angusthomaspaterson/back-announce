// Small shared helpers: formatting in Perth time, colours, escaping.
export const PERTH = 'Australia/Perth';
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export const GROUP_COLOURS = {'NTS': '#1b1d22', 'Rinse FM': '#8a4bd6', 'SoundCloud': '#ff5500', 'Podcasts': '#2b6cb0', 'Writing': '#2f7d5b', 'Radio': '#1da0c3', 'Mixes': '#c98a1a', 'Perth': '#e0508a', 'Bass': '#6f9a1f', 'Progressive': '#0d8080', 'Other': '#6b6f78'};
const GROUP_COLOURS_DARK = {'NTS': '#5a5f6a'};
export const BATCHES = {sweep: '1 Oct', oct11: '11 Oct'};
export const addedLabel = a => a === 'start' ? 'Original pick' : BATCHES[a] ? 'Added ' + BATCHES[a] : (a ? 'Added ' + a : '');
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
export const gcol = g => (isDark() && GROUP_COLOURS_DARK[g]) || GROUP_COLOURS[g] || GROUP_COLOURS.Other;
export const initials = n => { const w = String(n || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : String(n || '??').slice(0, 2)).toUpperCase(); };
export const kindLabel = k => k === 'rss' ? 'Feed' : k === 'manual' ? 'Web page' : k === 'nts' ? 'NTS' : k === 'rinse' ? 'Rinse FM' : k === 'mixcloud' ? 'Mixcloud' : (k || '');

export const dfmt = new Intl.DateTimeFormat('en-AU', {timeZone: PERTH, weekday: 'short', day: 'numeric', month: 'short'});
export const dkey = new Intl.DateTimeFormat('en-CA', {timeZone: PERTH, year: 'numeric', month: '2-digit', day: '2-digit'});
export const sfmt = new Intl.DateTimeFormat('en-AU', {timeZone: PERTH, day: 'numeric', month: 'short'});
export const tfmt = new Intl.DateTimeFormat('en-AU', {timeZone: PERTH, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export const dateOk = iso => iso && !isNaN(new Date(iso));
/** Now as ISO UTC without milliseconds, the same shape as the gatherer's dates. */
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export function rel(iso) { if (!dateOk(iso)) return ''; const diff = Date.now() - new Date(iso); const h = Math.round(diff / 36e5); if (h < 1) return 'just now'; if (h < 24) return h + 'h ago'; const dd = Math.round(h / 24); return dd + 'd ago'; }
export function dur(s) { if (!s) return ''; s = String(s); if (/^\d+$/.test(s)) return Math.round(+s / 60) + ' min'; const p = s.split(':').map(Number); if (p.length === 3) return (p[0] * 60 + p[1]) + ' min'; if (p.length === 2) return p[0] + ' min'; return s; }

let toastTimer = null, toastUndo = null;
export function toast(msg, undo) {
  const t = $('toast'); $('toastTxt').textContent = msg; toastUndo = undo; $('toastUndo').hidden = !undo; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; toastUndo = null; }, 6000);
}
export function wireToast() {
  $('toastUndo').addEventListener('click', () => { const u = toastUndo; $('toast').hidden = true; toastUndo = null; if (u) u(); });
}
