// Tests for js/store.js against a pretend GitHub. Open tests/index.html on a local server.
import {createStore, applyOps, normalise, serialise, b64encode, b64decode, checkToken, commitMessage, repoFiles} from '../js/store.js';
import {appIntent, spotifySearch, dedupeAcross, clock, openWhere, catsOf} from '../js/util.js';
import {PACKS, followedBy, pausedFor, addedDate, isNewInCatalogue} from '../js/packs.js';
import {encodeSetup, encodeCompact, decodeSetup, setupLink, hash32} from '../js/carry.js';
import {classifyLink, messageFor, issueLink} from '../js/suggest.js';
import {qrMatrix, qrSvg, codewords, rsRemainder, formatBits, versionBits, alignmentPositions, dataCodewords, rawDataModules} from '../js/qr.js';

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
  'clock formats a resume point'() {
    eq(clock(0), '0:00', 'zero'); eq(clock(65), '1:05', 'minutes'); eq(clock(3789), '1:03:09', 'hours');
    eq(clock(-4), '0:00', 'never negative'); eq(clock(47 * 60 + 12.9), '47:12', 'drops fractions');
  },
  'openWhere names the app or site'() {
    eq(openWhere('https://www.nts.live/shows/x/episodes/y'), 'NTS', 'NTS');
    eq(openWhere('https://www.bbc.co.uk/sounds/play/m0012'), 'BBC Sounds', 'BBC');
    eq(openWhere('https://www.abc.net.au/triplej/programs/x'), 'ABC listen', 'ABC');
    eq(openWhere('https://soundcloud.com/a/b'), 'SoundCloud', 'SoundCloud');
    eq(openWhere('https://m.youtube.com/watch?v=1'), 'YouTube', 'YouTube on mobile');
    eq(openWhere('https://example.com/post'), null, 'plain page');
    eq(openWhere('not a link'), null, 'not a link');
  },
  'applyOps pauses, saves and marks seen'() {
    const s = applyOps({paused: ['b'], saved: {}, lastSeen: null}, [
      {t: 'pause', ids: ['c', 'a'], off: true}, {t: 'pause', ids: ['b'], off: false},
      {t: 'save', key: 'x:1', card: {title: 'One'}}, {t: 'save', key: 'x:2', card: {title: 'Two'}}, {t: 'unsave', key: 'x:1'},
      {t: 'seen', at: '2026-10-13T00:00:00Z'}]);
    eq(s.paused, ['a', 'c'], 'paused, sorted');
    eq(Object.keys(s.saved), ['x:2'], 'saved keys');
    eq(s.lastSeen, '2026-10-13T00:00:00Z', 'lastSeen');
  },
  'applyOps records when each source was paused, and forgets it on resume'() {
    const s = applyOps({paused: ['old'], saved: {}, lastSeen: null}, [
      {t: 'pause', ids: ['a'], off: true, at: '2026-11-17T01:00:00Z'},
      {t: 'pause', ids: ['b'], off: true, at: '2026-11-17T02:00:00Z'},
      {t: 'pause', ids: ['b'], off: false, at: '2026-11-17T03:00:00Z'},
      {t: 'pause', ids: ['c'], off: true}]);
    eq(s.paused, ['a', 'c', 'old'], 'paused list unchanged in shape');
    eq(s.pausedAt, {a: '2026-11-17T01:00:00Z'}, 'times kept only for paused sources that have one');
    eq('pausedAt' in applyOps({paused: []}, []), false, 'no empty pausedAt in older files');
    eq(normalise({paused: ['x'], pausedAt: {x: '2026-11-17T00:00:00Z', gone: '2026-11-01T00:00:00Z'}}).pausedAt, {x: '2026-11-17T00:00:00Z'}, 'stale times dropped');
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
    ok(appIntent('https://www.nts.live/shows/moxie').startsWith('intent://www.nts.live/shows/moxie#Intent;scheme=https;package=com.ntslive.ntsradio;'), 'nts');
    ok(appIntent('https://www.abc.net.au/triplej/programs/doof/doof/107305402').startsWith('intent://www.abc.net.au/listen/programs/doof/doof/107305402#Intent;scheme=https;package=com.thisisaim.abcradio;S.browser_fallback_url=https%3A%2F%2Fwww.abc.net.au%2Ftriplej%2F'), 'triple j opens ABC listen at its /listen/ address, falling back to the triple j page');
    ok(appIntent('https://www.abc.net.au/listen/programs/take-5/x/1').includes('package=com.thisisaim.abcradio;'), 'double j');
    eq(appIntent('https://www.abc.net.au/news/2026-11-07/story/1'), null, 'other ABC pages stay in the browser');
    ok(appIntent('https://www.bbc.co.uk/sounds/play/m00332wf').includes('package=com.bbc.sounds;'), 'bbc sounds');
    eq(appIntent('https://www.bbc.co.uk/programmes/b006wkfp'), null, 'other BBC pages stay in the browser');
    eq(appIntent('https://crackmagazine.net/article/x'), null, 'other sites stay as they are');
    eq(appIntent('https://www.rinse.fm/'), null, 'rinse stays a web link: its app accepts no links');
    eq(appIntent('not a link'), null, 'junk');
    ok(appIntent('https://open.spotify.com/search/Song%20Exploder').startsWith('intent://open.spotify.com/search/Song%20Exploder#Intent;scheme=https;package=com.spotify.music;'), 'spotify');
  },
  async 'a visitor without a token keeps changes on the device and sends nothing'() {
    const gh = fakeGitHub({paused: ['angus-paused'], saved: {his: {title: 'His pick'}}, lastSeen: '2026-10-01T00:00:00Z'});
    let calls = 0; const counting = (...a) => { calls++; return gh.fetch(...a); };
    const prefix = `batest${++n}.`, changes = [];
    const fixedNow = () => Date.parse('2026-11-16T04:00:00Z');
    const st = createStore({fetchImpl: counting, delay: 20, keyPrefix: prefix, now: fixedNow, onChange: k => changes.push(k)});
    eq(st.mode(), 'visitor', 'no token means visitor');
    ok(st.isNewVisitor(), 'first visit');
    st.seed(gh.state());
    ok(!st.isNewVisitor(), 'seeded');
    eq(st.view().paused, ['angus-paused'], 'starts from the published paused list');
    eq(st.view().saved, {}, 'but with an empty Saved list of their own');
    eq(st.view().lastSeen, '2026-11-15T04:00:00Z', 'and the last day marked new');
    st.queue({t: 'pause', ids: ['x'], off: true, msg: 'pause x'});
    st.queue({t: 'pause', ids: ['angus-paused'], off: false, msg: 'resume'});
    st.queue({t: 'save', key: 'k', card: {title: 'Mine'}, msg: 'save'});
    st.queue({t: 'seen', at: '2026-11-16T04:00:00Z', msg: 'seen'});
    eq(st.view().paused, ['x'], 'pause and resume apply at once');
    eq(Object.keys(st.view().saved), ['k'], 'saved');
    ok(changes.includes('state'), 'the app is told the state changed');
    await st.flush(); await st.refresh(); await wait(80);
    eq(calls, 0, 'nothing was sent to GitHub');
    eq(gh.puts.length, 0, 'and nothing written');
    const again = createStore({fetchImpl: counting, keyPrefix: prefix, now: fixedNow});
    again.seed({paused: ['something-else'], saved: {}});
    eq(again.view().paused, ['x'], 'a later visit keeps their choices, not the published list');
    eq(again.view().lastSeen, '2026-11-16T04:00:00Z', 'and their seen marker');
    again.setLocal({paused: ['p1', 'p2'], saved: {}, lastSeen: null});
    eq(again.view().paused, ['p1', 'p2'], 'a starter pack or carried setup replaces it');
  },
  async 'adding a token switches to the repository and leaves the visitor copy alone'() {
    const gh = fakeGitHub({paused: ['repo'], saved: {}});
    const prefix = `batest${++n}.`;
    const st = createStore({fetchImpl: gh.fetch, delay: 20, keyPrefix: prefix});
    st.seed({paused: ['pub'], saved: {}});
    st.queue({t: 'pause', ids: ['mine'], off: true});
    st.setToken('test-token');
    eq(st.mode(), 'owner', 'owner with a token');
    st.seed(gh.state()); await st.refresh();
    eq(st.view().paused, ['repo'], 'owner sees the repository state');
    st.setToken('');
    eq(st.view().paused, ['mine', 'pub'], 'removing the token returns to the visitor copy');
  },
  'starter packs follow the chosen groups, minus what Angus has paused'() {
    const sources = [{id: 'a', group: 'BBC'}, {id: 'b', group: 'BBC'}, {id: 'c', group: 'NTS'}, {id: 'd', group: 'Bass'}, {id: 'e', group: 'Writing'}];
    eq(followedBy(['radio'], sources, ['b']).map(s => s.id), ['a'], 'radio pack: BBC shows he follows');
    eq(pausedFor(['radio', 'underground'], sources, ['b']), ['b', 'd', 'e'], 'everything else is paused');
    eq(pausedFor(['words'], sources, []), ['a', 'b', 'c', 'd'], 'one pack');
    ok(PACKS.every(p => p.id && p.name && p.groups.length), 'every pack is complete');
  },
  'a source can sit in extra categories as well as its own'() {
    eq(catsOf({group: 'NTS', also: ['Techno', 'House']}), ['NTS', 'Techno', 'House'], 'main group first, then the extras');
    eq(catsOf({group: 'NTS', also: ['NTS']}), ['NTS'], 'no repeats');
    eq(catsOf({}), ['Other'], 'no group at all');
    const sources = [{id: 'a', group: 'NTS', also: ['Techno']}, {id: 'b', group: 'Rinse FM', also: ['House']}, {id: 'c', group: 'NTS'}, {id: 'd', group: 'Writing'}];
    eq(followedBy(['club'], sources, []).map(s => s.id), ['a', 'b'], 'the house and techno pack takes tagged shows from any station');
    eq(followedBy(['underground'], sources, ['c']).map(s => s.id), ['a', 'b'], 'their own group still counts');
  },
  'new in the catalogue reads the added label'() {
    const now = new Date('2026-11-16T04:00:00Z');
    eq(addedDate('6 Nov', now).toISOString().slice(0, 10), '2026-11-06', 'a plain label');
    eq(addedDate('sweep', now).toISOString().slice(0, 10), '2026-10-01', 'a batch name');
    eq(addedDate('start', now), null, 'the originals have no date');
    eq(addedDate('20 Dec', now).toISOString().slice(0, 10), '2025-12-20', 'a date ahead of today belongs to last year');
    ok(isNewInCatalogue({added: '6 Nov'}, now), 'ten days ago is new');
    ok(!isNewInCatalogue({added: 'oct11'}, now), 'five weeks ago is not');
    ok(!isNewInCatalogue({added: 'start'}, now), 'nor are the originals');
  },
  async 'a feed or a whole setup survives the trip through a link'() {
    const ids = Array.from({length: 40}, (_, i) => 'show-' + i);
    const state = {paused: ids.slice(0, 30), lastSeen: '2026-11-16T04:00:00Z',
      saved: {'show-31:ep1': {sid: 'show-31', sname: 'Show 31', group: 'NTS', id: 'ep1', title: 'Épisode “one”', url: 'https://x/1', date: '2026-11-10T00:00:00Z', savedAt: '2026-11-11T00:00:00Z', desc: 'd'.repeat(400), links: [{t: 'a', u: 'b'}]}}};
    const feed = await encodeSetup(state, ids, 'feed');
    ok(/^[zj][A-Za-z0-9_-]+$/.test(feed), 'the code is safe in an address');
    const f = await decodeSetup(feed, ids);
    eq([f.kind, f.following, f.paused.length, Object.keys(f.saved).length, f.lastSeen], ['feed', 10, 30, 0, null], 'a shared feed carries the selection only');
    eq(f.paused, [...state.paused].sort(), 'the same shows are off');
    const s = await decodeSetup(await encodeSetup(state, ids, 'setup'), ids);
    eq([s.kind, s.following, s.lastSeen], ['setup', 10, '2026-11-16T04:00:00Z'], 'a setup carries the seen marker too');
    eq(s.saved['show-31:ep1'].title, 'Épisode “one”', 'and the saved cards, accents intact');
    ok(s.saved['show-31:ep1'].desc.length <= 160 && !s.saved['show-31:ep1'].links, 'trimmed to what a card needs');
    const later = await decodeSetup(feed, [...ids.slice(5), 'brand-new']);
    eq(later.following, 10, 'a "followed" list ignores shows added since');
    ok(later.paused.includes('brand-new') && !later.paused.includes('show-0'), 'new shows are off; shows that left the catalogue are dropped');
    const mostlyOn = await decodeSetup(await encodeSetup({paused: ['show-1']}, ids, 'feed'), [...ids, 'brand-new']);
    eq(mostlyOn.paused, ['show-1'], 'a "switched off" list leaves shows added since switched on');
    let threw = false; try { await decodeSetup('znot-a-real-code', ids); } catch (e) { threw = true; }
    ok(threw, 'junk is refused');
    ok(setupLink('zabc').endsWith('#setup=zabc'), 'the link');
  },
  'the compact form for a QR code carries the same choices in far fewer characters'() {
    const ids = Array.from({length: 212}, (_, i) => 'source-number-' + i);
    const state = {paused: ids.slice(0, 144), lastSeen: '2026-11-16T04:00:00Z',
      saved: {a: {sid: ids[150], id: 'episode-one', title: 'T', url: 'u'}, b: {sid: ids[151], id: 'tag:soundcloud-2010:tracks-1', title: 'T2', url: 'u2'}}};
    const code = encodeCompact(state, ids);
    ok(/^q[A-Za-z0-9_-]+$/.test(code), 'safe in an address');
    ok(code.length < 320, `short enough for an easy QR code (${code.length} characters for 68 shows and 2 saved)`);
    return decodeSetup(code, ids).then(d => {
      eq([d.kind, d.following, d.lastSeen, d.savedCount], ['setup', 68, '2026-11-16T04:00:00Z', 2], 'the selection and seen marker');
      eq(d.paused, [...state.paused].sort(), 'the same shows are off');
      eq(d.savedRefs, [{sid: ids[150], item: hash32('episode-one')}, {sid: ids[151], item: hash32('tag:soundcloud-2010:tracks-1')}], 'saved cards by fingerprint, for the feed to fill in');
      eq(encodeCompact({paused: []}, ['same', 'same']), null, 'a fingerprint clash falls back to the full link');
    });
  },
  'QR: the tables give the capacities and patterns the standard lists'() {
    eq([1, 2, 5, 10, 16, 20, 40].map(dataCodewords), [16, 28, 86, 216, 453, 669, 2334], 'data codewords at level M');
    eq([1, 2, 7, 40].map(v => Math.floor(rawDataModules(v) / 8)), [26, 44, 196, 3706], 'total codewords');
    eq([1, 2, 7, 14, 32, 40].map(alignmentPositions), [[], [6, 18], [6, 22, 38], [6, 26, 46, 66], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142, 170]], 'alignment pattern centres');
    eq([10, 13, 16, 20, 22, 27, 36].map(alignmentPositions), [[6, 28, 50], [6, 34, 62], [6, 26, 50, 74], [6, 34, 62, 90], [6, 26, 50, 74, 98], [6, 34, 62, 90, 118], [6, 24, 50, 76, 102, 128, 154]], 'and for the sizes a setup code is likely to use');
    eq([0, 1, 2, 3, 4, 5, 6, 7].map(m => formatBits(m).toString(2).padStart(15, '0')),
       ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'], 'format information for level M');
    eq([7, 8, 40].map(v => versionBits(v).toString(16)), ['7c94', '85bc', '28c69'], 'version information');
  },
  'QR: error correction and layout'() {
    // The worked example every QR tutorial uses: HELLO WORLD at version 1, level M.
    eq(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23], 'Reed-Solomon remainder');
    const c = codewords('hello');
    eq([c.ver, c.data.slice(0, 7), c.data.length, c.all.length], [1, [0x40, 0x56, 0x86, 0x56, 0xC6, 0xC6, 0xF0], 16, 26], 'byte mode: header, data, padding, then error correction');
    eq(c.data.slice(7), [0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC], 'pad bytes alternate');
    const long = codewords('x'.repeat(400));
    eq([long.ver, long.blocks.length, long.all.length], [15, 10, 655], 'a long text picks a bigger version and splits into blocks');
    const q = qrMatrix('https://angusthomaspaterson.github.io/back-announce/#setup=qTEST');
    eq(q.size, q.version * 4 + 17, 'size follows the version');
    const row = y => q.modules[y].slice(0, 7).map(Number).join('');
    eq([row(0), row(1), row(2), row(6)], ['1111111', '1000001', '1011101', '1111111'], 'a finder pattern in the corner');
    ok(q.modules[q.size - 8][8] === true, 'the always-dark module');
    ok(q.modules[6].slice(8, q.size - 8).every((v, i) => v === (i % 2 === 0)), 'the timing pattern alternates');
    ok(q.mask >= 0 && q.mask <= 7 && qrSvg('hi').startsWith('<svg'), 'a mask is chosen and it draws');
  },
  'Suggest a show: a pasted link is recognised and checked against the catalogue'() {
    const sources = [
      {id: 'nts-moxie', kind: 'nts', slug: 'moxie', name: 'Moxie', home: 'https://www.nts.live/shows/moxie'},
      {id: 'rinse-papaoul', kind: 'rinse', slug: 'papaoul', name: 'Papaoul', home: 'https://www.rinse.fm/shows/papaoul'},
      {id: 'transitions', kind: 'mixcloud', user: 'JohnDigweed', name: 'Transitions', home: 'https://www.mixcloud.com/JohnDigweed/'},
      {id: 'ttt', kind: 'rss', name: 'Time To Track', home: 'https://soundcloud.com/andrew-wowk', url: 'https://feeds.soundcloud.com/users/soundcloud:users:1/sounds.rss'},
      {id: 'bbc-em', kind: 'bbc', pid: 'b006wkfp', name: 'Essential Mix', home: 'https://www.bbc.co.uk/programmes/b006wkfp'},
      {id: 'triplej-doof', kind: 'abc', name: 'Doof', home: 'https://www.abc.net.au/triplej/programs/doof'},
      {id: 'first-floor', kind: 'rss', name: 'First Floor', home: 'https://firstfloor.substack.com/', url: 'https://firstfloor.substack.com/feed'},
      {id: 'crack', kind: 'rss', name: 'Crack Magazine', home: 'https://crackmagazine.net/', url: 'https://crackmagazine.net/feed/'},
    ];
    const c = u => classifyLink(u, sources), have = u => (c(u).existing || {}).id || null;
    eq([c('https://www.nts.live/shows/a-new-show').kind, c('https://www.nts.live/shows/a-new-show').name, have('https://www.nts.live/shows/a-new-show')], ['nts', 'A New Show', null], 'a new NTS show, named from its address');
    eq(have('www.nts.live/shows/moxie/episodes/moxie-1st-october-2026?x=1'), 'nts-moxie', 'an NTS episode of a show already followed, pasted without https');
    eq(have('https://rinse.fm/episodes/papaoul-06-10-2026-1000'), 'rinse-papaoul', 'a Rinse episode points at its show');
    eq(have('https://www.mixcloud.com/johndigweed/transitions-1154/'), 'transitions', 'Mixcloud, whatever the capitals');
    eq(have('https://soundcloud.com/andrew-wowk/some-track'), 'ttt', 'a SoundCloud track from an account already followed');
    eq([have('https://www.bbc.co.uk/sounds/brand/b006wkfp'), have('https://www.bbc.co.uk/programmes/b006wkfp'), have('https://www.bbc.co.uk/sounds/play/m00332wf')], ['bbc-em', 'bbc-em', null], 'a BBC show matches; a single episode cannot be matched here');
    eq(have('https://www.abc.net.au/triplej/programs/doof/doof/107305402'), 'triplej-doof', 'a triple j episode');
    eq([have('https://firstfloor.substack.com/p/some-post'), have('https://crackmagazine.net/article/x')], ['first-floor', 'crack'], 'a newsletter post and a magazine article match their sources');
    eq([c('https://open.spotify.com/show/abc').kind, !!c('https://open.spotify.com/show/abc').note, c('https://youtu.be/x').kind, c('https://example.org/radio').kind], ['spotify', true, 'youtube', 'site'], 'Spotify and YouTube come with a note; anything else is a website');
    eq([c('').ok, c('just some words').ok, c('Listen: https://www.nts.live/shows/x via the app').url], [false, false, 'https://www.nts.live/shows/x'], 'no link, and a link inside shared text');
    eq(messageFor({url: 'https://x/y', show: 'Y', why: '', from: 'Sam'}), 'A show for Back Announce\n\nLink: https://x/y\nShow: Y\nFrom: Sam', 'the message leaves out empty answers');
    ok(issueLink({url: 'https://x/y', show: 'Y'}).startsWith('https://github.com/angusthomaspaterson/back-announce/issues/new?title=Suggestion%3A%20Y&body='), 'the GitHub issue link');
  },
  'the same episode from two sources shows once'() {
    const it = (sid, title, date, extra = {}) => ({sid, sname: sid, title, date, ...extra});
    const out = dedupeAcross([
      it('ra-podcast', 'EX.818 Marcel Dettmann', '2026-11-11T10:00:00Z'),
      it('ra-exchange', 'EX.818 Marcel Dettmann', '2026-11-11T08:50:00Z', {audio: 'x.mp3'}),
      it('nts-a', 'GiGi FM', '2026-11-11T08:00:00Z'),
      it('nts-b', 'GiGi FM', '2026-11-11T07:00:00Z'),
      it('ra-exchange', 'EX.817 Chase & Status', '2026-11-04T08:00:00Z'),
      it('ra-podcast', 'EX.817 Chase & Status', '2026-11-01T08:00:00Z'),
    ]);
    eq(out.map(i => `${i.sid}:${i.title}`), ['ra-exchange:EX.818 Marcel Dettmann', 'nts-a:GiGi FM', 'nts-b:GiGi FM', 'ra-exchange:EX.817 Chase & Status', 'ra-podcast:EX.817 Chase & Status'],
       'the playable copy wins; short titles and copies days apart stay');
  },
  'Spotify searches are tidy'() {
    eq(spotifySearch('Popcast (New York Times) Has Taylor Swift jumped the shark?'), 'https://open.spotify.com/search/Popcast%20Has%20Taylor%20Swift%20jumped%20the%20shark%3F', 'drops the bracketed part');
    eq(spotifySearch('Quivver – Alternate Futures'), 'https://open.spotify.com/search/Quivver%20Alternate%20Futures', 'drops the dash');
    eq(spotifySearch('  '), null, 'nothing to search');
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
