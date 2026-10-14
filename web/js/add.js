// Add source: paste or share a link, GitHub checks it, preview the latest episodes,
// pick a group, add it to data/sources.json.
//
// Browsers can't read most other sites directly, so the check happens on GitHub: the app
// writes data/requests/<id>.json, the check-source workflow answers in <id>.result.json
// (usually within a minute), and the app polls for that answer.
import {$, esc, gcol, sfmt, dateOk, nowIso, kindLabel, PERTH} from './util.js';
import {S} from './feed.js';
import {explain} from './store.js';

const POLL_MS = 4000, GIVE_UP_MS = 4 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const addedFmt = new Intl.DateTimeFormat('en-AU', {timeZone: PERTH, day: 'numeric', month: 'short'});
let files = null, onAdded = null;
let job = null;       // the check in progress: {id, url, started}
let result = null;    // the last answer from GitHub
let ticker = null;

export function wireAdd({store, added}) {
  files = store.files; onAdded = added;
  const view = $('addView');
  view.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'addForm') start($('addUrl').value); });
  view.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'addBack') S.onBack();
    else if (b.id === 'addCancel') { job = null; renderInput(''); }
    else if (b.id === 'addAgain') { result = null; renderInput(''); }
    else if (b.id === 'addConfirm') confirm();
    else if (b.id === 'addOpenDup') S.onNavigate('#source/' + encodeURIComponent(b.dataset.id));
    else if (b.id === 'addSettings') $('settingsBtn').click();
  });
  view.addEventListener('change', e => { if (e.target.id === 'addGroup') { $('addNewGroup').hidden = e.target.value !== '__new'; if (!$('addNewGroup').hidden) $('addNewGroup').focus(); } });
}

/** Called whenever the Add screen is shown. */
export function showAdd(prefill) {
  $('title').textContent = 'Add a source';
  if (!S.canWrite) { renderNoToken(prefill); return; }
  if (prefill) { start(prefill); return; }
  if (job) renderChecking();
  else if (result) renderResult();
  else renderInput('');
}

const body = html => { $('addBody').innerHTML = html; };
const linkIn = text => { const m = String(text || '').match(/https?:\/\/\S+/); return m ? m[0] : String(text || '').trim(); };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };

function renderNoToken(prefill) {
  body(`<p class="hint">Adding sources needs a GitHub token on this device, the same one that turns on Save and Pause.</p>
    ${prefill ? `<p class="hint">The link you shared: <code>${esc(linkIn(prefill))}</code></p>` : ''}
    <div class="setrow"><button class="btn p" id="addSettings">Open Settings</button></div>`);
}

function renderInput(url, error) {
  clearInterval(ticker);
  body(`<p class="hint">Paste a link to an NTS or Rinse FM show, a Mixcloud or SoundCloud account, an Apple Podcasts show, a podcast or newsletter feed, or a magazine's website.</p>
    <form id="addForm" class="addform" autocomplete="off">
      <input id="addUrl" type="text" inputmode="url" placeholder="https://…" value="${esc(url)}" aria-label="Link to add" spellcheck="false" autocapitalize="off">
      <button class="btn p" type="submit">Check</button>
    </form>
    ${error ? `<p class="setstatus bad" role="alert">${esc(error)}</p>` : ''}
    <p class="hint">Or share a link straight into Back Announce from another app: tap Share, then Back Announce.</p>`);
  if (!url) setTimeout(() => { const i = $('addUrl'); if (i) i.focus(); }, 50);
}

function renderChecking() {
  body(`<p class="checking"><span class="spinner" aria-hidden="true"></span> Checking <b>${esc(host(linkIn(job.url)))}</b>…</p>
    <p class="hint">GitHub is opening the link and reading its latest episodes. This usually takes about a minute. <span id="addElapsed"></span></p>
    <div class="setrow"><button class="btn" id="addCancel">Cancel</button></div>`);
  clearInterval(ticker);
  ticker = setInterval(() => { const el = $('addElapsed'); if (!el || !job) { clearInterval(ticker); return; } el.textContent = `(${Math.round((Date.now() - job.started) / 1000)} seconds so far)`; }, 1000);
}

function guessGroup(src, groups) {
  const want = src.kind === 'nts' ? 'NTS' : src.kind === 'rinse' ? 'Rinse FM'
    : /podcasts\.apple\.com/.test(src.home) ? 'Podcasts' : /soundcloud|mixcloud/.test(src.home + (src.url || '')) ? 'Mixes'
    : /substack/.test(src.url || '') ? 'Writing' : 'Writing';
  return groups.includes(want) ? want : groups[0];
}

