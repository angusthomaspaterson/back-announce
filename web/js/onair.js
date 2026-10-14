// The On Air tab: what is live now, the next 24 hours and the week, all in Perth time.
// Intl handles daylight saving for every station's zone.
import {$, esc, isDark} from './util.js';
import {STATIONS, SHOWS, FOLLOW, EXTRA_STREAMS, PERTH, LON, SYD} from './schedule.js';
import {play} from './player.js';

/** Play a station's stream; the player shows the show on now and keeps it current. */
export function playStation(k) {
  const st = STATIONS[k];
  const describe = () => { const o = nowOn(k); return o ? {title: o.sh.n, sub: `${st.name} · live until ${hm(o.end, PERTH)}`} : {title: st.name, sub: 'Live'}; };
  play(st.stream, {...describe(), live: true, describe});
}

const fmtCache = {};
function fmt(tz) { return fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'})); }
const WD = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};
export function parts(date, tz) { const o = {}; for (const p of fmt(tz).formatToParts(date)) o[p.type] = p.value; return {y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd: WD[o.weekday]}; }
function offsetMs(date, tz) { const p = parts(date, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0) - Math.floor(date.getTime() / 60000) * 60000; }
export function zonedToUtc(y, m, d, h, mi, tz) { const guess = Date.UTC(y, m - 1, d, h, mi); let t = guess - offsetMs(new Date(guess), tz); t = guess - offsetMs(new Date(t), tz); return t; }
function tzName(date, tz) { const f = new Intl.DateTimeFormat('en-GB', {timeZone: tz, timeZoneName: 'short'}); const p = f.formatToParts(date).find(x => x.type === 'timeZoneName'); return p ? p.value : ''; }
function hm(ms, tz) { const p = parts(new Date(ms), tz); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); }
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function dayLabel(ms, tz) { return DAYS[parts(new Date(ms), tz).wd]; }
function toMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

/** Every showing of every show over a window of days around now, as UTC ms. */
export function occurrences(now) {
  const out = [], tzs = {};
  for (const sh of SHOWS) {
    const st = STATIONS[sh.st]; const tz = st.tz;
    if (!tzs[tz]) tzs[tz] = parts(now, tz);
    const today = tzs[tz];
    for (let i = -2; i <= 8; i++) {
      const dd = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
      const y = dd.getUTCFullYear(), m = dd.getUTCMonth() + 1, d = dd.getUTCDate();
      const wd = ((dd.getUTCDay() + 6) % 7) + 1;
      if (!sh.d.includes(wd)) continue;
      if (sh.nth && Math.ceil(d / 7) !== sh.nth) continue;
      const s = zonedToUtc(y, m, d, ...sh.s.split(':').map(Number), tz);
      let dur = toMin(sh.e) - toMin(sh.s); if (dur <= 0) dur += 1440;
      out.push({sh, st, start: s, end: s + dur * 60000});
    }
  }
  return out;
}

/** The show on a station right now, if the schedule knows it. */
export function nowOn(stationKey, now = Date.now()) {
  return occurrences(new Date(now)).find(o => o.sh.st === stationKey && o.start <= now && now < o.end && !o.sh.drop) || null;
}

let enabled;
try { enabled = JSON.parse(localStorage.getItem('onair.stations') || 'null'); } catch (e) { enabled = null; }
if (!enabled || typeof enabled !== 'object') enabled = {};
for (const k in STATIONS) if (!(k in enabled)) enabled[k] = true;
function save() { try { localStorage.setItem('onair.stations', JSON.stringify(enabled)); } catch (e) {} }
let selDay = null;

function sc(st) { return (isDark() && st.colourDark) || st.colour; }
function mins(ms) { const m = Math.round(ms / 60000); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return r ? h + 'h ' + r + 'm' : h + 'h'; }

function renderFilters() {
  $('oaFilters').innerHTML = Object.entries(STATIONS).map(([k, st]) => `<button class="chip" id="chip-${k}" aria-pressed="${enabled[k]}" data-station="${k}" style="--sc:${sc(st)}"><span class="sw"></span>${esc(st.name)}</button>`).join('');
  $('oaFilters').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { enabled[b.dataset.station] = !enabled[b.dataset.station]; save(); renderFilters(); render(); }));
}

