// Bootstrap: load the data, route by hash (#feed, #saved, #source/<id>, #onair), switch tabs.
import {$, wireToast} from './util.js';
import {loadAll} from './data.js';
import {S, render as renderFeed} from './feed.js';
import * as onair from './onair.js';
import {wirePlayer} from './player.js';

const scrollMemo = {};   // remembered scroll positions per view, so Back lands where you were
let current = '';

function parseHash() {
  const h = (location.hash || '#feed').replace(/^#/, '');
  if (h === 'onair') return {tab: 'onair'};
  if (h === 'saved') return {tab: 'feed', view: 'saved'};
  const m = h.match(/^source\/(.+)$/);
  if (m) return {tab: 'feed', view: 'source', srcId: decodeURIComponent(m[1])};
  return {tab: 'feed', view: 'feed'};
}

function route() {
  const r = parseHash();
  const key = r.tab === 'onair' ? 'onair' : r.view === 'source' ? 'source' : r.view;
  if (current) scrollMemo[current] = window.scrollY;
  $('feed').hidden = r.tab !== 'feed'; $('onair').hidden = r.tab !== 'onair';
  $('tabFeed').setAttribute('aria-current', r.tab === 'feed' ? 'page' : 'false');
  $('tabOnair').setAttribute('aria-current', r.tab === 'onair' ? 'page' : 'false');
  $('meta').hidden = r.tab !== 'feed'; $('clocks').hidden = r.tab !== 'onair';
  if (r.tab === 'onair') { $('title').textContent = 'On Air'; onair.start(); onair.render(); }
  else {
    if (r.view === 'source') { if (S.view !== 'source') S.prevView = S.view; S.srcId = r.srcId; }
    else S.srcId = null;
    S.view = r.view; S.limit = 60;
    renderFeed();
  }
  const y = key === 'source' && current !== 'source' ? 0 : (scrollMemo[key] || 0);
  current = key;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

S.onNavigate = hash => { location.hash = hash; };

async function boot() {
  wireToast(); wirePlayer();
  window.addEventListener('hashchange', route);
  try {
    const {bundle, state} = await loadAll();
    S.sources = bundle.sources || []; S.feed = bundle.feed || {}; S.status = bundle.status || null;
    S.paused = new Set(state.paused || []); S.saved = state.saved || {}; S.lastSeen = state.lastSeen || null;
  } catch (e) {
    $('stream').innerHTML = `<div class="empty err">Could not load the feed (${e.message}). If you are offline, the last copy will show once the app has been opened online at least once.</div>`;
    $('meta').textContent = 'Not loaded';
  }
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
