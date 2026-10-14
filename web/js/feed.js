// The Feed tab: the timeline, the Saved view, the Source page and the Sources screen.
// Each view has its own container, so going to a source and back leaves the feed exactly
// where it was. Clicks are handled by delegation, so containers can be re-rendered freely.
import {$, esc, gcol, initials, addedLabel, kindLabel, BATCHES, dfmt, dkey, sfmt, tfmt, rel, dur, dateOk, nowIso, spotifySearch} from './util.js';
import {play} from './player.js';

export const S = {
  sources: [],          // the source list from data/sources.json
  feed: {},             // id -> {id,name,kind,home,updatedAt,items,linkOnly?}
  status: null,         // data/status.json
  paused: new Set(),
  saved: {},            // key -> full copy of a card
  lastSeen: null,
  groups: {},           // group -> shown? (kept on this device)
  srcView: 'all',       // Sources screen filter: all | on | off
  view: 'feed',         // feed | saved | source | sources
  prevView: 'feed',
  srcId: null,
  limit: 60,
  canWrite: false,
  syncNote: '', syncError: '',
  // set by app.js
  onNavigate: null, onBack: null, onPause: null, onSave: null, onMarkSeen: null, onShowAdd: null,
};
try { S.groups = JSON.parse(localStorage.getItem('ba.groups') || '{}') || {}; } catch (e) {}
function saveLocal() { try { localStorage.setItem('ba.groups', JSON.stringify(S.groups)); } catch (e) {} }

export function cfgFor(id) { return S.sources.find(s => s.id === id) || null; }
export function nameOf(id) { const c = cfgFor(id), d = S.feed[id]; return (c && c.name) || (d && d.name) || id; }
function groupOf(id) { const c = cfgFor(id); return (c && c.group) || 'Other'; }
function sourceList() { return S.sources.length ? S.sources : Object.keys(S.feed).map(id => ({id, name: S.feed[id].name, home: S.feed[id].home})); }

function withSource(it, id) {
  const d = S.feed[id] || {}, c = cfgFor(id) || {};
  return {...it, sid: id, sname: nameOf(id), group: groupOf(id), home: d.home || c.home || ''};
}
function linkOnlyCard(id) {
  const d = S.feed[id] || {}, c = cfgFor(id) || {};
  return withSource({id: 'linkonly', title: `Open ${nameOf(id)}`, url: d.home || c.home || '', date: d.updatedAt || null,
    desc: 'The site would not let the gatherer read this page, so there is nothing to show here yet. Open it directly; the next refresh tries again.', linkOnly: true}, id);
}
export function allItems() {
  const out = [];
  for (const id of Object.keys(S.feed)) {
    if (S.paused.has(id)) continue;
    const d = S.feed[id];
    if (d.linkOnly && !(d.items || []).length) { out.push(linkOnlyCard(id)); continue; }
    for (const it of (d.items || [])) out.push(withSource(it, id));
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}
export function srcItems(id) {
  const d = S.feed[id] || {};
  const out = (d.items || []).map(it => withSource(it, id));
  if (d.linkOnly && !out.length) out.push(linkOnlyCard(id));
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}

// ---- saved cards ----
export const savedKey = it => it.sid + ':' + (it.id || it.url || '');
/** The key this item is saved under, if it is saved (including keys from the old version). */
export function findSavedKey(it) {
  if (it._key && S.saved[it._key]) return it._key;
  const k = savedKey(it);
  if (S.saved[k]) return k;
  for (const [kk, v] of Object.entries(S.saved)) {
    if (v.sid === it.sid && ((it.id && v.id === it.id) || (it.url && v.url === it.url))) return kk;
  }
  return null;
}
/** A full copy of a card, so it survives the item leaving its source's newest 25. */
export function snapshot(it) {
  const d = {sid: it.sid, sname: it.sname, group: it.group, id: it.id || '', title: it.title || '', url: it.url || '', date: it.date || null, desc: it.desc || '', savedAt: nowIso()};
  for (const k of ['image', 'audio', 'tags', 'location', 'duration', 'home']) if (it[k]) d[k] = String(it[k]);
  if (Array.isArray(it.links) && it.links.length) d.links = it.links.map(l => ({t: String(l.t || ''), u: String(l.u || '')}));
  return d;
}
function savedList() {
  return Object.entries(S.saved).map(([k, v]) => ({...v, _key: k})).sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));
}

