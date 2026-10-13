// Reads and writes data/state.json through the GitHub contents API.
//
// Every change (pause, save, mark seen) is queued as a small operation and kept on this
// device. About two seconds after the last change the queue is sent as one commit. If
// another device changed state.json in the meantime, GitHub refuses the write (409), so
// the file is read again, the same operations are applied on top, and the write retried.
// The token is kept in localStorage on this device and only ever sent to api.github.com.
import {REPO} from './data.js';

const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/data/state.json`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, message) { super(message || `HTTP ${status}`); this.status = status; }
}

// ---- encoding ----
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o; }
  return v;
}
/** The same layout the gatherer uses: sorted keys, one-space indent, trailing newline. */
export const serialise = s => JSON.stringify(sortKeys(s), null, 1) + '\n';
const same = (a, b) => serialise(a) === serialise(b);

// ---- the state document and the operations on it ----
export function normalise(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    ...s,
    paused: Array.isArray(s.paused) ? [...new Set(s.paused)].sort() : [],
    saved: s.saved && typeof s.saved === 'object' ? {...s.saved} : {},
    lastSeen: s.lastSeen || null,
  };
}
/** Apply queued operations to a state document, returning a new one. */
export function applyOps(state, ops) {
  const s = normalise(state);
  const paused = new Set(s.paused);
  for (const op of ops) {
    if (op.t === 'pause') for (const id of op.ids) { if (op.off) paused.add(id); else paused.delete(id); }
    else if (op.t === 'save') s.saved[op.key] = op.card;
    else if (op.t === 'unsave') delete s.saved[op.key];
    else if (op.t === 'seen') s.lastSeen = op.at || null;
  }
  s.paused = [...paused].sort();
  return s;
}
export function commitMessage(batch, source = 'web') {
  const what = batch.map(o => o.msg).filter(Boolean);
  const head = batch.length === 1 && what[0] ? what[0] : `${batch.length} changes`;
  const title = `state: ${head}`.slice(0, 64) + ` (${source})`;
  return batch.length > 1 && what.length ? title + '\n\n' + what.map(w => '- ' + w).join('\n') : title;
}

// ---- talking to GitHub ----
async function call(fetchImpl, token, method, body) {
  const url = method === 'GET' ? `${API}?ref=${REPO.branch}&_=${Date.now()}` : API;
  const headers = {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetchImpl(url, {method, cache: 'no-store', headers, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).message || ''; } catch (e) {}
    throw new HttpError(r.status, m);
  }
  return r.json();
}

/** Plain-English explanation of a failure. Never includes the token. */
export function explain(e, {checking = false} = {}) {
  const s = e && e.status;
  if (!s) return checking ? "Couldn't reach GitHub. Check the connection and try again."
    : 'Offline. Your changes are kept on this device and will be sent when the connection is back.';
  if (s === 401) return 'GitHub did not accept the token. Check it was copied in full and has not expired, then paste it again in Settings.';
  if (s === 403 && /rate limit/i.test(e.message)) return 'GitHub is limiting requests for a few minutes. Changes will be sent shortly.';
  if (s === 403) return 'The token can read the repository but not change it. In the token settings, set Contents to Read and write.';
  if (s === 404) return 'The token cannot reach the back-announce repository. In the token settings, choose Only select repositories and pick back-announce.';
  return `GitHub answered ${s}${e.message ? ': ' + e.message : ''}.`;
}

/**
 * Check a token before keeping it: it must read state.json and be allowed to write.
 * The write check sends the current file back with a deliberately wrong version number,
 * so GitHub answers 409 (allowed, but out of date) without changing anything.
 */
export async function checkToken(token, fetchImpl = (...a) => fetch(...a)) {
  try {
    const j = await call(fetchImpl, token, 'GET');
    try {
      await call(fetchImpl, token, 'PUT', {message: 'state: token check (changes nothing)', content: String(j.content || '').replace(/\s/g, ''), sha: '0'.repeat(40), branch: REPO.branch});
    } catch (e) {
      if (e.status !== 409) throw e;
    }
    return {ok: true};
  } catch (e) {
    return {ok: false, message: explain(e, {checking: true})};
  }
}

export function createStore({fetchImpl = (...a) => fetch(...a), onChange = () => {}, delay = 2000, source = 'web', keyPrefix = 'ba.'} = {}) {
  const K = {token: keyPrefix + 'token', pending: keyPrefix + 'pending', cache: keyPrefix + 'stateCache'};
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
  };
  let token = ls.get(K.token) || '';
  let base = null, sha = null, pending = [];
  try { pending = JSON.parse(ls.get(K.pending) || '[]') || []; } catch (e) { pending = []; }
  try { const c = JSON.parse(ls.get(K.cache) || 'null'); if (c && c.base) { base = normalise(c.base); sha = c.sha || null; } } catch (e) {}
  let saving = false, error = '', timer = null, flushing = null, gen = 0;

  const view = () => applyOps(base || {}, pending);
  const keepPending = () => ls.set(K.pending, pending.length ? JSON.stringify(pending) : null);
  const keepBase = () => ls.set(K.cache, base ? JSON.stringify({base, sha}) : null);
  const changed = before => onChange(same(before, view()) ? 'status' : 'state');

  async function read() {
    const j = await call(fetchImpl, token, 'GET');
    let obj = {};
    try { obj = JSON.parse(b64decode(j.content || '')); } catch (e) {}
    return {state: normalise(obj), sha: j.sha};
  }
  function schedule(ms = delay) { clearTimeout(timer); timer = setTimeout(() => { flush(); }, ms); }

  function flush() {
    clearTimeout(timer); timer = null;
    if (flushing) return flushing;
    if (!token || !pending.length) return Promise.resolve();
    flushing = (async () => {
      // Yield first, so `flushing` is assigned before the finally block below clears it,
      // even when there turns out to be nothing to send.
      await null;
      const before = view();
      const batch = pending.slice();
      saving = true; onChange('status');
      try {
        let cur = base, curSha = sha;
        for (let attempt = 1; ; attempt++) {
          if (!cur || !curSha) ({state: cur, sha: curSha} = await read());
          const next = applyOps(cur, batch);
          if (same(next, cur)) break;   // the changes cancel out, or are already there
          try {
            const res = await call(fetchImpl, token, 'PUT', {message: commitMessage(batch, source), content: b64encode(serialise(next)), sha: curSha, branch: REPO.branch});
            cur = next; curSha = res && res.content ? res.content.sha : null; gen++;
            break;
          } catch (e) {
            if ((e.status === 409 || e.status === 422) && attempt < 5) { curSha = null; await sleep(300 * attempt); continue; }
            throw e;
          }
        }
        base = cur; sha = curSha;
        pending = pending.slice(batch.length);
        keepPending(); keepBase(); error = '';
      } catch (e) {
        error = explain(e);
        if (!e.status || (e.status === 403 && /rate limit/i.test(e.message))) schedule(30000);
      } finally {
        saving = false; flushing = null;
      }
      changed(before);
      if (pending.length && !error) schedule();
    })();
    return flushing;
  }

  /** Read state.json from GitHub, so changes from the other device show. */
  async function refresh() {
    if (!token || flushing) return;
    const before = view(), startGen = gen;
    try {
      const r = await read();
      if (gen !== startGen || flushing) return;   // a write landed meanwhile; this read is already stale
      base = r.state; sha = r.sha; keepBase();
      if (!pending.length) error = '';
    } catch (e) {
      if (e.status) error = explain(e);
    }
    changed(before);
  }

  return {
    view,
    hasToken: () => !!token,
    status: () => ({saving, error, pending: pending.length}),
    /** Start from the published copy when nothing better is cached yet. */
    seed(state) { if (!base) { base = normalise(state); sha = null; } },
    queue(op) { const before = view(); pending.push(op); keepPending(); changed(before); schedule(); },
    flush,
    flushSoon() { if (pending.length) schedule(500); },
    refresh,
    setToken(t) {
      token = t || ''; ls.set(K.token, token || null);
      if (!token) { pending = []; keepPending(); base = null; sha = null; keepBase(); error = ''; clearTimeout(timer); }
    },
  };
}
