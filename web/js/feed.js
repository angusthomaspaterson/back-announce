// The Feed tab: the timeline, the Saved view, the Source page and the Sources screen.
// Each view has its own container, so going to a source and back leaves the feed exactly
// where it was. Clicks are handled by delegation, so containers can be re-rendered freely.
import {$, esc, gcol, catsOf, initials, addedLabel, kindLabel, BATCHES,dfmt, dkey, sfmt, tfmt, rel, dur, dateOk, nowIso, spotifySearch, dedupeAcross, openWhere, clock, toast} from './util.js';
import {PACKS, followedBy, isNewInCatalogue, addedDate} from './packs.js';
import {CURATOR} from './data.js';
import {play, getProgress, enqueue, inQueue} from './player.js';

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
  canWrite: false,      // Save, Pause and Mark all seen work (always, once the feed has loaded)
  owner: false,         // a token is on this device: changes go to the repository, and sources can be added
  welcome: false,       // show the first-visit panel above the feed
  incoming: null,       // a setup read from a #setup= link, waiting for a yes or no
  picks: [],            // data/picks.json: the cards Angus has picked out, each with his note
  packPick: new Set(),  // starter packs ticked on that panel
  ownerPaused: [],      // the published paused list: what Angus himself has switched off
  srcQuery: '',         // the Sources screen's search box
  srcSort: 'latest',    // the Sources screen's order: latest | added | az | group (kept on this device)
  srcKeep: new Set(),   // shows switched on the Sources screen: kept in view until the filter changes
  offSort: 'paused',    // the order of the Paused list: most recently paused first unless another is picked
  pausedAt: {},         // source id -> when it was paused (for sources paused since 17 Nov 2026)
  keepWhen: {},         // the pause time a row had when it was switched here, so it keeps its place
  query: '',            // the Search screen
  playOnly: false,      // the feed shows only what plays in the app
  full: {},             // id -> every stored item, fetched when a show's page needs more than the bundle has
  syncNote: '', syncError: '',
  // set by app.js
  onNavigate: null, onBack: null, onPause: null, onSave: null, onMarkSeen: null, onShowAdd: null,
  track: () => {},      // an anonymous count of an action (never which show or episode)
};
/** What visitors call a source. */
const showWord = () => S.owner ? 'Sources' : 'Shows';
try { S.groups = JSON.parse(localStorage.getItem('ba.groups') || '{}') || {}; } catch (e) {}
const SORTS = [['latest', 'Newest episode'], ['added', 'Recently added'], ['az', 'A to Z'], ['group', 'By category']];
// The Paused list adds "Recently paused" and opens with it, so what you just paused is at the top.
const sortChoices = () => S.srcView === 'off' ? [['paused', 'Recently paused'], ...SORTS] : SORTS;
const sortNow = () => S.srcView === 'off' ? S.offSort : S.srcSort;
/** "paused today", "paused 15 Nov", or just "paused" for sources paused before times were kept. */
function pausedLabel(id) {
  const at = S.pausedAt && S.pausedAt[id];
  if (!dateOk(at)) return 'paused';
  return dkey.format(new Date(at)) === dkey.format(new Date()) ? 'paused today' : 'paused ' + sfmt.format(new Date(at));
}
try { const s = localStorage.getItem('ba.srcSort'); if (SORTS.some(([k]) => k === s)) S.srcSort = s; } catch (e) {}
function saveLocal() { try { localStorage.setItem('ba.groups', JSON.stringify(S.groups)); } catch (e) {} }

