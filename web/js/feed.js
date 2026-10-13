// The Feed tab: the timeline, the Saved view, the Source page and the Sources list.
import {$, esc, gcol, initials, addedLabel, kindLabel, BATCHES, dfmt, dkey, sfmt, tfmt, rel, dur, dateOk, toast} from './util.js';
import {play, playable} from './player.js';

export const S = {
  sources: [],          // the source list from data/sources.json
  feed: {},             // id -> {id,name,kind,home,updatedAt,items,linkOnly?}
  status: null,         // data/status.json
  paused: new Set(),
  saved: {},            // key -> card copy
  lastSeen: null,
  groups: {},           // group -> shown? (kept on this device)
  srcView: 'all',
  view: 'feed',         // feed | saved | source
  srcId: null,
  limit: 60,
  canWrite: false,
  onNavigate: null,     // set by app.js: (hash) => void
};
try { S.groups = JSON.parse(localStorage.getItem('ba.groups') || '{}') || {}; } catch (e) {}
function saveLocal() { try { localStorage.setItem('ba.groups', JSON.stringify(S.groups)); } catch (e) {} }

export function cfgFor(id) { return S.sources.find(s => s.id === id) || null; }
function nameOf(id) { const c = cfgFor(id), d = S.feed[id]; return (c && c.name) || (d && d.name) || id; }
function groupOf(id) { const c = cfgFor(id); return (c && c.group) || 'Other'; }

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
export const savedKey = it => it.sid + ':' + (it.id || it.url || '');
function savedList() { return Object.entries(S.saved).map(([k, v]) => ({...v, _key: k})).sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || '')); }
function isSavedItem(it) { if (S.saved[savedKey(it)]) return true; return Object.values(S.saved).some(v => v.sid === it.sid && (v.id === it.id || (v.url && v.url === it.url))); }

function card(it, mode) {
  const inSaved = mode === 'saved', inSrc = mode === 'source';
  const saved = inSaved || isSavedItem(it);
  const isNew = !inSaved && dateOk(it.date) && (!S.lastSeen || it.date > S.lastSeen);
  const tags = [it.tags, it.location, dur(it.duration)].filter(Boolean).join(' · ');
  const square = /sndcdn|ntslive|podbean|mixcloud|bcbits/.test(it.image || '');
  const links = (it.links || []).map(l => `<a href="${esc(l.u)}" target="_blank" rel="noopener">↗ ${esc(l.t)}</a>`).join('');
  const when = inSaved ? it.savedAt : it.date;
  return `<article class="card${it.linkOnly ? ' linkonly' : ''}" style="--sc:${gcol(it.group)}">
    <div class="who"><button class="srcbtn" data-src="${esc(it.sid)}" ${inSrc ? 'disabled' : ''} aria-label="See recent posts from ${esc(it.sname)}"><span class="av" aria-hidden="true">${esc(initials(it.sname))}</span>
      <span class="who-t"><span class="nm">${esc(it.sname)}${inSrc ? '' : ' <span class="go" aria-hidden="true">›</span>'}</span><span class="sub">${esc(it.group)}${inSaved && dateOk(it.date) ? ' · ' + esc(sfmt.format(new Date(it.date))) : ''}</span></span></button>
      <div class="t">${isNew ? '<span class="new">New</span>' : ''}${dateOk(when) ? esc(tfmt.format(new Date(when))) + '<br>' + esc(rel(when)) : ''}</div></div>
    <div class="ttl"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
    ${it.desc ? `<div class="txt" title="Tap to expand">${esc(it.desc)}</div>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}
    ${it.image ? `<a class="pic${square ? ' sq' : ''}" href="${esc(it.url)}" target="_blank" rel="noopener"><img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
    <div class="acts"><a class="btn p" href="${esc(it.url)}" target="_blank" rel="noopener">Open ↗</a>${S.canWrite ? `<button class="btn heart" data-save="${esc(savedKey(it))}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from Saved' : 'Save'}"><span aria-hidden="true">${saved ? '♥' : '♡'}</span>${saved ? 'Saved' : 'Save'}</button>` : ''}${it.audio && playable(it.audio) ? `<button class="btn" data-play="${esc(it.audio)}" data-name="${esc(it.title)}" data-sub="${esc(it.sname)}">▶ Play</button>` : it.audio ? `<a class="btn" href="${esc(it.audio)}" target="_blank" rel="noopener">Audio file</a>` : ''}${!S.canWrite || inSaved || inSrc ? '' : `<button class="btn q" data-pause="${esc(it.sid)}" title="Hide this source until you switch it back on">Pause source</button>`}${tags ? `<span class="tag">${esc(tags)}</span>` : ''}</div>
  </article>`;
}