/**
 * Where to find this item in Spotify: podcast episodes (audio from a podcast feed, not
 * SoundCloud) are searched as "show name + episode title", and releases from a release
 * schedule (upcoming: true) by "artist + title". Mixes, radio and writing are left out.
 */
function spotifyLink(it) {
  if (it.linkOnly) return null;
  const c = cfgFor(it.sid) || {};
  if (c.upcoming) return spotifySearch(it.title);
  const feed = c.url || '';
  if (it.audio && c.kind === 'rss' && !/soundcloud\.com/i.test(feed + ' ' + it.audio)) return spotifySearch(`${it.sname} ${it.title}`);
  return null;
}

// ---- cards ----
const cardMap = new Map();   // data-save key -> item, for the click handler
function heartInner(saved) { return `<span aria-hidden="true">${saved ? '♥' : '♡'}</span>${saved ? 'Saved' : 'Save'}`; }
function card(it, mode) {
  const inSaved = mode === 'saved', inSrc = mode === 'source';
  const key = it._key || savedKey(it);
  cardMap.set(key, it);
  const saved = inSaved || findSavedKey(it) !== null;
  const isNew = !inSaved && !it.linkOnly && dateOk(it.date) && (!S.lastSeen || it.date > S.lastSeen);
  const tags = [it.tags, it.location, dur(it.duration)].filter(Boolean).join(' · ');
  const square = /sndcdn|ntslive|podbean|mixcloud|bcbits/.test(it.image || '');
  const links = (it.links || []).map(l => `<a href="${esc(l.u)}" target="_blank" rel="noopener">↗ ${esc(l.t)}</a>`).join('');
  const when = inSaved ? it.savedAt : it.date;
  const heart = S.canWrite && !it.linkOnly ? `<button class="btn heart" data-save="${esc(key)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from Saved' : 'Save'}">${heartInner(saved)}</button>` : '';
  const audio = it.audio ? `<button class="btn" data-play="${esc(it.audio)}" data-name="${esc(it.title)}" data-sub="${esc(it.sname)}" data-art="${esc(it.image || '')}">▶ Play</button>` : '';
  const sp = spotifyLink(it);
  const spotify = sp ? `<a class="btn spot" href="${esc(sp)}" target="_blank" rel="noopener" title="Search Spotify for this">Spotify ↗</a>` : '';
  const pause = S.canWrite && !inSaved && !inSrc ? `<button class="btn q" data-pause="${esc(it.sid)}" title="Hide this source until you switch it back on">Pause source</button>` : '';
  return `<article class="card${it.linkOnly ? ' linkonly' : ''}" style="--sc:${gcol(it.group)}">
    <div class="who"><button class="srcbtn" data-src="${esc(it.sid)}" ${inSrc ? 'disabled' : ''} aria-label="See recent posts from ${esc(it.sname)}"><span class="av" aria-hidden="true">${esc(initials(it.sname))}</span>
      <span class="who-t"><span class="nm">${esc(it.sname)}${inSrc ? '' : ' <span class="go" aria-hidden="true">›</span>'}</span><span class="sub">${esc(it.group)}${inSaved && dateOk(it.date) ? ' · ' + esc(sfmt.format(new Date(it.date))) : ''}</span></span></button>
      <div class="t">${isNew ? '<span class="new">New</span>' : ''}${dateOk(when) ? esc(tfmt.format(new Date(when))) + '<br>' + esc(rel(when)) : ''}</div></div>
    <div class="ttl"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
    ${it.desc ? `<div class="txt" title="Tap to expand">${esc(it.desc)}</div>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}
    ${it.image ? `<a class="pic${square ? ' sq' : ''}" href="${esc(it.url)}" target="_blank" rel="noopener"><img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
    <div class="acts"><a class="btn p" href="${esc(it.url)}" target="_blank" rel="noopener">Open ↗</a>${heart}${audio}${spotify}${pause}${tags ? `<span class="tag">${esc(tags)}</span>` : ''}</div>
  </article>`;
}
function dayList(list, mode, limit) {
  let html = '', lastDay = '';
  for (const it of list.slice(0, limit)) {
    const when = mode === 'saved' ? it.savedAt : it.date;
    const day = dateOk(when) ? dkey.format(new Date(when)) : 'undated';
    if (day !== lastDay) { lastDay = day; html += `<div class="day"><span>${dateOk(when) ? (mode === 'saved' ? 'Saved ' : '') + esc(dfmt.format(new Date(when))) : 'Undated'}</span><span class="rule"></span></div>`; }
    html += card(it, mode);
  }
  return html;
}
const empty = msg => `<div class="empty">${msg}</div>`;

