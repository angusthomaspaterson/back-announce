// The sticky player for episodes and live streams, with lock-screen controls.
//
// - BBC streams are HLS (.m3u8). Chrome plays those through hls.js, loaded on first use
//   from jsDelivr at a pinned version with an integrity check.
// - The site is https, so http stream addresses are upgraded to https before playing.
// - The lock screen (Media Session) shows the episode and source, or for a live stream the
//   station and, where the schedule knows it, the show on now, refreshed every minute.
// - Each episode's place is remembered on this device, so it picks up where it stopped,
//   and one listened to the end is marked played. An Up next queue plays in turn.
import {$, toast, clock} from './util.js';

const HLS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.light.min.js';
const HLS_SRI = 'sha384-GMRZjjumhWPywgLYrubnh5qVhHY0BpD+pxIL57uwAenrOEYDLZ/z+8s/rFIjS+yO';
const SKIP_BACK = 15, SKIP_FWD = 30;
const RATES = [1, 1.25, 1.5, 2, 0.75];
const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

let hls = null, liveTimer = null, current = null, lastPos = 0, lastSaved = 0;

// ---- remembered places, the queue and the speed, kept in this browser ----
const ls = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
let progress = ls.get('ba.progress', {});   // url -> {t: seconds, d: duration, at: ms, done?}
let queue = ls.get('ba.queue', []);          // [{url, title, sub, art}]
let rate = ls.get('ba.rate', 1);
const keyOf = url => String(url || '').replace(/^http:/i, 'https:');
/** Where an episode was left: {t, d, done} or null. */
export function getProgress(url) { return progress[keyOf(url)] || null; }
function remember(url, t, d, done) {
  const k = keyOf(url), p = progress[k] || {};
  progress[k] = {t: Math.floor(t), d: Math.floor(d || p.d || 0), at: Date.now(), ...(done || p.done ? {done: true} : {})};
  const keys = Object.keys(progress);
  if (keys.length > 300) keys.sort((a, b) => progress[a].at - progress[b].at).slice(0, keys.length - 300).forEach(x => delete progress[x]);
  ls.set('ba.progress', progress);
  window.dispatchEvent(new CustomEvent('ba:progress', {detail: {url: k}}));
}
export const inQueue = url => queue.some(q => keyOf(q.url) === keyOf(url));
/** Add an episode to Up next, or play it now when nothing is playing. */
export function enqueue(item) {
  if (!current) { play(item.url, item); return 'playing'; }
  if (inQueue(item.url) || keyOf(item.url) === keyOf(current.url)) return 'already';
  queue.push({url: item.url, title: item.title, sub: item.sub, art: item.art});
  ls.set('ba.queue', queue); showNext();
  return queue.length;
}
function playNext() {
  const n = queue.shift(); ls.set('ba.queue', queue);
  if (n) play(n.url, n); else showNext();
}
function showNext() {
  const n = queue[0];
  $('pNext').hidden = !n || (current && current.live);
  if (n) $('pNextName').textContent = `${n.title}${queue.length > 1 ? ` (+${queue.length - 1} more)` : ''}`;
}

export const isHls = url => /\.m3u8(\?|$)/i.test(url || '');
const secure = url => location.protocol === 'https:' ? String(url).replace(/^http:/i, 'https:') : String(url);

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLS_SRC; s.integrity = HLS_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('Could not load the stream player'));
    document.head.appendChild(s);
  });
}

async function attach(a, url) {
  if (hls) { hls.destroy(); hls = null; }
  if (isHls(url)) {
    const Hls = await loadHls().catch(() => null);
    if (Hls && Hls.isSupported()) {
      hls = new Hls({liveDurationInfinity: true});
      hls.on(Hls.Events.ERROR, (ev, d) => { if (d && d.fatal) failed(); });
      hls.loadSource(url);
      hls.attachMedia(a);
      return;
    }
  }
  a.src = url;   // ordinary audio, or HLS on a browser that plays it natively
}

function failed() {
  toast(current && current.live ? "Couldn't play this station here. Try Listen live." : "Couldn't play this here. Try Open instead.");
}

function label(title, sub) { $('pName').textContent = title || ''; $('pSub').textContent = sub || ''; }

function setSession() {
  if (!ms || !current) return;
  const icon = new URL('icons/icon-512.png', location.href).href;
  const artwork = current.art ? [{src: current.art, sizes: '512x512'}, {src: icon, sizes: '512x512', type: 'image/png'}] : [{src: icon, sizes: '512x512', type: 'image/png'}];
  try {
    ms.metadata = new MediaMetadata({title: current.title || '', artist: current.sub || '', album: current.live ? 'Live' : 'Back Announce', artwork});
    // Skipping makes no sense on a live stream, so those buttons are offered only for episodes.
    const seekable = !current.live;
    ms.setActionHandler('seekbackward', seekable ? d => skip(-(d && d.seekOffset || SKIP_BACK)) : null);
    ms.setActionHandler('seekforward', seekable ? d => skip(d && d.seekOffset || SKIP_FWD) : null);
    ms.setActionHandler('seekto', seekable ? d => { const a = $('audio'); if (d.fastSeek && a.fastSeek) a.fastSeek(d.seekTime); else a.currentTime = d.seekTime; } : null);
  } catch (e) {}
}
function skip(by) { const a = $('audio'); if (isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + by)); }

