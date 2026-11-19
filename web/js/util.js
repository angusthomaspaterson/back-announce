// Small shared helpers: formatting times, colours, escaping.
export const PERTH = 'Australia/Perth';
// Times show in Perth for Angus (a token on this device) and in each visitor's own time zone.
const hasToken = (() => { try { return !!localStorage.getItem('ba.token'); } catch (e) { return false; } })();
const LOCAL = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || PERTH; } catch (e) { return PERTH; } })();
export const HOME = hasToken ? PERTH : LOCAL;
/** How the screens name that zone: "Perth time", or "your time" for a visitor elsewhere. */
export const homeLabel = HOME === PERTH ? 'Perth time' : 'your time';
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export const GROUP_COLOURS = {'NTS': '#1b1d22', 'Rinse FM': '#8a4bd6', 'SoundCloud': '#ff5500', 'Podcasts': '#2b6cb0', 'Writing': '#2f7d5b', 'Radio': '#1da0c3', 'Mixes': '#c98a1a', 'Perth': '#e0508a', 'Bass & DnB': '#6f9a1f', 'Progressive & Trance': '#0d8080', 'triple j': '#d3441c', 'Double J': '#22385c', 'BBC': '#4b4f9e', 'House': '#a23b72', 'Techno': '#38606f', 'Funk, Soul, Hip Hop': '#8c6d1f', 'Rock, Metal, Indie': '#7a3e2a', 'Other': '#6b6f78'};
const GROUP_COLOURS_DARK = {'NTS': '#5a5f6a', 'Double J': '#5b7bb5', 'House': '#d06aa0', 'Techno': '#6d9aab', 'Funk, Soul, Hip Hop': '#c9a24a', 'Rock, Metal, Indie': '#c4785e'};
/** How categories are shown, in three runs: radio and mixes, then genres, then writing and talk.
 *  A category not listed here (a new group) goes at the end of the run it is closest to: the radio run. */
export const CATEGORY_RUNS = [
  ['NTS', 'Rinse FM', 'BBC', 'triple j', 'Double J', 'Radio', 'Mixes'],
  ['House', 'Techno', 'Bass & DnB', 'Progressive & Trance', 'Funk, Soul, Hip Hop', 'Rock, Metal, Indie'],
  ['Writing', 'Podcasts'],
];
/** Which run (0, 1, 2) a category is in, and its place: for sorting. Unknown ones close the first run. */
export function categoryPlace(g) {
  for (let r = 0; r < CATEGORY_RUNS.length; r++) { const i = CATEGORY_RUNS[r].indexOf(g); if (i >= 0) return [r, i]; }
  return [0, 99];
}
export const byCategoryOrder = (a, b) => { const [ra, ia] = categoryPlace(a), [rb, ib] = categoryPlace(b); return ra - rb || ia - ib || a.localeCompare(b); };
/** Every category a source belongs to: its main group (which sets its colour) first, then any
 *  extra ones listed in `also`, such as an NTS show that is also Techno. */
export const catsOf = s => [...new Set([(s && s.group) || 'Other', ...(s && Array.isArray(s.also) ? s.also : [])])];
export const BATCHES = {sweep: '1 Oct', oct11: '11 Oct', oct14: '14 Oct'};
export const addedLabel = a => a === 'start' ? 'Original pick' : BATCHES[a] ? 'Added ' + BATCHES[a] : (a ? 'Added ' + a : '');
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
export const gcol = g => (isDark() && GROUP_COLOURS_DARK[g]) || GROUP_COLOURS[g] || GROUP_COLOURS.Other;
export const initials = n => { const w = String(n || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : String(n || '??').slice(0, 2)).toUpperCase(); };
export const kindLabel = k => k === 'rss' ? 'Feed' : k === 'manual' ? 'Web page' : k === 'nts' ? 'NTS' : k === 'bbc' ? 'BBC Sounds' : k === 'abc' ? 'ABC' :k === 'rinse' ? 'Rinse FM' : k === 'mixcloud' ? 'Mixcloud' : (k || '');