// ---- what is on screen ----
let rendered = {stream: null, src: null, sources: false};
/** Forget what each container shows, so the next show() redraws the visible one. */
export function invalidate() { rendered = {stream: null, src: null, sources: false}; cardMap.clear(); }
/** Redraw everything visible. */
export function render() { invalidate(); show(); }
/** Show the current view, redrawing a container only if it is out of date. */
export function show() {
  const v = S.view, items = allItems(), saved = savedList();
  const listView = v === 'feed' || v === 'saved';
  $('filters').hidden = !listView; $('stream').hidden = !listView;
  $('srcHead').hidden = v !== 'source'; $('srcPage').hidden = v !== 'source';
  $('sourcesView').hidden = v !== 'sources';
  $('addView').hidden = v !== 'add';
  if (v === 'add') { S.onShowAdd(); renderMeta(items); return; }
  if (listView) {
    $('title').textContent = v === 'saved' ? 'Saved' : 'Back Announce';
    renderFilters(items, saved);
    if (rendered.stream !== v) { renderStream(items, saved); rendered.stream = v; }
  } else if (v === 'source') {
    renderSrcHead();
    if (rendered.src !== S.srcId) { renderSrcPage(); rendered.src = S.srcId; }
  } else if (v === 'sources') {
    $('title').textContent = 'Sources';
    if (!rendered.sources) { renderSources(); rendered.sources = true; }
  }
  renderMeta(items);
}

function renderFilters(items, saved) {
  const inSaved = S.view === 'saved', W = S.canWrite;
  const pool = inSaved ? saved : items;
  const groups = [...new Set(items.map(i => i.group).concat(saved.map(i => i.group)))].sort();
  for (const g of groups) if (!(g in S.groups)) S.groups[g] = true;
  const counts = {}; for (const i of pool) counts[i.group] = (counts[i.group] || 0) + 1;
  const newCount = countNew(items);
  $('filters').innerHTML = `<button class="chip heartchip" id="savedView" aria-pressed="${inSaved}"><span class="hrt" aria-hidden="true">${inSaved ? '♥' : '♡'}</span>Saved <span class="cnt">${saved.length}</span></button>`
    + groups.filter(g => counts[g]).map(g => `<button class="chip" data-g="${esc(g)}" aria-pressed="${S.groups[g]}" style="--sc:${gcol(g)}"><span class="sw"></span>${esc(g)} <span class="cnt">${counts[g]}</span></button>`).join('')
    + (inSaved || !W ? '' : `<button class="chip act" id="markSeen">Mark all seen${newCount ? ' (' + newCount + ')' : ''}</button>`)
    + `<button class="chip src${inSaved || !W ? ' act' : ''}" id="openSrc">Sources${S.paused.size ? ' · ' + S.paused.size + ' paused' : ''}</button>`;
}
function countNew(items) { return items.filter(i => !i.linkOnly && dateOk(i.date) && (!S.lastSeen || i.date > S.lastSeen)).length; }

