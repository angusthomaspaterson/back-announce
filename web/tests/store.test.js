// Tests for js/store.js against a pretend GitHub. Open tests/index.html on a local server.
import {createStore, applyOps, normalise, serialise, b64encode, b64decode, checkToken, commitMessage, repoFiles} from '../js/store.js';
import {appIntent} from '../js/util.js';

const out = document.getElementById('out');
let passed = 0, failed = 0;
const log = (cls, msg) => { const s = document.createElement('div'); s.className = cls; s.textContent = msg; out.appendChild(s); };
function ok(cond, msg) { if (cond) passed++; else { failed++; log('bad', 'FAIL ' + msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const resp = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

function fakeGitHub(initial) {
  const gh = {text: serialise(normalise(initial)), sha: 's1', n: 1, puts: [], gets: 0, beforePut: null, failWith: null, getDelays: []};
  gh.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (!String(url).startsWith('https://api.github.com/repos/angusthomaspaterson/back-announce/contents/data/state.json')) return resp(404, {message: 'wrong url ' + url});
    if (!/^Bearer \S+$/.test(opts.headers.Authorization)) return resp(401, {message: 'no auth'});
    if (gh.failWith === 'network') throw new TypeError('Failed to fetch');
    if (gh.failWith) return resp(gh.failWith, {message: gh.failWith === 403 ? 'Resource not accessible by personal access token' : 'nope'});
    if (method === 'GET') {
      gh.gets++;
      const snap = {sha: gh.sha, content: b64encode(gh.text)};
      const d = gh.getDelays.shift(); if (d) await wait(d);
      return resp(200, snap);
    }
    const body = JSON.parse(opts.body);
    if (gh.beforePut) { const f = gh.beforePut; gh.beforePut = null; f(gh); }
    if (body.sha !== gh.sha) return resp(409, {message: `data/state.json does not match ${body.sha}`});
    gh.text = b64decode(body.content); gh.sha = 's' + (++gh.n); gh.puts.push(body.message);
    return resp(200, {content: {sha: gh.sha}});
  };
  gh.state = () => JSON.parse(gh.text);
  gh.edit = fn => { const s = JSON.parse(gh.text); fn(s); gh.text = serialise(normalise(s)); gh.sha = 's' + (++gh.n); };
  return gh;
}
let n = 0;
function newStore(gh, extra = {}) {
  const prefix = `batest${++n}.`;
  const st = createStore({fetchImpl: gh.fetch, delay: 40, keyPrefix: prefix, ...extra});
  st.setToken('test-token');
  st._prefix = prefix;
  return st;
}
function cleanup() { for (const k of Object.keys(localStorage)) if (k.startsWith('batest')) localStorage.removeItem(k); }

const tests = {
  'applyOps pauses, saves and marks seen'() {
    const s = applyOps({paused: ['b'], saved: {}, lastSeen: null}, [
      {t: 'pause', ids: ['c', 'a'], off: true}, {t: 'pause', ids: ['b'], off: false},
      {t: 'save', key: 'x:1', card: {title: 'One'}}, {t: 'save', key: 'x:2', card: {title: 'Two'}}, {t: 'unsave', key: 'x:1'},
      {t: 'seen', at: '2026-10-13T00:00:00Z'}]);
    eq(s.paused, ['a', 'c'], 'paused, sorted');
    eq(Object.keys(s.saved), ['x:2'], 'saved keys');
    eq(s.lastSeen, '2026-10-13T00:00:00Z', 'lastSeen');
  },
  'serialise sorts keys and matches the gatherer layout'() {
    eq(serialise({b: 1, a: {d: 2, c: 3}}), '{\n "a": {\n  "c": 3,\n  "d": 2\n },\n "b": 1\n}\n', 'layout');
  },
  'base64 survives non-ASCII text'() {
    const t = 'Hermanos Gutiérrez “quoted” ♥ 日本';
    eq(b64decode(b64encode(t)), t, 'round trip');
  },
  'commit messages'() {
    eq(commitMessage([{msg: 'pause Moxie'}]), 'state: pause Moxie (web)', 'single');
    ok(commitMessage([{msg: 'pause a'}, {msg: 'save b'}]).startsWith('state: 2 changes (web)\n\n- pause a\n- save b'), 'batch');
  },
  async 'a burst of changes becomes one commit'() {
    const gh = fakeGitHub({paused: [], saved: {}});
    const st = newStore(gh);
    st.queue({t: 'pause', ids: ['a'], off: true, msg: 'pause a'});
    st.queue({t: 'pause', ids: ['b'], off: true, msg: 'pause b'});
    st.queue({t: 'save', key: 'k', card: {title: 'T'}, msg: 'save T'});
    await wait(15); eq(gh.puts.length, 0, 'nothing sent before the pause');
    await wait(150);
    eq(gh.puts.length, 1, 'one commit');
    eq(gh.state().paused, ['a', 'b'], 'remote paused');
    ok(gh.state().saved.k, 'remote saved');
    eq(st.status().pending, 0, 'queue empty');
  },
  async 'a change from the other device is kept when both write'() {
    const gh = fakeGitHub({paused: ['x'], saved: {}});
    const st = newStore(gh);
    gh.beforePut = g => g.edit(s => { s.paused.push('from-phone'); s.saved['p:1'] = {title: 'Phone save'}; });
    st.queue({t: 'pause', ids: ['a'], off: true, msg: 'pause a'});
    await st.flush();
    eq(gh.puts.length, 1, 'one successful write after the conflict');
    eq(gh.state().paused, ['a', 'from-phone', 'x'], 'both pauses kept');
    ok(gh.state().saved['p:1'], 'phone save kept');
    eq(st.view().paused, ['a', 'from-phone', 'x'], 'local view matches');
  },
  async 'changes that cancel out send nothing'() {
    const gh = fakeGitHub({paused: [], saved: {}});
    const st = newStore(gh);
    st.queue({t: 'pause', ids: ['a'], off: true});
    st.queue({t: 'pause', ids: ['a'], off: false});
    await st.flush();
    eq(gh.puts.length, 0, 'no commit');
    eq(st.status().pending, 0, 'queue cleared');
  },
  async 'after changes cancel out, later changes and refreshes still work'() {
    const gh = fakeGitHub({paused: [], saved: {}});
    const st = newStore(gh);
    st.queue({t: 'pause', ids: ['a'], off: true});
    await st.flush();                                   // writes a, so a sha is cached
    st.queue({t: 'save', key: 'k', card: {title: 'T'}});
    st.queue({t: 'unsave', key: 'k'});
    await st.flush();                                   // cancels out with nothing to read
    gh.edit(s => { s.paused.push('from-phone'); });
    await st.refresh();
    eq(st.view().paused, ['a', 'from-phone'], 'refresh still runs');
    st.queue({t: 'pause', ids: ['b'], off: true});
    await st.flush();
    eq(gh.state().paused, ['a', 'b', 'from-phone'], 'later write still sent');
  },
  async 'a rejected token keeps the changes and says why'() {
    const gh = fakeGitHub({paused: []});
    const st = newStore(gh);
    gh.failWith = 401;
    st.queue({t: 'pause', ids: ['a'], off: true});
    await st.flush();
    ok(/did not accept the token/.test(st.status().error), 'explains 401');
    eq(st.status().pending, 1, 'change kept');
    ok(!st.status().error.includes('test-token'), 'token not in message');
    gh.failWith = null;
    await st.flush();
    eq(st.status().error, '', 'error cleared');
    eq(gh.state().paused, ['a'], 'sent after fixing');
  },
  async 'offline keeps the changes on the device'() {
    const gh = fakeGitHub({paused: []});
    const st = newStore(gh);
    gh.failWith = 'network';
    st.queue({t: 'save', key: 'k', card: {title: 'T'}});
    await st.flush();
    ok(/Offline/.test(st.status().error), 'offline message');
    ok(JSON.parse(localStorage.getItem(st._prefix + 'pending')).length === 1, 'stored on the device');
    gh.failWith = null;
    await st.flush();
    ok(gh.state().saved.k, 'sent once back online');
  },
  async 'a slow read cannot undo a write that landed meanwhile'() {
    const gh = fakeGitHub({paused: []});
    const st = newStore(gh);
    gh.getDelays = [120];           // refresh's read is slow
    const r = st.refresh();
    await wait(5);
    st.queue({t: 'pause', ids: ['a'], off: true});
    await st.flush();               // reads and writes quickly
    await r;
    eq(st.view().paused, ['a'], 'write still showing');
    eq(gh.state().paused, ['a'], 'write on GitHub');
  },
  async 'refresh shows the other device'() {
    const gh = fakeGitHub({paused: []});
    const st = newStore(gh);
    st.seed({paused: []});
    gh.edit(s => { s.paused.push('from-phone'); s.lastSeen = '2026-10-13T01:00:00Z'; });
    let kind = null;
    const st2 = createStore({fetchImpl: gh.fetch, delay: 40, keyPrefix: st._prefix + 'b.', onChange: k => { kind = k; }});
    st2.setToken('test-token');
    await st2.refresh();
    eq(st2.view().paused, ['from-phone'], 'paused from the phone');
    eq(kind, 'state', 'told the app the state changed');
  },
  async 'repo files: missing file, create, and an edit that meets a conflict'() {
    const files = {'data/sources.json': {text: serialise({items: [{id: 'a'}]}), sha: 'x1'}};
    let shaN = 1, beforePut = null;
    const fetchImpl = async (url, opts = {}) => {
      const path = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
      const f = files[path];
      if ((opts.method || 'GET') === 'GET') return f ? resp(200, {sha: f.sha, content: b64encode(f.text)}) : resp(404, {message: 'Not Found'});
      const body = JSON.parse(opts.body);
      if (beforePut) { const fn = beforePut; beforePut = null; fn(); }
      const now = files[path];
      if (now && body.sha !== now.sha) return resp(409, {message: 'does not match'});
      files[path] = {text: b64decode(body.content), sha: 'x' + (++shaN)};
      return resp(now ? 200 : 201, {content: {sha: files[path].sha}});
    };
    const rf = repoFiles(fetchImpl, () => 'test-token');
    eq(await rf.get('data/requests/nope.result.json'), null, 'missing file is null');
    await rf.create('data/requests/r1.json', {url: 'https://x'}, 'check');
    eq(JSON.parse(files['data/requests/r1.json'].text), {url: 'https://x'}, 'created');
    beforePut = () => { files['data/sources.json'] = {text: serialise({items: [{id: 'a'}, {id: 'from-phone'}]}), sha: 'x99'}; };
    await rf.edit('data/sources.json', cfg => ({...cfg, items: [...cfg.items, {id: 'new'}]}), 'add');
    eq(JSON.parse(files['data/sources.json'].text).items.map(s => s.id), ['a', 'from-phone', 'new'], 'both additions kept');
    let threw = null; try { await repoFiles(fetchImpl, () => '').get('data/sources.json'); } catch (e) { threw = e.status; }
    eq(threw, 401, 'no token refuses');
  },
  'SoundCloud and Mixcloud links become app links'() {
    eq(appIntent('https://soundcloud.com/andrew-wowk/time-to-track?in=x'), 'intent://soundcloud.com/andrew-wowk/time-to-track?in=x#Intent;scheme=https;package=com.soundcloud.android;S.browser_fallback_url=https%3A%2F%2Fsoundcloud.com%2Fandrew-wowk%2Ftime-to-track%3Fin%3Dx;end', 'soundcloud');
    ok(appIntent('https://www.mixcloud.com/johndigweed/transitions-1154/').startsWith('intent://www.mixcloud.com/johndigweed/transitions-1154/#Intent;scheme=https;package=com.mixcloud.player;'), 'mixcloud');
    eq(appIntent('https://feeds.soundcloud.com/users/soundcloud:users:1/sounds.rss'), null, 'feed addresses stay as they are');
    eq(appIntent('https://www.nts.live/shows/moxie'), null, 'other sites stay as they are');
    eq(appIntent('not a link'), null, 'junk');
  },
  async 'checkToken: 409 on the dummy write means writes are allowed'() {
    const gh = fakeGitHub({paused: []});
    eq(await checkToken('t', gh.fetch), {ok: true}, 'accepted');
    eq(gh.puts.length, 0, 'nothing written');
    gh.failWith = 403;
    const r = await checkToken('t', gh.fetch);
    ok(!r.ok && /Read and write/.test(r.message), 'read-only token explained');
    gh.failWith = 404;
    ok(/Only select repositories/.test((await checkToken('t', gh.fetch)).message), 'missing repo explained');
  },
};

(async () => {
  for (const [name, fn] of Object.entries(tests)) {
    const before = failed;
    try { await fn(); } catch (e) { failed++; log('bad', `FAIL ${name}: threw ${e.message}`); }
    log(failed === before ? 'ok' : 'bad', (failed === before ? 'ok   ' : 'FAIL ') + name);
  }
  cleanup();
  log(failed ? 'bad' : 'ok', `\n${passed} checks passed, ${failed} failed`);
  document.title = failed ? `FAIL ${failed}` : `PASS ${passed}`;
  window.testResult = {passed, failed};
})();
