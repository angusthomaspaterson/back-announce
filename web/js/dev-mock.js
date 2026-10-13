// Local testing only: a pretend GitHub that keeps data/state.json in sessionStorage.
// app.js loads it only on localhost when sessionStorage 'ba.mock' is '1'. It is removed
// from the published site by pages.yml, and nothing here ever contacts GitHub.
import {b64encode, b64decode} from './store.js';

const KEY = 'ba.mockRepo';
const resp = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
async function repo() {
  let r = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  if (!r) {
    const text = await (await fetch('data/state.json', {cache: 'no-store'})).text();
    r = {text, n: 1, sha: 'mock1', commits: []};
    sessionStorage.setItem(KEY, JSON.stringify(r));
  }
  return r;
}
export async function mockFetch(url, opts = {}) {
  if (!String(url).startsWith('https://api.github.com/')) return fetch(url, opts);
  const r = await repo();
  const method = (opts.method || 'GET').toUpperCase();
  await new Promise(res => setTimeout(res, 200));
  if (method === 'GET') return resp(200, {sha: r.sha, content: b64encode(r.text)});
  const body = JSON.parse(opts.body);
  if (body.sha !== r.sha) return resp(409, {message: `data/state.json does not match ${body.sha}`});
  r.text = b64decode(body.content); r.sha = 'mock' + (++r.n); r.commits.push(body.message);
  sessionStorage.setItem(KEY, JSON.stringify(r));
  return resp(200, {content: {sha: r.sha}});
}
// From the console: baMockEdit(s => s.paused.push('nts-moxie')) pretends the phone changed something.
window.baMockEdit = async fn => {
  const r = await repo(); const s = JSON.parse(r.text); fn(s);
  r.text = JSON.stringify(s, null, 1) + '\n'; r.sha = 'mock' + (++r.n); r.commits.push('edit from another device');
  sessionStorage.setItem(KEY, JSON.stringify(r));
};
window.baMockRepo = () => JSON.parse(sessionStorage.getItem(KEY) || 'null');