function playBtn(st, label) {
  if (!st.stream || st.webPlay === false) return '';
  return `<button class="btn q" data-k="${esc(Object.keys(STATIONS).find(k => STATIONS[k] === st) || '')}">▶ ${label || 'Play here'}</button>`;
}

function card(o, now) {
  const st = o.st, pct = Math.min(100, Math.max(0, (now - o.start) / (o.end - o.start) * 100));
  const src = st.tz !== PERTH ? ` <span class="num">(${hm(o.start, st.tz)} ${tzName(new Date(o.start), st.tz)})</span>` : '';
  return `<div class="card" style="--sc:${sc(st)}">
    <div class="st"><span class="sw"></span>${esc(st.name)}</div>
    <div class="tm"><span class="rng">${hm(o.start, PERTH)}–${hm(o.end, PERTH)}</span><span class="left">${mins(o.end - now)} left</span></div>
    <div class="nm">${esc(o.sh.n)}</div>
    <div class="nt">${esc(o.sh.m || '')}${src}</div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="acts"><a class="btn p" href="${esc(st.live)}" target="_blank" rel="noopener">Listen live ↗</a>${playBtn(st)}${o.sh.u ? `<a class="btn" href="${esc(o.sh.u)}" target="_blank" rel="noopener">Show page</a>` : ''}${st.stream ? `<button class="btn q" data-copy="${esc(st.stream)}">Copy stream</button>` : ''}</div>
  </div>`;
}
function row(o, now, opts) {
  const st = o.st; const live = o.start <= now && now < o.end, past = o.end <= now;
  const src = st.tz !== PERTH ? `<small class="num">${hm(o.start, st.tz)} ${tzName(new Date(o.start), st.tz)}</small>` : '';
  const dayp = opts && opts.showDay ? `<small>${dayLabel(o.start, PERTH)}</small>` : '';
  return `<div class="row${live ? ' live' : ''}${past ? ' past' : ''}" style="--sc:${sc(st)}">
    <div class="t">${hm(o.start, PERTH)}${dayp}${src}</div>
    <div class="n">${o.sh.u ? `<a href="${esc(o.sh.u)}" target="_blank" rel="noopener">${esc(o.sh.n)}</a>` : esc(o.sh.n)}${o.sh.approx ? ' <span class="num" title="End time assumed">~</span>' : ''}</div>
    <div class="s"><span class="sw"></span>${esc(st.name)}</div>
    ${o.sh.m ? `<div class="m">${esc(o.sh.m)}${o.sh.drop ? '' : ' · until ' + hm(o.end, PERTH)}</div>` : `<div class="m">until ${hm(o.end, PERTH)}</div>`}
  </div>`;
}