function renderResult() {
  clearInterval(ticker);
  const r = result;
  if (!r.ok) { renderInput(linkIn(r.requestUrl || r.url), r.error); return; }
  if (r.duplicate) {
    body(`<h2>Already following</h2>
      <p>You already follow this as <b>${esc(r.duplicate.name)}</b>.</p>
      <div class="setrow"><button class="btn p" id="addOpenDup" data-id="${esc(r.duplicate.id)}">Open its page</button><button class="btn" id="addAgain">Check another link</button></div>`);
    return;
  }
  const src = r.source;
  const groups = [...new Set(S.sources.map(s => s.group || 'Other'))].sort();
  const g = guessGroup(src, groups);
  const items = (r.items || []).map(it => `<li><span class="d">${dateOk(it.date) ? esc(sfmt.format(new Date(it.date))) : ''}</span><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></li>`).join('');
  const kind = src.kind === 'rss' ? (/soundcloud/.test(src.url) ? 'SoundCloud' : /podcasts\.apple/.test(src.home) ? 'Podcast feed' : 'Feed') : kindLabel(src.kind);
  body(`<div class="addres" style="--sc:${gcol(g)}">
      <p class="sub">${esc(kind)} · <a href="${esc(src.home)}" target="_blank" rel="noopener">${esc(host(src.home))} ↗</a></p>
      <label for="addName">Name</label>
      <input id="addName" type="text" value="${esc(src.name)}">
      <label for="addGroup">Group</label>
      <select id="addGroup">${groups.map(x => `<option${x === g ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="__new">New group…</option></select>
      <input id="addNewGroup" type="text" placeholder="Name of the new group" hidden>
      ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}
      ${items ? `<h3>Latest</h3><ul class="addlist">${items}</ul>` : ''}
      <div class="setrow"><button class="btn p" id="addConfirm">Add to Back Announce</button><button class="btn" id="addAgain">Check another link</button></div>
      <p class="setstatus" id="addStatus" role="status"></p>
    </div>`);
}

async function start(raw) {
  const url = linkIn(raw);
  if (!url) { renderInput('', 'Paste a link first.'); return; }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const j = job = {id, url: raw, started: Date.now()};
  result = null;
  renderChecking();
  try {
    await files.create(`data/requests/${id}.json`, {url: raw, at: nowIso(), by: 'web'}, 'sources: check a link (web)');
  } catch (e) {
    if (job === j) { job = null; renderInput(url, explain(e, {checking: true})); }
    return;
  }
  while (job === j) {
    await sleep(POLL_MS);
    if (job !== j) return;
    try {
      const r = await files.get(`data/requests/${id}.result.json`);
      if (r) { result = {...r.data, requestUrl: raw}; job = null; if (S.view === 'add') renderResult(); return; }
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 404) { job = null; if (S.view === 'add') renderInput(url, explain(e, {checking: true})); return; }
      // a dropped connection: keep waiting
    }
    if (Date.now() - j.started > GIVE_UP_MS) {
      job = null;
      if (S.view === 'add') renderInput(url, 'GitHub is taking longer than usual. Try again in a few minutes. If it keeps happening, the Actions tab on GitHub shows whether "Check a new source" is stuck.');
      return;
    }
  }
}

async function confirm() {
  const src = result.source;
  const name = $('addName').value.trim() || src.name;
  const sel = $('addGroup').value;
  const group = sel === '__new' ? $('addNewGroup').value.trim() : sel;
  const status = $('addStatus'), btn = $('addConfirm');
  if (!group) { status.textContent = 'Give the new group a name first.'; status.classList.add('bad'); $('addNewGroup').focus(); return; }
  btn.disabled = true; btn.textContent = 'Adding…'; status.textContent = ''; status.classList.remove('bad');
  const added = addedFmt.format(new Date());
  const same = (a, b) => a.kind === b.kind && ((a.slug && a.slug === b.slug) || (a.user && (a.user || '').toLowerCase() === (b.user || '').toLowerCase()) || (a.url && a.url === b.url));
  let entry = null, existing = null;
  try {
    await files.edit('data/sources.json', cfg => {
      const items = cfg.items || [];
      existing = items.find(s => same(s, src));
      if (existing) return null;
      let id = src.id, n = 2;
      while (items.some(s => s.id === id)) id = `${src.id}-${n++}`;
      entry = {...src, id, name, group, added};
      return {...cfg, items: [...items, entry]};
    }, `sources: add ${name} (web)`);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Add to Back Announce';
    status.textContent = explain(e); status.classList.add('bad');
    return;
  }
  result = null;
  if (existing) { S.onNavigate('#source/' + encodeURIComponent(existing.id)); return; }
  onAdded(entry);
}