function renderStream(items, saved) {
  const inSaved = S.view === 'saved';
  const pool = inSaved ? saved : items;
  const vis = pool.filter(i => S.groups[i.group] !== false);
  let html;
  if (inSaved && !saved.length) html = empty('Nothing saved yet. Tap the heart on any card to keep it here. Saved cards stay even after the show drops out of the feed.');
  else if (!pool.length) html = empty('Nothing gathered yet. The first run fills this in; after that it refreshes once a day.');
  else if (!vis.length) html = empty('Every group is switched off. Tap a chip above to bring one back.');
  else {
    html = dayList(vis, inSaved ? 'saved' : 'feed', S.limit);
    if (vis.length > S.limit) html += `<button class="more" id="more">Show ${Math.min(60, vis.length - S.limit)} more of ${vis.length}</button>`;
  }
  $('stream').innerHTML = html;
}

function renderSrcHead() {
  const id = S.srcId, cfg = cfgFor(id) || {}, doc = S.feed[id] || {};
  const name = cfg.name || doc.name || id, group = cfg.group || 'Other', home = doc.home || cfg.home || '';
  const off = S.paused.has(id), ss = (S.status && S.status.sources && S.status.sources[id]) || {};
  const host = home ? home.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  const real = srcItems(id).filter(i => !i.linkOnly);
  const back = S.prevView === 'saved' ? 'Saved' : S.prevView === 'sources' ? 'Sources' : 'the feed';
  $('title').textContent = name;
  const h = $('srcHead'); h.style.setProperty('--sc', gcol(group));
  h.innerHTML = `<button class="chip back" id="srcBack">‹ Back to ${back}</button>
    <div class="sh"><div class="av" aria-hidden="true">${esc(initials(name))}</div><div class="shi"><div class="sub">${esc(group)}${cfg.kind ? ' · ' + esc(kindLabel(cfg.kind)) : ''}${cfg.added ? ' · ' + esc(addedLabel(cfg.added)) : ''}</div>
      <div class="sub">${real.length} ${real.length === 1 ? 'post' : 'posts'}${real[0] && dateOk(real[0].date) ? ', latest ' + esc(sfmt.format(new Date(real[0].date))) : ''}${ss.ok === false ? ' · <span class="bad">' + (ss.linkOnly ? 'site refuses the gatherer' : 'last fetch failed') + '</span>' : ''}${off ? ' · paused' : ''}</div></div></div>
    <div class="acts">${home ? `<a class="btn" href="${esc(home)}" target="_blank" rel="noopener">Visit ${esc(host.length > 28 ? 'site' : host)} ↗</a>` : ''}${S.canWrite ? `<button class="btn${off ? ' p' : ''}" id="srcPause">${off ? 'Resume source' : 'Pause source'}</button>` : ''}</div>`;
}
function renderSrcPage() {
  const items = srcItems(S.srcId);
  $('srcPage').innerHTML = items.length ? dayList(items, 'source', 999)
    : empty('Nothing gathered from this source yet. A source you have just added fills in within a few minutes: press Refresh. Otherwise it is checked once a day.');
}