/** For a live stream, check every minute whether the show has changed. */
function updateLive() {
  if (!current || !current.describe) return;
  const d = current.describe();
  if (d.title === current.title && d.sub === current.sub) return;
  current.title = d.title; current.sub = d.sub;
  label(d.title, d.sub); setSession();
}

/**
 * Play an episode or a stream.
 * info: {title, sub, art, live, describe}; describe() returns {title, sub} for a live stream's current show.
 */
export async function play(url, info = {}) {
  const a = $('audio');
  url = secure(url);
  if (current && !current.live && a.currentTime > 0) remember(current.url, a.currentTime, a.duration);
  current = {url, ...info};
  // Playing something that was queued takes it off the queue.
  if (inQueue(url)) { queue = queue.filter(q => keyOf(q.url) !== keyOf(url)); ls.set('ba.queue', queue); }
  label(info.title, info.sub);
  $('player').hidden = false; document.body.classList.add('has-player');
  $('player').classList.toggle('live', !!info.live);
  showNext();
  clearInterval(liveTimer); liveTimer = null;
  if (info.live && info.describe) liveTimer = setInterval(updateLive, 60000);
  setSession();
  try {
    if (a.dataset.url !== url) {
      await attach(a, url); a.dataset.url = url;
      // Pick up where this episode was left, unless it was finished or barely started.
      const p = !info.live && getProgress(url);
      if (p && !p.done && p.t > 30 && (!p.d || p.t < p.d - 60)) {
        const seek = () => { a.currentTime = p.t; toast(`Picking up at ${clock(p.t)}`); };
        if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, {once: true});
      }
    }
    a.playbackRate = info.live ? 1 : rate;
    await a.play();
  } catch (e) {
    if (e && e.name !== 'AbortError') failed();
  }
}

export function stop() {
  const a = $('audio');
  if (current && !current.live && a.currentTime > 0) remember(current.url, a.currentTime, a.duration);
  a.pause();
  if (hls) { hls.destroy(); hls = null; }
  a.removeAttribute('src'); delete a.dataset.url; a.load();
  clearInterval(liveTimer); liveTimer = null; current = null;
  $('player').hidden = true; document.body.classList.remove('has-player');
  if (ms) { try { ms.metadata = null; ms.playbackState = 'none'; } catch (e) {} }
}

export function wirePlayer() {
  const a = $('audio');
  $('pClose').addEventListener('click', stop);
  a.addEventListener('error', () => { if (current && !hls) failed(); });
  a.addEventListener('play', () => { if (ms) ms.playbackState = 'playing'; });
  a.addEventListener('pause', () => {
    if (ms) ms.playbackState = 'paused';
    if (current && !current.live && a.currentTime > 0) remember(current.url, a.currentTime, a.duration);
  });
  a.addEventListener('ended', () => {
    if (current && !current.live) remember(current.url, a.duration || a.currentTime, a.duration, true);
    if (queue.length) playNext();
  });
  $('pBack').addEventListener('click', () => skip(-SKIP_BACK));
  $('pFwd').addEventListener('click', () => skip(SKIP_FWD));
  $('pRate').textContent = rate + '×';
  $('pRate').addEventListener('click', () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; ls.set('ba.rate', rate);
    $('pRate').textContent = rate + '×';
    if (current && !current.live) a.playbackRate = rate;
  });
  $('pSkip').addEventListener('click', playNext);
  $('pClear').addEventListener('click', () => { queue = []; ls.set('ba.queue', queue); showNext(); toast('Up next cleared'); });
  a.addEventListener('timeupdate', () => {
    // Remember the place every ten seconds; near the end counts as played.
    if (current && !current.live && isFinite(a.duration) && Math.abs(a.currentTime - lastSaved) >= 10) {
      lastSaved = a.currentTime;
      remember(current.url, a.currentTime, a.duration, a.currentTime > a.duration - 90);
    }
    // Keep the lock screen's progress bar honest for episodes, about once every five seconds.
    if (!ms || !ms.setPositionState || !current || current.live || !isFinite(a.duration) || Math.abs(a.currentTime - lastPos) < 5) return;
    lastPos = a.currentTime;
    try { ms.setPositionState({duration: a.duration, playbackRate: a.playbackRate, position: a.currentTime}); } catch (e) {}
  });
  if (ms) {
    try {
      ms.setActionHandler('play', () => a.play());
      ms.setActionHandler('pause', () => a.pause());
      ms.setActionHandler('stop', stop);
    } catch (e) {}
  }
}