export function cfgFor(id) { return S.sources.find(s => s.id === id) || null; }
export function nameOf(id) { const c = cfgFor(id), d = S.feed[id]; return (c && c.name) || (d && d.name) || id; }
/** One or two sentences on what a show is: Angus's own words if he wrote some, else the show's. */
export function aboutOf(id) { const c = cfgFor(id), d = S.feed[id]; return (c && c.about) || (d && d.about) || ''; }
function groupOf(id) { const c = cfgFor(id); return (c && c.group) || 'Other'; }
/** A card's categories: from its source when we have it (saved copies carry only the main group). */
function catsOfItem(i) { const c = i.sid && cfgFor(i.sid); return c ? catsOf(c) : (i.cats || [i.group || 'Other']); }
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
  const out = [], now = nowIso();
  for (const id of Object.keys(S.feed)) {
    if (S.paused.has(id)) continue;
    const d = S.feed[id];
    if (d.linkOnly && !(d.items || []).length) { out.push(linkOnlyCard(id)); continue; }
    // Rinse lists shows up to a day before they air; they join the feed once they have.
    for (const it of (d.items || [])) if (!it.date || it.date <= now) out.push(withSource(it, id));
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return dedupeAcross(out);
}
export function srcItems(id) {
  const d = S.feed[id] || {};
  const out = (S.full[id] || d.items || []).map(it => withSource(it, id));
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
/** Angus's public picks: {key, note, pickedAt, card}, newest first. Separate from anyone's Saved list. */
export function pickFor(it) {
  const k = savedKey(it);
  return S.picks.find(p => p.key === k || (p.card && p.card.sid === it.sid && ((it.id && p.card.id === it.id) || (it.url && p.card.url === it.url)))) || null;
}
function picksList() {
  return S.picks.filter(p => p.card && p.card.url).map(p => ({...p.card, pickedAt: p.pickedAt})).sort((x, y) => (y.pickedAt || '').localeCompare(x.pickedAt || ''));
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
  if (c.spotify) {
    // A source can name its Spotify search: {title}, and {num} for the episode number.
    const m = String(it.title || '').match(/(\d{2,4})/);
    if (c.spotify.includes('{num}') && !m) return null;
    return spotifySearch(c.spotify.replace('{title}', it.title || '').replace('{num}', m ? m[1] : ''));
  }
  if (c.upcoming) return spotifySearch(it.title);
  const feed = c.url || '';
  if (it.audio && c.kind === 'rss' && !/soundcloud\.com/i.test(feed + ' ' + it.audio)) return spotifySearch(`${it.sname} ${it.title}`);
  return null;
}

// ---- cards ----
const cardMap = new Map();   // data-save key -> item, for the click handler
function heartInner(saved) { return `<span aria-hidden="true">${saved ? '♥' : '♡'}</span>${saved ? 'Saved' : 'Save'}`; }
/** ▶ Play, ▶ Resume 47:12, or ▶ Play again. */
function playLabel(p) { return p && p.done ? '▶ Play again' : p && p.t > 30 ? `▶ Resume ${clock(p.t)}` : '▶ Play'; }
/** After the player saves a place, update that episode's buttons where they are on screen. */
export function refreshProgress(url) {
  for (const b of document.querySelectorAll('[data-play]')) {
    if (String(b.dataset.play).replace(/^http:/i, 'https:') !== url) continue;
    const p = getProgress(url);
    b.textContent = playLabel(p);
    const c = b.closest('.card'); if (!c) continue;
    let bar = c.querySelector('.prog');
    if (p && !p.done && p.d) {
      if (!bar) { bar = document.createElement('div'); bar.className = 'prog'; bar.setAttribute('aria-hidden', 'true'); bar.appendChild(document.createElement('i')); c.querySelector('.acts').before(bar); }
      bar.firstChild.style.width = Math.min(100, p.t / p.d * 100).toFixed(1) + '%';
    } else if (bar) bar.remove();
  }
}
function card(it, mode) {
  const inSaved = mode === 'saved', inSrc = mode === 'source', inPicks = mode === 'picks';
  const key = it._key || savedKey(it);
  cardMap.set(key, it);
  const saved = inSaved || findSavedKey(it) !== null;
  const isNew = !inSaved && !inPicks && !it.linkOnly && dateOk(it.date) && (!S.lastSeen || it.date > S.lastSeen);
  // Angus's picks carry his note wherever the card appears.
  const pick = inSaved ? null : pickFor(it);
  const note = pick ? `<blockquote class="note"><span class="by">Angus's pick</span>${pick.note ? esc(pick.note) : ''}</blockquote>` : '';
  const pickBtn = S.owner && !inSaved && !it.linkOnly ? `<button class="btn q" data-pick="${esc(key)}" title="Add this to your public picks, with a note">${pick ? 'Picked ✓' : 'Pick'}</button>` : '';
  const tags = [it.tags, it.location, dur(it.duration)].filter(Boolean).join(' · ');
  const square = /sndcdn|ntslive|podbean|mixcloud|bcbits/.test(it.image || '');
  const links = (it.links || []).map(l => `<a href="${esc(l.u)}" target="_blank" rel="noopener">↗ ${esc(l.t)}</a>`).join('');
  const when = inSaved ? it.savedAt : inPicks ? it.pickedAt : it.date;
  const heart =S.canWrite && !it.linkOnly ? `<button class="btn heart" data-save="${esc(key)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from Saved' : 'Save'}">${heartInner(saved)}</button>` : '';
  const prog = it.audio ? getProgress(it.audio) : null;
  const audio = it.audio ? `<button class="btn play" data-play="${esc(it.audio)}" data-name="${esc(it.title)}" data-sub="${esc(it.sname)}" data-art="${esc(it.image || '')}">${playLabel(prog)}</button>
    <button class="btn q" data-queue="${esc(key)}" title="Play this after what's playing now">${inQueue(it.audio) ? 'In Up next' : '+ Up next'}</button>` : '';
  const sp = spotifyLink(it);
  const spotify = sp ? `<a class="btn spot" href="${esc(sp)}" target="_blank" rel="noopener" title="Search Spotify for this">Spotify ↗</a>` : '';
  const share = it.url && !it.linkOnly ? `<button class="btn q" data-share="${esc(key)}" title="Send this to someone">Share</button>` : '';
  const pause = S.canWrite && !inSaved && !inSrc && !inPicks ? `<button class="btn q" data-pause="${esc(it.sid)}" title="Hide this ${S.owner ? 'source' : 'show'} until you switch it back on">${S.owner ? 'Pause source' : 'Pause show'}</button>` : '';
  const where = openWhere(it.url);
  // Older BBC cards said "(UK only)"; the BBC Sounds app plays them anywhere.
  const desc = (it.desc || '').replace(' (UK only).', '.');
  const bar = prog && !prog.done && prog.d ? `<div class="prog" aria-hidden="true"><i style="width:${Math.min(100, prog.t / prog.d * 100).toFixed(1)}%"></i></div>` : '';
  return `<article class="card${it.linkOnly ? ' linkonly' : ''}" style="--sc:${gcol(it.group)}">
    <div class="who"><button class="srcbtn" data-src="${esc(it.sid)}" ${inSrc ? 'disabled' : ''} aria-label="See recent posts from ${esc(it.sname)}"><span class="av" aria-hidden="true">${esc(initials(it.sname))}</span>
      <span class="who-t"><span class="nm">${esc(it.sname)}${inSrc ? '' : ' <span class="go" aria-hidden="true">›</span>'}</span><span class="sub">${esc(catsOfItem(it).join(' · '))}${(inSaved || inPicks) && dateOk(it.date) ? ' · ' + esc(sfmt.format(new Date(it.date))) : ''}</span></span></button>
      <div class="t">${isNew ? '<span class="new">New</span>' : ''}${dateOk(when) ? esc(tfmt.format(new Date(when))) + '<br>' + esc(rel(when)) : ''}</div></div>
    <div class="ttl"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
    ${note}
    ${desc ? `<div class="txt" title="Tap to expand">${esc(desc)}</div>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}
    ${it.image ? `<a class="pic${square ? ' sq' : ''}" href="${esc(it.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${esc(it.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` : ''}
    ${bar}
    <div class="acts"><a class="btn p" href="${esc(it.url)}" target="_blank" rel="noopener">${where ? `Open in ${esc(where)}` : 'Open'} ↗</a>${audio}${heart}${spotify}${share}${pickBtn}${pause}${tags || prog && prog.done ? `<span class="tag">${prog && prog.done ? '<b class="played">Played ✓</b>' + (tags ? ' · ' : '') : ''}${esc(tags)}</span>` : ''}</div>
  </article>`;
}
function dayList(list, mode, limit) {
  let html = '', lastDay = '';
  for (const it of list.slice(0, limit)) {
    const when = mode === 'saved' ? it.savedAt : mode === 'picks' ? it.pickedAt : it.date;
    const day = dateOk(when) ? dkey.format(new Date(when)) : 'undated';
    if (day !== lastDay) { lastDay = day; html += `<div class="day"><span>${dateOk(when) ? (mode === 'saved' ? 'Saved ' : mode === 'picks' ? 'Picked ' : '') + esc(dfmt.format(new Date(when))) : 'Undated'}</span><span class="rule"></span></div>`; }
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
  renderWelcome();
  const listView = v === 'feed' || v === 'saved' || v === 'picks';
  $('filters').hidden = !listView; $('stream').hidden = !listView;
  $('srcHead').hidden = v !== 'source'; $('srcPage').hidden = v !== 'source';
  $('sourcesView').hidden = v !== 'sources';
  $('addView').hidden = v !== 'add';
  $('suggestView').hidden = v !== 'suggest';
  $('searchView').hidden = v !== 'search';
  if (v === 'add') { S.onShowAdd(); renderMeta(items); return; }
  if (v === 'suggest') { S.onShowSuggest(); renderMeta(items); return; }
  if (v === 'search') { $('title').textContent = 'Search'; renderSearch(); renderMeta(items); return; }
  if (listView) {
    $('title').textContent = v === 'saved' ? 'Saved' : v === 'picks' ? "Angus's picks" : 'Back Announce';
    renderFilters(items, saved);
    if (rendered.stream !== v) { renderStream(items, saved); rendered.stream = v; }
  } else if (v === 'source') {
    renderSrcHead();
    if (rendered.src !== S.srcId) { renderSrcPage(); rendered.src = S.srcId; }
  } else if (v === 'sources') {
    $('title').textContent = showWord();
    if (!rendered.sources) { renderSources(); rendered.sources = true; }
  }
  renderMeta(items);
}

// ---- search: episodes, tracklists and shows, across the whole catalogue ----
let searchShown = '';
function renderSearch() {
  const box = $('searchIn');
  if (box.value !== S.query) box.value = S.query;
  if (searchShown === S.query && $('searchOut').innerHTML) return;
  searchShown = S.query;
  const words = S.query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(w => w.length > 1);
  if (!words.length) {
    $('searchOut').innerHTML = `<p class="hint">Search every recent episode's title, description and tracklist, and every show in the catalogue. Try an artist, a DJ, a label or a track.</p>`;
    return;
  }
  const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hit = t => { const f = fold(t); return words.every(w => f.includes(w)); };
  const shows = sourceList().filter(s => hit(`${s.name} ${catsOf(s).join(' ')} ${aboutOf(s.id)}`)).slice(0, 12);
  const eps = [], now = nowIso();
  for (const id of Object.keys(S.feed)) for (const it of (S.feed[id].items || [])) {
    if (it.date && it.date > now) continue;
    if (hit(`${it.title} ${it.desc} ${nameOf(id)}`)) eps.push(withSource(it, id));
  }
  eps.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const showHtml = shows.length ? `<h3 class="sh3">Shows</h3><div class="shows">${shows.map(s => `<button class="showhit" data-src="${esc(s.id)}" style="--sc:${gcol(s.group)}"><span class="sw"></span><b>${esc(s.name)}</b>${aboutOf(s.id) ? `<span>${esc(aboutOf(s.id))}</span>` : ''}${S.paused.has(s.id) ? '<em>Not in your feed</em>' : ''}</button>`).join('')}</div>` : '';
  $('searchOut').innerHTML = showHtml + (eps.length
    ? `<h3 class="sh3">${eps.length} episode${eps.length === 1 ? '' : 's'}${eps.length > 60 ? ', newest 60' : ''}</h3>${dayList(eps, 'search', 60)}`
    : `<p class="hint">No recent episodes mention "${esc(S.query)}". The search covers about the last six weeks.</p>`);
}

