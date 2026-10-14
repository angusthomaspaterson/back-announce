// Local testing only: a pretend GitHub that keeps changed files in sessionStorage.
// app.js loads it only on localhost when sessionStorage 'ba.mock' is '1'. It is removed
// from the published site by pages.yml, and nothing here ever contacts GitHub.
//
// It also pretends to be the check-source workflow: a few seconds after the app writes
// data/requests/<id>.json, it writes <id>.result.json. A link containing "fail" is refused,
// one containing "gigi" is already followed, anything else becomes "Mock Show" with the
// latest GiGi FM episodes as its preview.
import {b64encode, b64decode} from './store.js';

const KEY = 'ba.mockFiles';
const resp = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const load = () => JSON.parse(sessionStorage.getItem(KEY) || '{}');
const keep = files => sessionStorage.setItem(KEY, JSON.stringify(files));
let n = Date.now();

async function read(path) {
  const files = load();
  if (files[path]) return files[path].deleted ? null : files[path];
  const r = await fetch(path, {cache: 'no-store'});   // fall back to the local copy of data/
  if (!r.ok) return null;
  const f = {text: await r.text(), sha: 'local-' + path};
  const fresh = load();   // re-read: another request may have written while we waited
  if (!fresh[path]) { fresh[path] = f; keep(fresh); }
  return fresh[path] || f;
}
function write(path, text, message) {
  const files = load();
  files[path] = {text, sha: 'mock' + (++n)};
  files.__commits = [...(files.__commits || []), message];
  keep(files);
  return files[path];
}

export async function mockFetch(url, opts = {}) {
  const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/);
  if (!m) return fetch(url, opts);
  const path = decodeURIComponent(m[1]);
  const method = (opts.method || 'GET').toUpperCase();
  await new Promise(res => setTimeout(res, 200));
  const cur = await read(path);
  if (method === 'GET') return cur ? resp(200, {sha: cur.sha, content: b64encode(cur.text)}) : resp(404, {message: 'Not Found'});
  const body = JSON.parse(opts.body);
  if (cur && body.sha !== cur.sha) return resp(409, {message: `${path} does not match ${body.sha}`});
  if (!cur && body.sha) return resp(409, {message: `${path} does not exist`});
  const f = write(path, b64decode(body.content), body.message);
  const req = path.match(/^data\/requests\/([^/.]+)\.json$/);
  if (req) setTimeout(() => pretendCheck(req[1], JSON.parse(f.text).url), 3000);
  return resp(cur ? 200 : 201, {content: {sha: f.sha}});
}

async function pretendCheck(id, url) {
  let result;
  if (/fail/.test(url)) result = {ok: false, url, error: "Spotify doesn't publish feeds. Try the show's Apple Podcasts link or its own website instead."};
  else if (/gigi/.test(url)) result = {ok: true, url, duplicate: {id: 'nts-gigi-fm', name: 'GiGi FM'}};
  else {
    const feed = JSON.parse((await read('data/feed/nts-gigi-fm.json')).text);
    result = {ok: true, url, source: {id: 'nts-mock-show', name: 'Mock Show', kind: 'nts', slug: 'mock-show', home: 'https://www.nts.live/shows/mock-show'}, items: feed.items.slice(0, 5), note: ''};
  }
  write(`data/requests/${id}.result.json`, JSON.stringify(result, null, 1), 'sources: answer add-source request');
}

// From the console: baMockEdit('data/state.json', s => s.paused.push('nts-moxie')) pretends the phone changed something.
window.baMockEdit = async (path, fn) => { const f = await read(path); const s = JSON.parse(f.text); fn(s); write(path, JSON.stringify(s, null, 1) + '\n', 'edit from another device'); };
window.baMockFiles = load;