export function render() {
  const now = Date.now();
  const occ = occurrences(new Date(now)).filter(o => enabled[o.sh.st]);
  const live = occ.filter(o => o.start <= now && now < o.end && !o.sh.drop).sort((a, b) => a.end - b.end);
  $('onairLive').hidden = !live.length;
  $('now').innerHTML = live.length ? live.map(o => card(o, now)).join('') : `<div class="empty">Nothing you follow is on right now. Next up below.</div>`;
  const next = occ.filter(o => o.start > now && o.start < now + 24 * 3600000).sort((a, b) => a.start - b.start);
  $('next').innerHTML = next.length ? next.map(o => row(o, now, {showDay: true})).join('') : `<div class="empty">Nothing scheduled in the next 24 hours for the stations you have on.</div>`;
  const tp = parts(new Date(now), PERTH);
  if (selDay === null) selDay = tp.wd;
  const daysHtml = []; const dayStarts = {};
  for (let i = 0; i < 7; i++) { const dd = new Date(Date.UTC(tp.y, tp.m - 1, tp.d + i)); const wd = ((dd.getUTCDay() + 6) % 7) + 1; dayStarts[wd] = zonedToUtc(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate(), 0, 0, PERTH); daysHtml.push(`<button role="tab" data-wd="${wd}" aria-pressed="${wd === selDay}">${DAYS[wd]}<span class="d">${dd.getUTCDate()}/${dd.getUTCMonth() + 1}</span></button>`); }
  $('days').innerHTML = daysHtml.join('');
  $('days').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { selDay = +b.dataset.wd; render(); }));
  const ds = dayStarts[selDay], de = ds + 24 * 3600000;
  const week = occ.filter(o => o.start >= ds && o.start < de).sort((a, b) => a.start - b.start);
  $('week').innerHTML = week.length ? week.map(o => row(o, now)).join('') : `<div class="empty">Nothing on this day for the stations you have on.</div>`;
  $('follow').innerHTML = FOLLOW.filter(f => enabled[f.st]).map(f => { const st = STATIONS[f.st]; return `<div class="frow" style="--sc:${sc(st)}"><div class="n"><a href="${esc(f.u)}" target="_blank" rel="noopener">${esc(f.n)}</a></div><div class="c">${esc(f.c)}</div><div class="m">${esc(st.name)} · ${esc(f.m)}</div></div>`; }).join('');
  const streams = Object.entries(STATIONS).filter(([, s]) => s.stream).map(([k, s]) => ({k, name: s.name, stream: s.stream, webPlay: s.webPlay}))
    .concat(EXTRA_STREAMS.map((s, i) => ({...s, x: i})));
  $('streams').innerHTML = streams.map(s => `<div class="srow"><div><div class="n">${esc(s.name)}</div><code>${esc(s.stream)}</code></div><div class="b">${s.webPlay === false ? '' : `<button class="btn q" ${s.k ? `data-k="${s.k}"` : `data-x="${s.x}"`} aria-label="Play ${esc(s.name)}">▶</button>`}<button class="btn q" data-copy="${esc(s.stream)}">Copy</button></div></div>`).join('')
    + `<div class="srow"><div><div class="n">Not playable in the site</div><code>triple j and Double J: these ABC addresses refused every connection when checked on 14 October 2026, so use the ABC listen app or the Listen live link. FluxFM: its secure address hands over to an insecure one, which browsers block; use Listen live or a radio app.</code></div></div>`;
  clocks();
}
function wireOnAir() {
  $('onair').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy) copy(b.dataset.copy);
    else if (b.dataset.k && STATIONS[b.dataset.k]) playStation(b.dataset.k);
    else if (b.dataset.x != null) { const s = EXTRA_STREAMS[+b.dataset.x]; play(s.stream, {title: s.name, sub: 'Live', live: true}); }
  });
}

export function clocks() {
  const now = new Date();
  const p = parts(now, PERTH), l = parts(now, LON), s = parts(now, SYD);
  const two = n => String(n).padStart(2, '0');
  $('clkPerth').textContent = two(p.h) + ':' + two(p.mi);
  $('datePerth').textContent = DAYS[p.wd] + ' ' + p.d + '/' + p.m;
  $('clkLon').textContent = two(l.h) + ':' + two(l.mi); $('zLon').textContent = tzName(now, LON) + ', ' + ((offsetMs(now, PERTH) - offsetMs(now, LON)) / 3600000) + 'h behind';
  $('clkSyd').textContent = two(s.h) + ':' + two(s.mi); $('zSyd').textContent = tzName(now, SYD) + ', ' + ((offsetMs(now, SYD) - offsetMs(now, PERTH)) / 3600000) + 'h ahead';
  $('dstNote').textContent = `Right now London is on ${tzName(now, LON)} and Sydney on ${tzName(now, SYD)}. UK clocks change on the last Sunday of October and March; eastern Australia on the first Sunday of October and April. Every time on this page is recalculated from the station's own clock, so nothing here needs editing when they change.`;
}

let toastT;
function copy(text) {
  const show = msg => { const t = $('toast'); $('toastTxt').textContent = msg; $('toastUndo').hidden = true; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 1800); };
  try { navigator.clipboard.writeText(text).then(() => show('Copied'), () => show('Copy blocked here; select the address and copy it')); } catch (e) { show('Copy blocked here; select the address and copy it'); }
}

let started = false;
export function start() {
  if (started) return; started = true;
  wireOnAir();
  renderFilters(); render();
  setInterval(clocks, 15000);
  setInterval(() => { if (!$('onair').hidden) render(); }, 60000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderFilters(); render(); });
}
