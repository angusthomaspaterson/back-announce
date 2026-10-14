// Bootstrap: load the data, route by hash, switch tabs, and connect the buttons to the store.
// Routes: #feed, #saved, #sources, #source/<id>, #onair.
import {$, wireToast, toast, nowIso} from './util.js';
import {loadAll} from './data.js';
import {S, show as showFeed, render as renderFeed, invalidate, wire as wireFeed, renderMeta, refreshHearts, findSavedKey, savedKey, snapshot, nameOf} from './feed.js';
import * as onair from './onair.js';
import {wirePlayer} from './player.js';
import {createStore} from './store.js';
import {wireSettings} from './settings.js';

const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let store, pagesState = null, lastLoad = 0, lastError = '';
const scrollMemo = {};   // remembered scroll positions per view, so Back lands where you were
const stack = [];        // hashes we navigated away from, so Back stays inside the app
let current = '';

// ---- routing ----
function parseHash() {
  const h = (location.hash || '#feed').replace(/^#/, '');
  if (h === 'onair' || h === 'help') return {tab: h};
  if (h === 'saved' || h === 'sources') return {tab: 'feed', view: h};
  const m = h.match(/^source\/(.+)$/);
  if (m) return {tab: 'feed', view: 'source', srcId: decodeURIComponent(m[1])};
  return {tab: 'feed', view: 'feed'};
}
function route() {
  const r = parseHash(), hash = location.hash || '#feed';
  if (stack.length && stack[stack.length - 1] === hash) stack.pop();   // this was a Back
  const key = r.tab === 'feed' ? r.view : r.tab;
  if (current) scrollMemo[current] = window.scrollY;
  $('feed').hidden = r.tab !== 'feed'; $('onair').hidden = r.tab !== 'onair'; $('help').hidden = r.tab !== 'help';
  $('tabFeed').setAttribute('aria-current', r.tab === 'feed' ? 'page' : 'false');
  $('tabOnair').setAttribute('aria-current', r.tab === 'onair' ? 'page' : 'false');
  $('meta').hidden = r.tab !== 'feed'; $('clocks').hidden = r.tab !== 'onair';
  if (r.tab === 'help') $('title').textContent = 'Help';
  else if (r.tab === 'onair') { $('title').textContent = 'On Air'; onair.start(); onair.render(); }
  else {
    if (r.view === 'source') { if (current !== 'source') S.prevView = current || 'feed'; S.srcId = r.srcId; }
    const lists = v => v === 'feed' || v === 'saved';
    if (lists(r.view) && lists(S.view) && r.view !== S.view) S.limit = 60;
    S.view = r.view;
    showFeed();
  }
  const y = key === 'source' && current !== 'source' ? 0 : (scrollMemo[key] || 0);
  current = key;
  window.scrollTo(0, y);
  requestAnimationFrame(() => window.scrollTo(0, y));
}
S.onNavigate = hash => { const cur = location.hash || '#feed'; if (hash === cur) return; stack.push(cur); location.hash = hash; };
S.onBack = () => {
  if (stack.length) history.back();
  else location.hash = '#' + (S.view === 'source' && ['saved', 'sources'].includes(S.prevView) ? S.prevView : 'feed');
};

function rerender() { if (!$('feed').hidden) renderFeed(); else invalidate(); }

// ---- state from the store ----
function applyState(v) { S.paused = new Set(v.paused || []); S.saved = v.saved || {}; S.lastSeen = v.lastSeen || null; }
function syncFromStore(kind) {
  if (!store.hasToken()) return;
  const st = store.status();
  S.syncError = st.error;
  S.syncNote = !st.error && (st.saving || st.pending) ? 'saving…' : '';
  if (st.error && st.error !== lastError) toast(st.error);
  lastError = st.error;
  if (kind === 'state') {
    const v = store.view();
    const pausedChanged = v.paused.join('|') !== [...S.paused].sort().join('|');
    const seenChanged = v.lastSeen !== S.lastSeen;
    const savedChanged = Object.keys(v.saved).sort().join('|') !== Object.keys(S.saved).sort().join('|');
    applyState(v);
    if (pausedChanged || seenChanged || (savedChanged && S.view === 'saved')) rerender();
    else if (savedChanged) refreshHearts();
  }
  renderMeta();
}

// ---- actions ----
const q = op => store.queue(op);
S.onPause = (ids, off, msg) => {
  ids = ids.filter(id => S.paused.has(id) !== off);
  if (!ids.length) return;
  const label = ids.length === 1 ? nameOf(ids[0]) : `${ids.length} sources`;
  q({t: 'pause', ids, off, msg: `${off ? 'pause' : 'resume'} ${label}`});
  if (msg) toast(msg, () => q({t: 'pause', ids, off: !off, msg: `undo: ${off ? 'resume' : 'pause'} ${label}`}));
};
S.onSave = it => {
  const key = findSavedKey(it);
  if (key) {
    const prev = S.saved[key];
    q({t: 'unsave', key, msg: `unsave "${prev.title}"`});
    toast('Removed from Saved', () => q({t: 'save', key, card: prev, msg: `save "${prev.title}"`}));
  } else {
    const card = snapshot(it), k = savedKey(it);
    q({t: 'save', key: k, card, msg: `save "${card.title}"`});
    toast('Saved', () => q({t: 'unsave', key: k, msg: `unsave "${card.title}"`}));
  }
};
S.onMarkSeen = () => {
  const prev = S.lastSeen;
  q({t: 'seen', at: nowIso(), msg: 'mark all seen'});
  toast('Marked all seen', () => q({t: 'seen', at: prev, msg: 'undo mark all seen'}));
};

// ---- loading ----
async function loadData() {
  const {bundle, state} = await loadAll();
  S.sources = bundle.sources || []; S.feed = bundle.feed || {}; S.status = bundle.status || null;
  pagesState = state; lastLoad = Date.now();
  S.canWrite = store.hasToken();
  if (S.canWrite) { store.seed(state); applyState(store.view()); }
  else applyState(state);
}
async function refreshAll(manual) {
  const b = $('refreshBtn'); b.classList.add('spin'); b.disabled = true;
  try {
    await loadData();
    if (store.hasToken()) await store.refresh();
    rerender();
    if (!$('onair').hidden) onair.render();
    if (manual) toast('Up to date');
  } catch (e) {
    if (manual) toast(`Couldn't refresh: ${e.message}`);
  } finally { b.classList.remove('spin'); b.disabled = false; }
}
async function tokenChanged(has) {
  S.canWrite = has;
  if (has) { store.seed(pagesState || {}); applyState(store.view()); rerender(); await store.refresh(); }
  else { S.syncError = ''; S.syncNote = ''; lastError = ''; applyState(pagesState || {}); rerender(); }
}

async function boot() {
  wireToast(); wirePlayer(); wireFeed();
  const fetchImpl = isLocal && sessionStorage.getItem('ba.mock') === '1' ? (await import('./dev-mock.js')).mockFetch : (...a) => fetch(...a);
  store = createStore({fetchImpl, onChange: syncFromStore});
  wireSettings({store, fetchImpl, onToken: tokenChanged});
  window.addEventListener('hashchange', route);
  $('refreshBtn').addEventListener('click', () => refreshAll(true));
  try { await loadData(); }
  catch (e) {
    $('stream').innerHTML = `<div class="empty err">Could not load the feed (${e.message}). If you are offline, the last copy will show once the app has been opened online at least once.</div>`;
    $('meta').textContent = 'Not loaded';
  }
  route();
  if (store.hasToken()) { store.refresh(); store.flushSoon(); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { store.flush(); return; }
    if (Date.now() - lastLoad > 5 * 60 * 1000) refreshAll(false);
    else if (store.hasToken()) store.refresh();
  });
  window.addEventListener('online', () => store.flush());
  if ('serviceWorker' in navigator) {
    if (isLocal) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    else {
      // When a new version of the app takes over, reload once so it shows straight away.
      // Changes waiting to be sent are kept on the device, so nothing is lost.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true; store.flush(); location.reload();
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
}
boot();