export function render() {
  const items = allItems();
  const saved = savedList();
  const inSrc = S.view === 'source' && !!S.srcId, inSaved = !inSrc && S.view === 'saved', mode = inSrc ? 'source' : inSaved ? 'saved' : 'feed';
  const pool = inSrc ? srcItems(S.srcId) : inSaved ? saved : items;
  const groups = [...new Set(items.map(i => i.group).concat(saved.map(i => i.group)))].sort();
  for (const g of groups) if (!(g in S.groups)) S.groups[g] = true;
  const counts = {}; for (const i of pool) counts[i.group] = (counts[i.group] || 0) + 1;
  const newCount = items.filter(i => dateOk(i.date) && (!S.lastSeen || i.date > S.lastSeen)).length;
  const fn = $('feedNew'); fn.textContent = newCount > 99 ? '99+' : String(newCount); fn.hidden = !newCount;

  if (inSrc) { renderSrcHead(pool); }
  else {
    $('srcHead').hidden = true; $('srcHead').innerHTML = ''; $('filters').hidden = false;
    $('filters').innerHTML = `<button class="chip heartchip" id="savedView" aria-pressed="${inSaved}"><span class="hrt" aria-hidden="true">${inSaved ? '♥' : '♡'}</span>Saved <span class="cnt">${saved.length}</span></button>`
      + groups.filter(g => counts[g]).map(g => `<button class="chip" data-g="${esc(g)}" aria-pressed="${S.groups[g]}" style="--sc:${gcol(g)}"><span class="sw"></span>${esc(g)} <span class="cnt">${counts[g]}</span></button>`).join('')
      + (inSaved || !S.canWrite ? '' : `<button class="chip act" id="markSeen">Mark all seen${newCount ? ' (' + newCount + ')' : ''}</button>`)
      + `<button class="chip src${inSaved || !S.canWrite ? ' act' : ''}" id="openSrc">Sources${S.paused.size ? ' · ' + S.paused.size + ' paused' : ''}</button>`;
    $('filters').querySelectorAll('.chip[data-g]').forEach(b => b.addEventListener('click', () => { S.groups[b.dataset.g] = !S.groups[b.dataset.g]; saveLocal(); render(); }));
    $('savedView').addEventListener('click', () => S.onNavigate(inSaved ? '#feed' : '#saved'));
    const ms = $('markSeen'); if (ms) ms.addEventListener('click', () => S.onMarkSeen && S.onMarkSeen());
    $('openSrc').addEventListener('click', () => { $('sourcesBox').open = true; $('sourcesBox').scrollIntoView({behavior: 'smooth', block: 'start'}); });
    $('title').textContent = inSaved ? 'Saved' : 'Back Announce';
  }

  const vis = inSrc ? pool : pool.filter(i => S.groups[i.group] !== false);
  if (inSaved && !saved.length) $('stream').innerHTML = `<div class="empty">Nothing saved yet. Tap the heart on any card to keep it here. Saved cards stay even after the show drops out of the feed.</div>`;
  else if (inSrc && !pool.length) $('stream').innerHTML = `<div class="empty">Nothing gathered from this source yet. It refreshes every six hours.</div>`;
  else if (!pool.length) $('stream').innerHTML = `<div class="empty">Nothing gathered yet. The first run fills this in; after that it refreshes every six hours.</div>`;
  else if (!vis.length) $('stream').innerHTML = `<div class="empty">Every group is switched off. Tap a chip above to bring one back.</div>`;
  else {
    let html = '', lastDay = '';
    for (const it of vis.slice(0, S.limit)) {
      const when = inSaved ? it.savedAt : it.date;
      const day = dateOk(when) ? dkey.format(new Date(when)) : 'undated';
      if (day !== lastDay) { lastDay = day; html += `<div class="day"><span>${dateOk(when) ? (inSaved ? 'Saved ' : '') + esc(dfmt.format(new Date(when))) : 'Undated'}</span><span class="rule"></span></div>`; }
      html += card(it, mode);
    }
    if (vis.length > S.limit) html += `<button class="more" id="more">Show ${Math.min(60, vis.length - S.limit)} more of ${vis.length}</button>`;
    $('stream').innerHTML = html;
    $('stream').querySelectorAll('.card').forEach(c => {
      const t = c.querySelector('.txt'), l = c.querySelector('.links');
      if (t) t.addEventListener('click', () => { t.classList.toggle('open'); if (l) l.classList.toggle('open', t.classList.contains('open')); });
      c.querySelectorAll('.pic img').forEach(img => img.addEventListener('error', () => img.closest('.pic').classList.add('gone')));
    });
    $('stream').querySelectorAll('[data-pause]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.pause; S.onPause && S.onPause([id], true, `Paused ${nameOf(id)}`); }));
    $('stream').querySelectorAll('.srcbtn[data-src]:not([disabled])').forEach(b => b.addEventListener('click', () => S.onNavigate('#source/' + b.dataset.src)));
    $('stream').querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => { const it = vis.find(i => savedKey(i) === b.dataset.save) || saved.find(i => savedKey(i) === b.dataset.save); S.onSave && S.onSave(it, inSaved ? it._key : null); }));
    $('stream').querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => play(b.dataset.play, b.dataset.name, b.dataset.sub)));
    const m = $('more'); if (m) m.addEventListener('click', () => { S.limit += 60; render(); });
  }

  const st = S.status; const last = st && st.lastRun && dateOk(st.lastRun) ? new Date(st.lastRun) : null;
  const bad = st ? Object.values(st.sources || {}).filter(s => s.ok === false && !s.linkOnly).length : 0;
  const total = Object.keys(S.feed).length, pausedHere = [...S.paused].filter(id => S.feed[id]).length;
  $('meta').innerHTML = (last ? `Updated ${esc(dfmt.format(last))} ${esc(tfmt.format(last))}` : 'No run yet') + `<br>${items.length} items · ${total - pausedHere} of ${total} sources${bad ? ` · <span style="color:var(--accent)">${bad} failing</span>` : ''}${S.canWrite ? '' : ' · read only'}`;
  renderSources();
}