function renderSources() {
  const st = S.status, P = S.paused, W = S.canWrite, all = sourceList();
  const total = all.length, nP = all.filter(s => P.has(s.id)).length;
  const start = all.filter(s => s.added === 'start'), extra = all.filter(s => s.added && s.added !== 'start');
  const extraOn = extra.filter(s => !P.has(s.id)).length;
  const batches = Object.keys(BATCHES).map(k => ({k, label: BATCHES[k], list: all.filter(s => s.added === k)})).filter(b => b.list.length);
  const views = [['all', 'All ' + total], ['on', 'Following ' + (total - nP)], ['off', 'Paused ' + nP]];
  $('mng').innerHTML = `${W ? '<button class="btn p addbtn" id="openAdd">+ Add source</button>' : ''}<div class="sum"><b>${total - nP}</b> of ${total} sources in the feed.${W ? ' Switch any off to pause it; switch it back on whenever you like.' : ' Add a GitHub token in Settings to pause and resume sources from here.'}${S.syncError ? ` <span class="bad">${esc(S.syncError)}</span>` : ''}</div>
    <div class="row">${views.map(([k, l]) => `<button class="chip" data-view="${k}" aria-pressed="${S.srcView === k}">${esc(l)}</button>`).join('')}</div>
    ${W ? `<div class="row">${start.length && extraOn ? `<button class="btn" id="slim">Keep only my original ${start.length}</button>` : ''}${batches.map(b => {
      const on = b.list.filter(s => !P.has(s.id)).length;
      return (on ? `<button class="btn" data-batch="${b.k}" data-to="off">Pause the ${b.list.length} added ${esc(b.label)}</button>` : '')
        + (on < b.list.length ? `<button class="btn" data-batch="${b.k}" data-to="on">Bring back the ${b.list.length} added ${esc(b.label)}</button>` : '');
    }).join('')}${nP ? `<button class="btn q" id="resumeAll">Resume everything</button>` : ''}</div>` : ''}`;
  const groups = {};
  for (const s of all) (groups[s.group || 'Other'] = groups[s.group || 'Other'] || []).push(s);
  let html = '';
  for (const g of Object.keys(groups).sort()) {
    const list = groups[g].filter(s => S.srcView === 'all' || (S.srcView === 'on' ? !P.has(s.id) : P.has(s.id)));
    if (!list.length) continue;
    const gOn = groups[g].filter(s => !P.has(s.id)).length;
    html += `<div class="sgh" style="--sc:${gcol(g)}"><h3><span class="sw"></span>${esc(g)}</h3><span class="c">${gOn}/${groups[g].length} on</span>${W ? `<button class="btn" data-grp="${esc(g)}" data-to="${gOn ? 'off' : 'on'}">${gOn ? 'Pause group' : 'Resume group'}</button>` : ''}</div>`;
    html += list.map(s => {
      const ss = (st && st.sources && st.sources[s.id]) || {}, doc = S.feed[s.id], off = P.has(s.id);
      const newest = doc && doc.items && doc.items[0] && doc.items[0].date;
      const stTxt = ss.linkOnly ? 'link only' : ss.ok === false ? 'failed' : ss.ok === true || doc ? (dateOk(newest) ? sfmt.format(new Date(newest)) : 'no items') : 'pending';
      return `<div class="srow${off ? ' off' : ''}${W ? '' : ' ro'}" style="--sc:${gcol(g)}">${W ? `<button class="tg" role="switch" aria-checked="${!off}" aria-label="${esc(s.name)}" data-sid="${esc(s.id)}"></button>` : ''}<div class="n"><button class="srclink" data-src="${esc(s.id)}">${esc(s.name)}</button></div><div class="st${ss.ok === false && !ss.linkOnly ? ' bad' : ''}" title="${esc(ss.error || '')}">${esc(stTxt)}</div><div class="m">${esc(addedLabel(s.added))}${s.kind ? ' · ' + esc(kindLabel(s.kind)) : ''}${off ? ' · paused' : ''}</div></div>`;
    }).join('');
  }
  $('sources').innerHTML = html || empty('Nothing here.');
}

export function renderMeta(items = allItems()) {
  const newCount = countNew(items);
  const fn = $('feedNew'); fn.textContent = newCount > 99 ? '99+' : String(newCount); fn.hidden = !newCount;
  const st = S.status, last = st && dateOk(st.lastRun) ? new Date(st.lastRun) : null;
  const bad = st ? Object.values(st.sources || {}).filter(s => s.ok === false && !s.linkOnly).length : 0;
  const total = Object.keys(S.feed).length, pausedHere = [...S.paused].filter(id => S.feed[id]).length;
  const sync = !S.canWrite ? ' · read only' : S.syncError ? ` · <span class="bad" title="${esc(S.syncError)}">not saved</span>` : S.syncNote ? ` · ${esc(S.syncNote)}` : '';
  $('meta').innerHTML = (last ? `Updated ${esc(dfmt.format(last))} ${esc(tfmt.format(last))}` : 'No run yet')
    + `<br>${items.length} items · ${total - pausedHere} of ${total} sources${bad ? ` · <span class="bad">${bad} failing</span>` : ''}${sync}`;
}