/** The first-visit panel: keep Angus's whole feed, or start from one or more packs. */
function renderWelcome() {
  const w = $('welcome');
  if (S.incoming && S.view === 'feed') {
    // Someone opened a setup link: offer it before anything else.
    const i = S.incoming, n = Object.keys(i.saved).length;
    w.hidden = false;
    w.innerHTML = i.kind === 'setup'
      ? `<h2>Bring your setup to this device?</h2>
         <p>This carries ${i.following} shows${n ? ` and ${n} saved card${n === 1 ? '' : 's'}` : ''}. It replaces the shows followed on this device${n ? ' and adds the saved cards to your Saved list' : ''}.${i.missing ? ` ${i.missing} older saved card${i.missing === 1 ? " isn't" : "s aren't"} in the feed any more, so a QR code can't bring ${i.missing === 1 ? 'it' : 'them'}; use Copy link on the other device for ${i.missing === 1 ? 'that' : 'those'}.` : ''}</p>
         <div class="wacts"><button class="btn p" id="inYes">Bring it over</button><button class="btn" id="inNo">No thanks</button></div>`
      : `<h2>Someone shared their feed with you</h2>
         <p>It follows ${i.following} of the ${sourceList().length} shows in the catalogue. Use it here? It replaces the shows followed on this device; your Saved list stays as it is.</p>
         <div class="wacts"><button class="btn p" id="inYes">Use this feed</button><button class="btn" id="inNo">No thanks</button></div>`;
    return;
  }
  const on = S.welcome && S.view === 'feed';
  w.hidden = !on;
  if (!on) return;
  const all = sourceList(), off = S.ownerPaused;
  const total = all.filter(s => !off.includes(s.id)).length;
  const n = S.packPick.size ? followedBy([...S.packPick], all, off).length : total;
  const picks = picksList().length;
  w.innerHTML = `<h2>Welcome to Back Announce<span class="dot">.</span></h2>
    <p class="lead">A back announce is the moment a radio presenter tells you what you just heard. This is a feed of the people who still do it: ${total} radio shows, mixes, podcasts and writers, chosen by Angus, not an algorithm.</p>
    <p class="ask">Start with everything, or pick what you're into:</p>
    <div class="packs">${PACKS.filter(p => followedBy([p.id], all, off).length).map(p =>`<button class="pack" data-pack="${p.id}" aria-pressed="${S.packPick.has(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.blurb)} · ${followedBy([p.id], all, off).length}</span></button>`).join('')}</div>
    <div class="wacts"><button class="btn p" id="wGo">${S.packPick.size ? `Start with these ${n} shows` : `Start with all ${total}`}</button>${picks ? `<button class="btn" id="wPicks">★ Angus's picks first</button>` : ''}</div>
    <p class="fine">No account. Change it any time under Shows. Your choices stay on this device; visits are counted anonymously.</p>`;
}

function renderFilters(items, saved) {
  const inPicks = S.view === 'picks', picks = picksList();
  const inSaved = S.view === 'saved' || inPicks, W = S.canWrite;   // neither list has Mark all seen
  const pool = inPicks ? picks : S.view === 'saved' ? saved : items;
  // A card counts under every category its show is in (NTS and Techno, say).
  const groups = [...new Set([...items, ...saved, ...picks].flatMap(catsOfItem))].sort();
  for (const g of groups) if (!(g in S.groups)) S.groups[g] = true;
  const counts = {}; for (const i of pool) for (const g of catsOfItem(i)) counts[g] = (counts[g] || 0) + 1;
  const newCount = countNew(items);
  // On phones the chips scroll sideways: keep the row where it was across the redraw.
  const keepX = $('filters').scrollLeft;
  queueMicrotask(() => { $('filters').scrollLeft = keepX; });
  $('filters').innerHTML =`<button class="chip heartchip" id="savedView" aria-pressed="${S.view === 'saved'}"><span class="hrt" aria-hidden="true">${S.view === 'saved' ? '♥' : '♡'}</span>Saved <span class="cnt">${saved.length}</span></button>`
    + (picks.length || S.owner ? `<button class="chip pickchip" id="picksView" aria-pressed="${inPicks}"><span class="hrt" aria-hidden="true">★</span>Angus's picks <span class="cnt">${picks.length}</span></button>` : '')
    + (inSaved ? '' : `<button class="chip playchip" id="playOnly" aria-pressed="${S.playOnly}" title="Only what plays here, in the app">▶ Plays here</button>`)
    // Showing only some categories: a way back to all of them, always in sight.
    + (groups.some(g => S.groups[g] === false) ? `<button class="chip allchip" id="allGroups" title="Show every category again">All</button>` : '')
    + groups.filter(g => counts[g]).map(g => `<button class="chip" data-g="${esc(g)}" aria-pressed="${S.groups[g]}" style="--sc:${gcol(g)}"><span class="sw"></span>${esc(g)} <span class="cnt">${counts[g]}</span></button>`).join('')
    + (inSaved || !W ? '' : `<button class="chip act" id="markSeen">Mark all seen${newCount ? ' (' + newCount + ')' : ''}</button>`)
    + `<button class="chip src${inSaved || !W ? ' act' : ''}" id="openSrc">${showWord()}</button>`
    // Straight to the Paused list, newest first: the way back to something just paused.
    + (S.paused.size && !inSaved ? `<button class="chip src" id="openPaused" title="The ${showWord().toLowerCase()} you've paused, most recent first">${S.paused.size} paused</button>` : '');
}
function countNew(items) { return items.filter(i => !i.linkOnly && dateOk(i.date) && (!S.lastSeen || i.date > S.lastSeen)).length; }

function renderStream(items, saved) {
  const inSaved = S.view === 'saved', inPicks = S.view === 'picks';
  const pool = inPicks ? picksList() : inSaved ? saved : items;
  const vis = pool.filter(i => catsOfItem(i).some(g => S.groups[g] !== false) &&(inSaved || inPicks || !S.playOnly || i.audio));
  let html = notices(inSaved, saved);
  if (inSaved && !saved.length) html += empty('Nothing saved yet. Tap the heart on any card to keep it here. Saved cards stay even after the show drops out of the feed.');
  else if (inPicks && !pool.length) html += empty(S.owner ? "No picks yet. Tap Pick on any card and say why it's worth hearing. Picks are public; your Saved list is not." : 'No picks yet.');
  else if (!pool.length) html += empty('Nothing gathered yet. The first run fills this in; after that it refreshes once a day.');
  else if (!vis.length) html += empty(S.playOnly ? 'Nothing in these groups plays here. Tap ▶ Plays here to see everything again.' : 'Every group is switched off. Tap a chip above to bring one back.');
  else {
    html += dayList(vis, inPicks ? 'picks' : inSaved ? 'saved' : 'feed', S.limit);
    if (vis.length > S.limit) html += `<button class="more" id="more">Show ${Math.min(60, vis.length - S.limit)} more of ${vis.length}</button>`;
  }
  $('stream').innerHTML = html;
}

/** Short notes above a list: the feed is out of date, or a visitor's saves have no backup. */
function notices(inSaved, saved) {
  const st = S.status, last = st && dateOk(st.lastRun) ? new Date(st.lastRun) : null;
  let out = '';
  if (!inSaved && last && Date.now() - last > 30 * 3600000) {
    const when = `${dfmt.format(last)}, ${tfmt.format(last)}`;
    out += S.owner
      ? `<div class="notice warn"><b>The feed hasn't refreshed since ${esc(when)}.</b> The daily gather on GitHub may have stopped. Help, under "If something looks wrong", has the fix. <a href="#help">Open Help</a></div>`
      : `<div class="notice warn"><b>These episodes are from ${esc(when)}.</b> The morning refresh is running late, so the newest shows may be missing for now.</div>`;
  }
  let nudged = false; try { nudged = localStorage.getItem('ba.backupNudged') === '1'; } catch (e) {}
  if (inSaved && !S.owner && saved.length >= 3 && !nudged) {
    out += `<div class="notice"><b>Your saved cards live in this browser.</b> Clearing it, or a phone tidying up unused sites, would lose them. Keep a copy on another device, or as a link.
      <div class="nacts"><button class="btn" id="nudgeCarry">Take it to another device</button><button class="btn q" id="nudgeNo">Not now</button></div></div>`;
  }
  return out;
}

function renderSrcHead() {
  const id = S.srcId, cfg = cfgFor(id) || {}, doc = S.feed[id] || {};
  const name = cfg.name || doc.name || id, group = cfg.group || 'Other', home = doc.home || cfg.home || '';
  const off = S.paused.has(id), ss = (S.status && S.status.sources && S.status.sources[id]) || {};
  const host = home ? home.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  const real = srcItems(id).filter(i => !i.linkOnly);
  const back = S.prevView === 'saved' ? 'Saved' : S.prevView === 'sources' ? showWord() : S.prevView === 'search' ? 'Search' : S.prevView === 'picks' ? "Angus's picks" : 'the feed';
  $('title').textContent = name;
  const h = $('srcHead'); h.style.setProperty('--sc', gcol(group));
  const about = aboutOf(id), O = S.owner, word = O ? 'source' : 'show';
  // Angus sees how the gathering went; a visitor sees what the show is.
  const health = ss.ok === false ? (O ? `<span class="bad">${ss.linkOnly ? 'site refuses the gatherer' : 'last fetch failed'}</span>`
    : ss.linkOnly ? "this site can't be gathered, so open it directly" : "couldn't be checked this morning") : '';
  const where = home ? openWhere(home) : null;
  // "NTS · NTS" says nothing twice: leave the kind out when it matches the group.
  const kind = cfg.kind ? kindLabel(cfg.kind) : '';
  const showKind = kind && kind.toLowerCase() !== group.toLowerCase();
  h.innerHTML = `<button class="chip back" id="srcBack">‹ Back to ${back}</button>
    <div class="sh"><div class="av" aria-hidden="true">${esc(initials(name))}</div><div class="shi"><div class="sub">${esc(catsOf(cfg.group ? cfg : {group}).join(' · '))}${showKind ? ' · ' + esc(kind) : ''}${O && cfg.added ? ' · ' + esc(addedLabel(cfg.added)) : ''}</div>
      <div class="sub">${real.length ? `${real.length} recent${real[0] && dateOk(real[0].date) ? ', latest ' + esc(sfmt.format(new Date(real[0].date))) : ''}` : ''}${health ? ' · ' + health : ''}${off ? ' · paused' : ''}</div></div></div>
    ${about ? `<p class="about">${esc(about)}</p>` : ''}
    <div class="acts">${home ? `<a class="btn" href="${esc(home)}" target="_blank" rel="noopener">${where ? `Open in ${esc(where)}` : `Visit ${esc(host.length > 28 ? 'site' : host)}`} ↗</a>` : ''}${S.canWrite ? `<button class="btn${off ? ' p' : ''}" id="srcPause">${off ? (O ? 'Resume source' : 'Add to my feed') : `Pause ${word}`}</button>` : ''}</div>`;
}
function renderSrcPage() {
  const id = S.srcId, d = S.feed[id] || {};
  const items = srcItems(id);
  $('srcPage').innerHTML = (items.length ? dayList(items, 'source', 999)
    : empty(S.owner ? 'Nothing gathered from this source yet. A source you have just added fills in within a few minutes: press Refresh. Otherwise it is checked once a day.' : 'Nothing from this show yet.'))
    + (d.more && !S.full[id] ? `<button class="more" id="srcMore">Show ${d.more} older</button>` : '');
}
/** The bundle carries each show's last six weeks; its page can fetch the rest. */
async function loadOlder(id) {
  const b = $('srcMore'); if (b) { b.disabled = true; b.textContent = 'Loading…'; }
  try {
    const r = await fetch(`data/feed/${encodeURIComponent(id)}.json`, {cache: 'no-cache'});
    if (!r.ok) throw new Error(r.status);
    S.full[id] = (await r.json()).items || [];
    if (S.srcId === id) { renderSrcPage(); renderSrcHead(); }
  } catch (e) { if (b) { b.disabled = false; b.textContent = "Couldn't load them. Try again"; } }
}

function renderSources() {
  const st = S.status, P = S.paused, W = S.canWrite, O = S.owner, all = sourceList();
  const total = all.length, nP = all.filter(s => P.has(s.id)).length;
  const start = all.filter(s => s.added === 'start'), extra = all.filter(s => s.added && s.added !== 'start');
  const extraOn = extra.filter(s => !P.has(s.id)).length;
  const batches = Object.keys(BATCHES).map(k => ({k, label: BATCHES[k], list: all.filter(s => s.added === k)})).filter(b => b.list.length);
  const nNew = all.filter(s => isNewInCatalogue(s)).length;
  if (S.srcView === 'new' && !nNew) S.srcView = 'all';
  const views = [['all', 'All ' + total], ['on', 'Following ' + (total - nP)], ['off', 'Paused ' + nP]].concat(nNew ? [['new', 'New ' + nNew]] : []);
  // Adding sources and the batch buttons (named after the dates Angus added things) are the owner's.
  $('mng').innerHTML = `${O ? '<button class="btn p addbtn" id="openAdd">+ Add source</button>' : ''}<div class="sum"><b>${total - nP}</b> of ${total} ${O ? 'sources' : 'shows'} in ${O ? 'the' : 'your'} feed.${W ? ' Switch any off to pause it; switch it back on whenever you like.' : ''}${O ? '' : ' Your choices are kept on this device.'}${S.syncError ? ` <span class="bad">${esc(S.syncError)}</span>` : ''}</div>
    <input class="srcsearch" id="srcSearch" type="search" placeholder="Search ${total} shows" aria-label="Search shows" value="${esc(S.srcQuery)}" autocomplete="off">
    <div class="row">${views.map(([k, l]) => `<button class="chip" data-view="${k}" aria-pressed="${S.srcView === k}">${esc(l)}</button>`).join('')}</div>
    <div class="row sortrow" role="group" aria-label="Sort shows"><span class="lbl">Sort</span>${sortChoices().map(([k, l]) => `<button class="chip" data-sort="${k}" aria-pressed="${sortNow() === k}">${esc(l)}</button>`).join('')}</div>
    <div class="row"><button class="btn" id="shareFeed" title="A link that shows someone the shows you follow">Share my feed</button>${O ? '' : `<button class="btn" id="carryLink" title="A link that brings your shows and Saved cards to another device">Take it to another device</button><button class="btn" id="openSuggest" title="Know a show that belongs here? Send ${esc(CURATOR.name.split(' ')[0])} the link">Suggest a show</button>`}${W && !O && nP ? '<button class="btn q" id="resumeAll">Resume everything</button>' : ''}</div>
    ${O ? `<details class="bulk"${S.bulkOpen ? ' open' : ''}><summary>Bulk changes</summary><div class="row">${start.length && extraOn ? `<button class="btn" id="slim">Keep only my original ${start.length}</button>` : ''}${batches.map(b => {
      const on = b.list.filter(s => !P.has(s.id)).length;
      return (on ? `<button class="btn" data-batch="${b.k}" data-to="off">Pause the ${b.list.length} added ${esc(b.label)}</button>` : '')
        + (on < b.list.length ? `<button class="btn" data-batch="${b.k}" data-to="on">Bring back the ${b.list.length} added ${esc(b.label)}</button>` : '');
    }).join('')}${nP ? `<button class="btn q" id="resumeAll">Resume everything</button>` : ''}</div></details>` : ''}`;
  renderSourceList();
}

/** The list under the Sources header. Typing in the search box redraws only this, so the box keeps focus. */
function renderSourceList() {
  const st = S.status, P = S.paused, W = S.canWrite, all = sourceList();
  const words = S.srcQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = s => { const hay = `${s.name} ${catsOf(s).join(' ')} ${kindLabel(s.kind)}`.toLowerCase(); return words.every(w => hay.includes(w)); };
  // A show switched on or off here stays in the list (showing its new state) until the filter changes,
  // so switching one back on from Paused doesn't make it vanish under your finger.
  const inView = s => S.srcView === 'all' || S.srcKeep.has(s.id) || (S.srcView === 'new' ? isNewInCatalogue(s) : S.srcView === 'on' ? !P.has(s.id) : P.has(s.id));
  const newestOf = s => { const d = S.feed[s.id] && S.feed[s.id].items && S.feed[s.id].items[0] && S.feed[s.id].items[0].date; return dateOk(d) ? d : ''; };
  // One row per show, naming its categories; under a category heading, only the others it is in.
  const row = (s, heading) => {
    const g = s.group || 'Other', ss = (st && st.sources && st.sources[s.id]) || {}, doc = S.feed[s.id], off = P.has(s.id);
    const newest = newestOf(s), latest = newest ? sfmt.format(new Date(newest)) : '';
    // Angus sees failures; a visitor sees the newest episode, or where to go instead.
    const stTxt = S.owner
      ? (ss.linkOnly ? 'link only' : ss.ok === false ? 'failed' : ss.ok === true || doc ? (latest || 'no items') : 'pending')
      : (ss.linkOnly ? 'visit site' : latest || '—');
    const about = S.owner ? '' : aboutOf(s.id);
    const cats = catsOf(s).filter(c => c !== heading);
    const cat = cats.length ? `<span class="cat"><span class="sw"></span>${esc(cats.join(' · '))}</span> · ` : '';
    const m = cat + (S.owner ? `${esc(addedLabel(s.added))}${s.kind ? ' · ' + esc(kindLabel(s.kind)) : ''}` : esc(about.length > 110 ? about.slice(0, 107).replace(/\s+\S*$/, '') + '…' : about || kindLabel(s.kind)));
    return `<div class="srow${off ? ' off' : ''}${W ? '' : ' ro'}" style="--sc:${gcol(g)}">${W ? `<button class="tg" role="switch" aria-checked="${!off}" aria-label="${esc(s.name)}" data-sid="${esc(s.id)}"></button>` : ''}<div class="n"><button class="srclink" data-src="${esc(s.id)}">${esc(s.name)}</button>${isNewInCatalogue(s) ? '<span class="newtag">New</span>' : ''}</div><div class="st${S.owner && ss.ok === false && !ss.linkOnly ? ' bad' : ''}"${S.owner ? ` title="${esc(ss.error || '')}"` : ''}>${esc(stTxt)}</div><div class="m">${m}${off ? ' · ' + esc(pausedLabel(s.id)) : ''}</div></div>`;
  };
  let html = '';
  const how = sortNow();
  if (how === 'group') {
    // A show in two categories is listed under both.
    const groups = {};
    for (const s of all) for (const c of catsOf(s)) (groups[c] = groups[c] || []).push(s);
    for (const g of Object.keys(groups).sort()) {
      const list = groups[g].filter(s => inView(s) && hit(s));
      if (!list.length) continue;
      const gOn = groups[g].filter(s => !P.has(s.id)).length;
      html += `<div class="sgh" style="--sc:${gcol(g)}"><h3><span class="sw"></span>${esc(g)}</h3><span class="c">${gOn}/${groups[g].length} on</span>${W ? `<button class="btn" data-grp="${esc(g)}" data-to="${gOn ? 'off' : 'on'}">${gOn ? 'Pause group' : 'Resume group'}</button>` : ''}</div>`;
      html += list.map(s => row(s, g)).join('');
    }
  } else {
    // A single list: newest episode first (quiet shows sink), most recently added first, or A to Z.
    const byName = (a, b) => a.name.localeCompare(b.name, 'en', {sensitivity: 'base'});
    const added = s => { const d = addedDate(s.added); return d ? d.getTime() : 0; };
    // A row switched here keeps the place it had, so it doesn't jump away while you look at it.
    const pausedWhen = s => (s.id in S.keepWhen ? S.keepWhen[s.id] : S.pausedAt && S.pausedAt[s.id]) || '';
    const order = how === 'az' ? byName
      : how === 'added' ? (a, b) => added(b) - added(a) || byName(a, b)
      : how === 'paused' ? (a, b) => pausedWhen(b).localeCompare(pausedWhen(a)) || byName(a, b)
      : (a, b) => newestOf(b).localeCompare(newestOf(a)) || byName(a, b);
    html = all.filter(s => inView(s) && hit(s)).sort(order).map(s => row(s, null)).join('');
  }
  $('sources').innerHTML = html || empty(words.length ? `No shows match "${esc(S.srcQuery)}".` : 'Nothing here.');
}

export function renderMeta(items = allItems()) {
  const newCount = countNew(items);
  const fn = $('feedNew'); fn.textContent = newCount > 99 ? '99+' : String(newCount); fn.hidden = !newCount;
  const st = S.status, last = st && dateOk(st.lastRun) ? new Date(st.lastRun) : null;
  const bad = st ? Object.values(st.sources || {}).filter(s => s.ok === false && !s.linkOnly).length : 0;
  const total = Object.keys(S.feed).length, pausedHere = [...S.paused].filter(id => S.feed[id]).length;
  const sync = !S.owner ? '' : S.syncError ? ` · <span class="bad" title="${esc(S.syncError)}">not saved</span>` : S.syncNote ? ` · ${esc(S.syncNote)}` : '';
  const updated = last ? `Updated ${esc(dfmt.format(last))} ${esc(tfmt.format(last))}` : S.owner ? 'No run yet' : 'Loading…';
  $('meta').innerHTML = S.owner
    ? updated + `<br>${items.length} items · ${total - pausedHere} of ${total} sources${bad ? ` · <span class="bad">${bad} failing</span>` : ''}${sync}`
    : updated + `<br>Following ${total - pausedHere} of ${total} shows`;
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
    } else if (t.dataset.save != null) { const it = cardMap.get(t.dataset.save); if (it) { S.onSave(it); S.track('save'); } }
    else if (t.dataset.pause) S.onPause([t.dataset.pause], true, `Paused ${nameOf(t.dataset.pause)}`);
    else if (t.dataset.play) { play(t.dataset.play, {title: t.dataset.name, sub: t.dataset.sub, art: t.dataset.art || ''}); S.track('play'); }
    else if (t.dataset.queue != null) {
      const it = cardMap.get(t.dataset.queue); if (!it || !it.audio) return;
      const r = enqueue({url: it.audio, title: it.title, sub: it.sname, art: it.image || ''});
      if (r === 'already') toast('Already in Up next');
      else if (r !== 'playing') { t.textContent = 'In Up next'; toast(r === 1 ? 'Plays next' : `Added to Up next (${r} waiting)`); }
      S.track('queue');
    }
    else if (t.dataset.pick != null) { const it = cardMap.get(t.dataset.pick); if (it) S.onPick(it); }
    else if (t.dataset.share != null) { const it = cardMap.get(t.dataset.share); if (it) { S.onShareCard(it); S.track('share'); } }
    else if (t.dataset.src && !t.disabled) S.onNavigate('#source/' + encodeURIComponent(t.dataset.src));
    else if (t.id === 'more') { S.limit += 60; rendered.stream = null; show(); }
    else if (t.id === 'srcMore') loadOlder(S.srcId);
    else if (t.id === 'nudgeCarry') { try { localStorage.setItem('ba.backupNudged', '1'); } catch (e) {} S.onShareSetup('setup'); }
    else if (t.id === 'nudgeNo') { try { localStorage.setItem('ba.backupNudged', '1'); } catch (e) {} t.closest('.notice').remove(); }
  };
  const broken = e => { if (e.target.tagName === 'IMG') { const p = e.target.closest('.pic'); if (p) p.classList.add('gone'); } };
  for (const id of ['stream', 'srcPage', 'searchOut']) { $(id).addEventListener('click', cards); $(id).addEventListener('error', broken, true); }

  let typing = null;
  $('searchIn').addEventListener('input', e => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      S.query = e.target.value.trim();
      renderSearch();
      if (S.query.length > 2) S.track('search');
    }, 250);
  });
  $('searchView').addEventListener('click', e => { if (e.target.closest('#searchBack')) S.onBack(); });

  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.g) {
      // With every category showing, a tap shows just that one; further taps add or remove
      // categories; tapping the only one left (or All) shows everything again.
      const all = Object.keys(S.groups), on = all.filter(k => S.groups[k] !== false), g = b.dataset.g;
      if (on.length === all.length) for (const k of all) S.groups[k] = k === g;
      else if (on.length === 1 && on[0] === g) for (const k of all) S.groups[k] = true;
      else S.groups[g] = S.groups[g] === false;
      if (!all.some(k => S.groups[k] !== false)) for (const k of all) S.groups[k] = true;
      saveLocal(); rendered.stream = null; show(); window.scrollTo(0, 0);
      // Keep the chip just tapped in sight in the sideways-scrolling row.
      setTimeout(() => { const c = document.querySelector(`#filters [data-g="${CSS.escape(g)}"]`); if (c) c.scrollIntoView({inline: 'nearest', block: 'nearest'}); }, 0);
    }
    else if (b.id === 'allGroups') { for (const k of Object.keys(S.groups)) S.groups[k] = true; saveLocal(); rendered.stream = null; show(); }
    else if (b.id === 'playOnly') { S.playOnly = !S.playOnly; rendered.stream = null; show(); }
    else if (b.id === 'savedView') S.onNavigate(S.view === 'saved' ? '#feed' : '#saved');
    else if (b.id === 'picksView') S.onNavigate(S.view === 'picks' ? '#feed' : '#picks');
    else if (b.id === 'markSeen') S.onMarkSeen();
    else if (b.id === 'openSrc' || b.id === 'openPaused') {
      S.srcView = b.id === 'openPaused' ? 'off' : 'all'; S.offSort = 'paused'; S.srcKeep.clear(); S.keepWhen = {};
      rendered.sources = false; S.onNavigate('#sources');
    }
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
    else if (b.id === 'openSuggest') S.onNavigate('#suggest');
    else if (b.id === 'shareFeed') S.onShareSetup('feed');
    else if (b.id === 'carryLink') S.onShareSetup('setup');
    else if (b.dataset.view) { S.srcView = b.dataset.view; S.srcKeep.clear(); S.keepWhen = {}; rendered.sources = false; show(); }
    else if (b.dataset.sort) {
      // The Paused list keeps its own order for this visit; the main list's order is kept on the device.
      if (S.srcView === 'off') S.offSort = b.dataset.sort;
      else { S.srcSort = b.dataset.sort; try { localStorage.setItem('ba.srcSort', S.srcSort); } catch (e) {} }
      for (const c of document.querySelectorAll('#mng [data-sort]')) c.setAttribute('aria-pressed', c.dataset.sort === sortNow());
      renderSourceList();
    }
    else if (b.id === 'slim') { const ids = all.filter(s => s.added && s.added !== 'start' && !P.has(s.id)).map(s => s.id); S.onPause(ids, true, `Paused ${ids.length} sources`); }
    else if (b.dataset.batch) { const off = b.dataset.to === 'off'; const ids = all.filter(s => s.added === b.dataset.batch && P.has(s.id) !== off).map(s => s.id); S.onPause(ids, off, `${off ? 'Paused' : 'Resumed'} ${ids.length} sources`); }
    else if (b.id === 'resumeAll') { const ids = [...P]; S.onPause(ids, false, `Resumed ${ids.length} sources`); }
    else if (b.dataset.sid) { const id = b.dataset.sid; S.srcKeep.add(id); if (!(id in S.keepWhen)) S.keepWhen[id] = (S.pausedAt && S.pausedAt[id]) || '';S.onPause([b.dataset.sid], b.getAttribute('aria-checked') === 'true', null); }
    else if (b.dataset.grp) { const off = b.dataset.to === 'off'; const ids = all.filter(s => catsOf(s).includes(b.dataset.grp) && P.has(s.id) !== off).map(s => s.id); S.onPause(ids, off, `${off ? 'Paused' : 'Resumed'} ${b.dataset.grp} (${ids.length})`); }
    else if (b.dataset.src) S.onNavigate('#source/' + encodeURIComponent(b.dataset.src));
  });
  // Bulk changes stays open across the redraw that follows one of its buttons.
  $('sourcesView').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('bulk')) S.bulkOpen = e.target.open; }, true);
  $('sourcesView').addEventListener('input', e => { if (e.target.id === 'srcSearch') { S.srcQuery = e.target.value; renderSourceList(); } });

  $('welcome').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pack) { if (S.packPick.has(b.dataset.pack)) S.packPick.delete(b.dataset.pack); else S.packPick.add(b.dataset.pack); renderWelcome(); }
    else if (b.id === 'wGo') { S.onWelcome([...S.packPick]); S.track('welcome'); }
    else if (b.id === 'wPicks') { S.onWelcome([]); S.track('welcome-picks'); S.onNavigate('#picks'); }
    else if (b.id === 'inYes' || b.id === 'inNo') S.onIncoming(b.id === 'inYes');
  });
}