function renderSrcHead(items) {
  const id = S.srcId, cfg = cfgFor(id) || {}, doc = S.feed[id] || {};
  const name = cfg.name || doc.name || id, group = cfg.group || 'Other', home = doc.home || cfg.home || '';
  const off = S.paused.has(id); const ss = (S.status && S.status.sources && S.status.sources[id]) || {};
  const host = home ? home.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  const real = items.filter(i => !i.linkOnly);
  $('filters').hidden = true;
  $('title').textContent = name;
  const h = $('srcHead'); h.hidden = false; h.style.setProperty('--sc', gcol(group));
  h.innerHTML = `<button class="chip back" id="srcBack">‹ Back to ${S.prevView === 'saved' ? 'Saved' : 'the feed'}</button>
    <div class="sh"><div class="av" aria-hidden="true">${esc(initials(name))}</div><div class="shi"><div class="sub">${esc(group)}${cfg.kind ? ' · ' + esc(kindLabel(cfg.kind)) : ''}${cfg.added ? ' · ' + esc(addedLabel(cfg.added)) : ''}</div>
      <div class="sub">${real.length} recent ${real.length === 1 ? 'post' : 'posts'}${real[0] && dateOk(real[0].date) ? ', latest ' + esc(sfmt.format(new Date(real[0].date))) : ''}${ss.ok === false ? ' · <span style="color:var(--accent)">' + (ss.linkOnly ? 'site refuses the gatherer' : 'last fetch failed') + '</span>' : ''}${off ? ' · paused' : ''}</div></div></div>
    <div class="acts">${home ? `<a class="btn" href="${esc(home)}" target="_blank" rel="noopener">Visit ${esc(host.length > 28 ? 'site' : host)} ↗</a>` : ''}${S.canWrite ? `<button class="btn${off ? ' p' : ''}" id="srcPause">${off ? 'Resume source' : 'Pause source'}</button>` : ''}</div>`;
  $('srcBack').addEventListener('click', () => history.length > 1 ? history.back() : S.onNavigate('#feed'));
  const sp = $('srcPause'); if (sp) sp.addEventListener('click', () => S.onPause && S.onPause([id], !off, `${off ? 'Resumed' : 'Paused'} ${name}`));
}