/** After a save or unsave, update the hearts in place instead of redrawing the cards. */
export function refreshHearts() {
  for (const b of document.querySelectorAll('#stream [data-save], #srcPage [data-save]')) {
    const it = cardMap.get(b.dataset.save);
    if (!it) continue;
    const saved = findSavedKey(it) !== null;
    b.setAttribute('aria-pressed', saved);
    b.setAttribute('aria-label', saved ? 'Remove from Saved' : 'Save');
    b.innerHTML = heartInner(saved);
  }
  const c = document.querySelector('#savedView .cnt'); if (c) c.textContent = Object.keys(S.saved).length;
}

/** One-time event wiring for every container. */
export function wire() {
  const cards = e => {
    const t = e.target.closest('button, .txt');
    if (!t) return;
    if (t.classList.contains('txt')) {
      t.classList.toggle('open');
      const l = t.parentElement.querySelector('.links'); if (l) l.classList.toggle('open', t.classList.contains('open'));
    } else if (t.dataset.save != null) { const it = cardMap.get(t.dataset.save); if (it) S.onSave(it); }
    else if (t.dataset.pause) S.onPause([t.dataset.pause], true, `Paused ${nameOf(t.dataset.pause)}`);
    else if (t.dataset.play) play(t.dataset.play, {title: t.dataset.name, sub: t.dataset.sub, art: t.dataset.art || ''});
    else if (t.dataset.src && !t.disabled) S.onNavigate('#source/' + encodeURIComponent(t.dataset.src));
    else if (t.id === 'more') { S.limit += 60; rendered.stream = null; show(); }
  };
  const broken = e => { if (e.target.tagName === 'IMG') { const p = e.target.closest('.pic'); if (p) p.classList.add('gone'); } };
  for (const id of ['stream', 'srcPage']) { $(id).addEventListener('click', cards); $(id).addEventListener('error', broken, true); }

  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.g) { S.groups[b.dataset.g] = !S.groups[b.dataset.g]; saveLocal(); rendered.stream = null; show(); }
    else if (b.id === 'savedView') S.onNavigate(S.view === 'saved' ? '#feed' : '#saved');
    else if (b.id === 'markSeen') S.onMarkSeen();
    else if (b.id === 'openSrc') S.onNavigate('#sources');
  });

  $('srcHead').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'srcBack') S.onBack();
    else if (b.id === 'srcPause') { const id = S.srcId, off = S.paused.has(id); S.onPause([id], !off, `${off ? 'Resumed' : 'Paused'} ${nameOf(id)}`); }
  });

  $('sourcesView').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const P = S.paused, all = sourceList();
    if (b.id === 'sourcesBack') S.onBack();
    else if (b.id === 'openAdd') S.onNavigate('#add');
    else if (b.dataset.view) { S.srcView = b.dataset.view; rendered.sources = false; show(); }
    else if (b.id === 'slim') { const ids = all.filter(s => s.added && s.added !== 'start' && !P.has(s.id)).map(s => s.id); S.onPause(ids, true, `Paused ${ids.length} sources`); }
    else if (b.dataset.batch) { const off = b.dataset.to === 'off'; const ids = all.filter(s => s.added === b.dataset.batch && P.has(s.id) !== off).map(s => s.id); S.onPause(ids, off, `${off ? 'Paused' : 'Resumed'} ${ids.length} sources`); }
    else if (b.id === 'resumeAll') { const ids = [...P]; S.onPause(ids, false, `Resumed ${ids.length} sources`); }
    else if (b.dataset.sid) S.onPause([b.dataset.sid], b.getAttribute('aria-checked') === 'true', null);
    else if (b.dataset.grp) { const off = b.dataset.to === 'off'; const ids = all.filter(s => (s.group || 'Other') === b.dataset.grp && P.has(s.id) !== off).map(s => s.id); S.onPause(ids, off, `${off ? 'Paused' : 'Resumed'} ${b.dataset.grp} (${ids.length})`); }
    else if (b.dataset.src) S.onNavigate('#source/' + encodeURIComponent(b.dataset.src));
  });
}
