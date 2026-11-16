// Bootstrap: load the data, route by hash, switch tabs, and connect the buttons to the store.
// Routes: #feed, #saved, #sources, #source/<id>, #add, #onair, #help.
import {$, wireToast, toast, nowIso, appIntent, isAndroid} from './util.js';
import {wireAdd, showAdd} from './add.js';
import {loadAll} from './data.js';
import {S, show as showFeed, render as renderFeed, invalidate, wire as wireFeed, renderMeta, refreshHearts, findSavedKey, savedKey, snapshot, nameOf, pickFor, srcItems} from './feed.js';
import * as onair from './onair.js';
import {wirePlayer} from './player.js';
import {createStore} from './store.js';
import {wireSettings} from './settings.js';
import {pausedFor} from './packs.js';
import {encodeSetup, encodeCompact, decodeSetup, setupLink, hash32} from './carry.js';
import {qrSvg} from './qr.js';

const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let store, pagesState = null, lastLoad = 0, lastError = '';
const scrollMemo = {};   // remembered scroll positions per view, so Back lands where you were
const stack = [];        // hashes we navigated away from, so Back stays inside the app
let current = '';

// ---- routing ----
function parseHash() {
  const h = (location.hash || '#feed').replace(/^#/, '');
  if (h === 'onair' || h === 'help') return {tab: h};
  if (h === 'saved' || h === 'picks' || h === 'sources' || h === 'add') return {tab: 'feed', view: h};
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
  $('tagline').hidden = !(r.tab === 'feed' && r.view === 'feed');   // the strapline sits beside the feed's own title
  $('title').classList.toggle('brand', r.tab === 'feed' && r.view === 'feed');   // "Back Announce." with the wordmark's orange full stop
  if (r.tab === 'help') $('title').textContent = 'Help';
  else if (r.tab === 'onair') { $('title').textContent = 'On Air'; onair.start(); onair.render(); }
  else {
    if (r.view === 'source') { if (current !== 'source') S.prevView = current === 'add' ? 'sources' : current || 'feed'; S.srcId = r.srcId; }
    const lists = v => v === 'feed' || v === 'saved' || v === 'picks';
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
  else if (S.view === 'add') location.hash = '#sources';
  else location.hash = '#' + (S.view === 'source' && ['saved', 'sources'].includes(S.prevView) ? S.prevView : 'feed');
};

// ---- add source ----
let sharedLink = null;   // a link shared into the app from another app
const addedHere = [];    // sources added on this device that the published copy doesn't show yet
S.onShowAdd = () => { const p = sharedLink; sharedLink = null; showAdd(p); };
function sourceAdded(entry) {
  if (!S.sources.some(s => s.id === entry.id)) { S.sources = [...S.sources, entry]; addedHere.push(entry); }
  invalidate();
  toast(`Added ${entry.name}. Its episodes arrive in a few minutes.`);
  location.replace('#source/' + encodeURIComponent(entry.id));
  // GitHub gathers the new source straight away, then republishes; look again twice.
  setTimeout(() => refreshAll(false), 150000);
  setTimeout(() => refreshAll(false), 300000);
}

function rerender() { if (!$('feed').hidden) renderFeed(); else invalidate(); }

// ---- state from the store ----
function applyState(v) { S.paused = new Set(v.paused || []); S.saved = v.saved || {}; S.lastSeen = v.lastSeen || null; }
function syncFromStore(kind) {
  if (store.hasToken()) {
    const st = store.status();
    S.syncError = st.error;
    S.syncNote = !st.error && (st.saving || st.pending) ? 'saving…' : '';
    if (st.error && st.error !== lastError) toast(st.error);
    lastError = st.error;
  }
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

// ---- Angus's picks: a public list, built one card at a time, each with a note ----
// Owner only. Picks live in data/picks.json in the repository, apart from the Saved list.
let picksEditedAt = 0, picking = null;
const PICKS_FILE = 'data/picks.json', PICKS_KEPT = 40;
S.onPick = it => {
  picking = it;
  const cur = pickFor(it);
  $('pickWhat').textContent = `${it.title} (${it.sname})`;
  $('pickNote').value = cur ? cur.note || '' : '';
  $('pickSave').textContent = cur ? 'Update pick' : 'Save pick';
  $('pickRemove').hidden = !cur;
  $('pickStatus').textContent = '';
  $('pickDlg').showModal();
  $('pickNote').focus();
};
async function writePick(remove) {
  const it = picking; if (!it) return;
  const key = savedKey(it), note = $('pickNote').value.trim();
  const entry = {key, note, pickedAt: (pickFor(it) || {}).pickedAt || nowIso(), card: snapshot(it)};
  delete entry.card.savedAt;
  const btns = [$('pickSave'), $('pickRemove')]; btns.forEach(b => { b.disabled = true; });
  $('pickStatus').textContent = 'Saving…';
  try {
    const doc = await store.files.edit(PICKS_FILE, cur => {
      const rest = (Array.isArray(cur.items) ? cur.items : []).filter(p => p.key !== key);
      return {...cur, items: (remove ? rest : [entry, ...rest]).slice(0, PICKS_KEPT)};
    }, remove ? `picks: remove "${it.title}"`.slice(0, 72) : `picks: add "${it.title}"`.slice(0, 72));
    S.picks = doc.items; picksEditedAt = Date.now();
    $('pickDlg').close();
    rerender();
    toast(remove ? 'Removed from your picks' : 'Added to your picks. Visitors see it in a minute or two.');
  } catch (e) {
    $('pickStatus').textContent = `Couldn't save the pick (${e.status || 'offline'}). Try again.`;
  } finally { btns.forEach(b => { b.disabled = false; }); }
}

// ---- sharing: a card, the shows you follow, or your whole setup, as a link ----
async function shareOrCopy(title, text, url) {
  // Phones offer their share sheet; elsewhere the link is copied.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({title, text, url}); } catch (e) {} return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch (e) { window.prompt('Copy this link:', url); }
}
S.onShareCard = it => shareOrCopy(it.title, `${it.title} (${it.sname})`, it.url);
S.onShareSetup = async kind => {
  const state = {paused: [...S.paused], saved: S.saved, lastSeen: S.lastSeen};
  const link = setupLink(await encodeSetup(state, S.sources.map(s => s.id), kind));
  const n = S.sources.length - S.sources.filter(s => S.paused.has(s.id)).length;
  if (kind !== 'setup') { await shareOrCopy('My Back Announce feed', `The ${n} shows I follow on Back Announce.`, link); return; }
  // To another device: a QR code for the other phone's camera, and the link for everything else.
  const compact = encodeCompact(state, S.sources.map(s => s.id));
  const forQr = compact ? setupLink(compact) : link;
  const saved = Object.keys(S.saved).length;
  carryLinkText = link;
  $('carryWhat').textContent = `Your ${n} shows${saved ? ` and ${saved} saved card${saved === 1 ? '' : 's'}` : ''}.`;
  try { $('carryQr').innerHTML = qrSvg(forQr); $('carryQr').hidden = false; }
  catch (e) { $('carryQr').hidden = true; }   // too much for one code: the link still works
  $('carryScan').hidden = $('carryQr').hidden;
  $('carryDlg').showModal();
};
let carryLinkText = '';
/** A #setup= link was opened: read it and ask before changing anything. */
async function readIncoming(code) {
  if (S.owner) { toast('Setup links are for devices without a token. Nothing was changed.'); return; }
  try {
    const i = await decodeSetup(code, S.sources.map(s => s.id));
    // A QR code names saved cards only by fingerprint: rebuild each from this device's copy of the feed.
    for (const ref of i.savedRefs || []) {
      const it = srcItems(ref.sid).find(x => x.id && hash32(x.id) === ref.item);
      if (it) i.saved[savedKey(it)] = snapshot(it);
    }
    if (i.savedRefs) i.missing = i.savedCount - Object.keys(i.saved).length;
    S.incoming = i;
  } catch (e) { toast("That link couldn't be read. Ask for it to be sent again."); }
}
S.onIncoming = yes => {
  const i = S.incoming; S.incoming = null;
  if (yes && i) {
    const cur = store.view();
    store.setLocal(i.kind === 'setup' ? {paused: i.paused, saved: {...cur.saved, ...i.saved}, lastSeen: i.lastSeen || cur.lastSeen}
      : {...cur, paused: i.paused});
    try { localStorage.setItem('ba.welcomed', '1'); } catch (e) {}
    S.welcome = false;
    toast(i.kind === 'setup' ? 'Your setup is on this device now.' : `You're now following those ${i.following} shows.`);
  }
  rerender();
  window.scrollTo(0, 0);
};

// ---- loading ----
async function loadData() {
  const {bundle, state, picks} = await loadAll();
  S.sources = bundle.sources || []; S.feed = bundle.feed || {}; S.status = bundle.status || null;
  // Picks changed on this device are newer than the published copy for a minute or two.
  if (!picksEditedAt || Date.now() - picksEditedAt > 5 * 60 * 1000) S.picks = picks;
  // Keep sources added on this device until the published copy includes them.
  for (let i = addedHere.length - 1; i >= 0; i--) {
    if (S.sources.some(s => s.id === addedHere[i].id)) addedHere.splice(i, 1);
    else S.sources = [...S.sources, addedHere[i]];
  }
  pagesState = state; lastLoad = Date.now();
  // Everyone can save, pause and mark seen. With a token that is Angus's own state in the
  // repository; without one it is the visitor's own copy, kept in this browser.
  S.owner = store.hasToken(); S.canWrite = true;
  S.ownerPaused = Array.isArray(state.paused) ? state.paused : [];
  store.seed(state); applyState(store.view());
  S.welcome = !S.owner && !welcomed();
}
/** Help and Settings show different parts to the owner and to a visitor (see .owner-only, .visitor-only). */
function setMode() { document.body.dataset.mode = store.hasToken() ? 'owner' : 'visitor'; }
/** Settings, Start again: back to Angus's selection and the welcome panel. Saved cards stay. */
function startAgain() {
  if (store.hasToken()) return;
  store.setLocal({...store.view(), paused: S.ownerPaused});
  try { localStorage.removeItem('ba.welcomed'); } catch (e) {}
  S.welcome = true; S.packPick.clear();
  if (location.hash !== '#feed') location.hash = '#feed';
  rerender();
  window.scrollTo(0, 0);
}
// The first-visit panel shows until the visitor picks a starting point, once per device.
const welcomed = () => { try { return localStorage.getItem('ba.welcomed') === '1'; } catch (e) { return true; } };
S.onWelcome = packs => {
  if (packs.length) store.setLocal({...store.view(), paused: pausedFor(packs, S.sources, S.ownerPaused)});
  try { localStorage.setItem('ba.welcomed', '1'); } catch (e) {}
  S.welcome = false; S.packPick.clear();
  rerender();
  window.scrollTo(0, 0);
  toast(packs.length ? 'Your feed is ready. Change it any time under Sources.' : "You're following Angus's whole feed. Change it any time under Sources.");
};
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
  S.owner = has; S.canWrite = true; setMode();
  S.welcome = !has && !welcomed();
  if (!has) { S.syncError = ''; S.syncNote = ''; lastError = ''; }
  store.seed(pagesState || {}); applyState(store.view()); rerender();
  if (has) await store.refresh();
}

async function boot() {
  wireToast(); wirePlayer(); wireFeed();
  const fetchImpl = isLocal && sessionStorage.getItem('ba.mock') === '1' ? (await import('./dev-mock.js')).mockFetch : (...a) => fetch(...a);
  store = createStore({fetchImpl, onChange: syncFromStore});
  wireSettings({store, fetchImpl, onToken: tokenChanged, onShare: kind => S.onShareSetup(kind), onReset: startAgain});
  setMode();
  wireAdd({store, added: sourceAdded});
  // A link shared from another app arrives as ?url=… or ?text=… (see share_target in the manifest).
  const qs = new URLSearchParams(location.search);
  const shared = qs.get('url') || qs.get('text') || qs.get('title');
  if (shared) { sharedLink = shared; history.replaceState(null, '', location.pathname + '#add'); }
  // A feed or a whole setup carried in the address (see carry.js).
  const setup = (location.hash.match(/^#setup=(.+)$/) || [])[1];
  if (setup) history.replaceState(null, '', location.pathname + '#feed');
  // On Android, SoundCloud and Mixcloud links open in their apps.
  if (isAndroid()) document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    const intent = a && appIntent(a.href);
    if (!intent) return;
    e.preventDefault();
    location.href = intent;
  }, true);
  window.addEventListener('hashchange', async () => {
    const m = location.hash.match(/^#setup=(.+)$/);   // a setup link opened while the app is already open
    if (m) { history.replaceState(null, '', location.pathname + '#feed'); await readIncoming(m[1]); }
    route();
  });
  $('refreshBtn').addEventListener('click', () => refreshAll(true));
  $('pickSave').addEventListener('click', () => writePick(false));
  $('pickRemove').addEventListener('click', () => writePick(true));
  $('pickDlg').addEventListener('click', e => { if (e.target === $('pickDlg')) $('pickDlg').close(); });
  $('carryDlg').addEventListener('click', e => { if (e.target === $('carryDlg')) $('carryDlg').close(); });
  $('carryCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(carryLinkText); $('carryStatus').textContent = 'Link copied. Send it to yourself and open it on the other device.'; }
    catch (e) { window.prompt('Copy this link:', carryLinkText); }
  });
  try { await loadData(); }
  catch (e) {
    $('stream').innerHTML = `<div class="empty err">Could not load the feed (${e.message}). If you are offline, the last copy will show once the app has been opened online at least once.</div>`;
    $('meta').textContent = 'Not loaded';
  }
  if (setup && S.sources.length) await readIncoming(setup);
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