function renderSources() {
  const st = S.status, P = S.paused, W = S.canWrite;
  const cfgItems = S.sources.length ? S.sources : Object.keys(S.feed).map(id => ({id, name: S.feed[id].name, home: S.feed[id].home}));
  const total = cfgItems.length; const nP = cfgItems.filter(s => P.has(s.id)).length;
  $('srcSub').textContent = `${total - nP} following${nP ? ' · ' + nP + ' paused' : ''}`;
  const start = cfgItems.filter(s => s.added === 'start'), extra = cfgItems.filter(s => s.added && s.added !== 'start');
  const extraOn = extra.filter(s => !P.has(s.id)).length;
  const batches = Object.keys(BATCHES).map(k => ({k, label: BATCHES[k], list: cfgItems.filter(s => s.added === k)})).filter(b => b.list.length);
  const views = [['all', 'All ' + total], ['on', 'Following ' + (total - nP)], ['off', 'Paused ' + nP]];
  $('mng').innerHTML = `<div class="sum"><b>${total - nP}</b> of ${total} sources in the feed.${W ? ' Switch any off to pause it; switch it back on whenever you like.' : ' Add your GitHub token in Settings to pause and resume sources from here.'}</div>
    <div class="row">${views.map(([k, l]) => `<button class="chip" data-view="${k}" aria-pressed="${S.srcView === k}">${esc(l)}</button>`).join('')}</div>
    ${W ? `<div class="row">${start.length && extraOn ? `<button class="btn" id="slim">Keep only my original ${start.length}</button>` : ''}${batches.map(b => { const on = b.list.filter(s => !P.has(s.id)).length; return (on ? `<button class="btn" data-batch="${b.k}" data-to="off">Pause the ${b.list.length} added ${esc(b.label)}</button>` : '') + (on < b.list.length ? `<button class="btn" data-batch="${b.k}" data-to="on">Bring back the ${b.list.length} added ${esc(b.label)}</button>` : ''); }).join('')}${nP ? `<button class="btn q" id="resumeAll">Resume everything</button>` : ''}</div>` : ''}`;
  $('mng').querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { S.srcView = b.dataset.view; renderSources(); }));
  const on = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };
  on('slim', () => { const ids = extra.filter(s => !P.has(s.id)).map(s => s.id); S.onPause(ids, true, `Paused ${ids.length} sources`); });
  $('mng').querySelectorAll('[data-batch]').forEach(b => b.addEventListener('click', () => { const off = b.dataset.to === 'off'; const ids = cfgItems.filter(s => s.added === b.dataset.batch && P.has(s.id) !== off).map(s => s.id); S.onPause(ids, off, `${off ? 'Paused' : 'Resumed'} ${ids.length} sources`); }));
  on('resumeAll', () => { const ids = [...P]; S.onPause(ids, false, `Resumed ${ids.length} sources`); });

  const groups = {}; for (const s of cfgItems) { (groups[s.group || 'Other'] = groups[s.group || 'Other'] || []).push(s); }
  let html = '';
  for (const g of Object.keys(groups).sort()) {
    const list = groups[g].filter(s => S.srcView === 'all' || (S.srcView === 'on' ? !P.has(s.id) : P.has(s.id)));
    if (!list.length) continue;
    const gOn = groups[g].filter(s => !P.has(s.id)).length;
    html += `<div class="sgh" style="--sc:${gcol(g)}"><h3><span class="sw"></span>${esc(g)}</h3><span class="c">${gOn}/${groups[g].length} on</span>${W ? `<button class="btn" data-grp="${esc(g)}" data-to="${gOn ? 'off' : 'on'}">${gOn ? 'Pause group' : 'Resume group'}</button>` : ''}</div>`;
    html += list.map(s => {
      const ss = (st && st.sources && st.sources[s.id]) || {}; const doc = S.feed[s.id]; const newest = doc && doc.items && doc.items[0] && doc.items[0].date; const off = P.has(s.id);
      const stTxt = ss.linkOnly ? 'link only' : ss.ok === false ? 'failed' : ss.ok === true || doc ? (dateOk(newest) ? sfmt.format(new Date(newest)) : 'no items') : 'pending';
      return `<div class="srow${off ? ' off' : ''}${W ? '' : ' ro'}" style="--sc:${gcol(g)}">${W ? `<button class="tg" role="switch" aria-checked="${!off}" aria-label="${esc(s.name)}" data-sid="${esc(s.id)}"></button>` : ''}<div class="n"><button class="srclink" data-src="${esc(s.id)}">${esc(s.name)}</button></div><div class="st${ss.ok === false && !ss.linkOnly ? ' bad' : ''}" title="${esc(ss.error || '')}">${esc(stTxt)}</div><div class="m">${esc(addedLabel(s.added))}${s.kind ? ' · ' + esc(kindLabel(s.kind)) : ''}${off ? ' · paused' : ''}</div></div>`;
    }).join('');
  }
  $('sources').innerHTML = html || `<div class="empty">Nothing here.</div>`;
  $('sources').querySelectorAll('.srclink').forEach(b => b.addEventListener('click', () => S.onNavigate('#source/' + b.dataset.src)));
  $('sources').querySelectorAll('.tg').forEach(b => b.addEventListener('click', () => S.onPause([b.dataset.sid], b.getAttribute('aria-checked') === 'true', null)));
  $('sources').querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => { const ids = groups[b.dataset.grp].map(s => s.id); const off = b.dataset.to === 'off'; const changed = ids.filter(id => P.has(id) !== off); S.onPause(changed, off, `${off ? 'Paused' : 'Resumed'} ${b.dataset.grp} (${changed.length})`); }));
}