export const dfmt = new Intl.DateTimeFormat('en-AU', {timeZone: HOME, weekday: 'short', day: 'numeric', month: 'short'});
export const dkey = new Intl.DateTimeFormat('en-CA', {timeZone: HOME, year: 'numeric', month: '2-digit', day: '2-digit'});
export const sfmt = new Intl.DateTimeFormat('en-AU', {timeZone: HOME, day: 'numeric', month: 'short'});
export const tfmt = new Intl.DateTimeFormat('en-AU', {timeZone: HOME, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
/** "47:12" or "1:03:09", for the player and resume points. */
export const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
/** Where Open goes, in a word or two: "NTS", "BBC Sounds"... or null for a plain web page. */
export function openWhere(url) {
  let h = ''; try { h = new URL(url).hostname.replace(/^(www|m)\./, ''); } catch (e) { return null; }
  if (h === 'nts.live') return 'NTS';
  if (h === 'bbc.co.uk' || h === 'bbc.com') return 'BBC Sounds';
  if (h === 'abc.net.au') return 'ABC listen';
  if (h.endsWith('soundcloud.com')) return 'SoundCloud';
  if (h === 'mixcloud.com') return 'Mixcloud';
  if (h === 'rinse.fm') return 'Rinse FM';
  if (h === 'youtube.com' || h === 'youtu.be') return 'YouTube';
  if (h === 'open.spotify.com') return 'Spotify';
  return null;
}
export const dateOk = iso => iso && !isNaN(new Date(iso));
/** Now as ISO UTC without milliseconds, the same shape as the gatherer's dates. */
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export function rel(iso) { if (!dateOk(iso)) return ''; const diff = Date.now() - new Date(iso); const h = Math.round(diff / 36e5); if (h < 1) return 'just now'; if (h < 24) return h + 'h ago'; const dd = Math.round(h / 24); return dd + 'd ago'; }
export function dur(s) { if (!s) return ''; s = String(s); if (/^\d+$/.test(s)) return Math.round(+s / 60) + ' min'; const p = s.split(':').map(Number); if (p.length === 3) return (p[0] * 60 + p[1]) + ' min'; if (p.length === 2) return p[0] + ' min'; return s; }

// On Android, links to these sites open in their apps. An intent: link names the app's
// package (each checked on the Play Store); if the app isn't installed, Chrome opens the
// fallback web address instead.
const APPS = [
  {host: /(^|\.)soundcloud\.com$/i, pkg: 'com.soundcloud.android'},
  {host: /(^|\.)mixcloud\.com$/i, pkg: 'com.mixcloud.player'},
  {host: /^open\.spotify\.com$/i, pkg: 'com.spotify.music'},
  // BBC Sounds episodes. The app is named for bbc.co.uk in the BBC's own
  // .well-known/assetlinks.json (checked 6 Nov 2026); other BBC pages stay in the browser.
  {host: /^www\.bbc\.co\.uk$/i, path: /^\/sounds\//, pkg: 'com.bbc.sounds'},
  // ABC listen (triple j, Double J): the app named in abc.net.au's assetlinks.json (7 Nov 2026).
  // It handles /listen/ addresses; triple j episodes answer there too (the site redirects
  // /listen/programs/<show>/<episode>/<id> to the triple j page), so rewrite to that.
  {host: /^(www\.)?abc\.net\.au$/i, path: /^\/(triplej|doublej|listen)\/programs\//, pkg: 'com.thisisaim.abcradio',
   rewrite: p => p.replace(/^\/(triplej|doublej)\/programs\//, '/listen/programs/')},
  {host: /^(www\.)?nts\.live$/i, pkg: 'com.ntslive.ntsradio'},
  {host: /^(www\.|m\.)?youtube\.com$|^youtu\.be$/i, pkg: 'com.google.android.youtube'},
  {host: /^(www\.)?kexp\.org$/i, pkg: 'org.kexp.android'},
  // Not Rinse FM: its app (fm.rinse.player) accepts no links from other apps, so Chrome only
  // bounced to the website (tested on the Pixel, 14 Oct 2026).
];
/** A Spotify search for a podcast episode or a release, or null where Spotify won't have it. */
export function spotifySearch(query) {
  const q = String(query || '').replace(/\s*\([^)]*\)/g, ' ').replace(/[–—:|]/g, ' ').replace(/\s+/g, ' ').trim();
  return q ? `https://open.spotify.com/search/${encodeURIComponent(q)}` : null;
}
export function appIntent(href) {
  let u;
  try { u = new URL(href); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || /^(api|feeds)\./i.test(u.hostname)) return null;
  const app = APPS.find(a => a.host.test(u.hostname) && (!a.path || a.path.test(u.pathname)));
  if (!app) return null;
  const path = app.rewrite ? app.rewrite(u.pathname) : u.pathname;
  return `intent://${u.host}${path}${u.search}#Intent;scheme=https;package=${app.pkg};S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}
export const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Drop a card when another source already has the same episode: the same title within a
 *  day (the RA Podcast feed also carries every RA Exchange). Items arrive newest first; a
 *  copy that plays in the app wins over one that doesn't. Short or generic titles, such as
 *  a show's own name, are never merged. */
export function dedupeAcross(items) {
  const norm = t => String(t || '').toLowerCase().replace(/[‘’'"“”]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const kept = [], byTitle = new Map();
  for (const it of items) {
    const k = norm(it.title);
    const prev = k.length >= 12 && k !== norm(it.sname) ? byTitle.get(k) : null;
    if (prev && prev.sid !== it.sid && Math.abs(new Date(prev.date) - new Date(it.date)) <= 864e5) {
      if (it.audio && !prev.audio) kept[kept.indexOf(prev)] = it, byTitle.set(k, it);
      continue;
    }
    kept.push(it);
    if (k) byTitle.set(k, it);
  }
  return kept;
}

let toastTimer = null, toastUndo = null;
export function toast(msg, undo) {
  const t = $('toast'); $('toastTxt').textContent = msg; toastUndo = undo; $('toastUndo').hidden = !undo; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; toastUndo = null; }, 6000);
}
export function wireToast() {
  $('toastUndo').addEventListener('click', () => { const u = toastUndo; $('toast').hidden = true; toastUndo = null; if (u) u(); });
}
