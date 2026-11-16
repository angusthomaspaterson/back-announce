// Where the data comes from. Without a token everything is read from this site's own
// copy of data/, which GitHub Pages republishes after every refresh. (With a token,
// milestone 3, state.json is read and written through the GitHub API instead.)
export const REPO = {owner: 'angusthomaspaterson', repo: 'back-announce', branch: 'main'};

async function getJSON(path) {
  const r = await fetch(path, {cache: 'no-cache'});
  if (!r.ok) throw new Error(`${path} came back ${r.status}`);
  return r.json();
}

/** Load the bundle (sources, status and every feed), the app state and Angus's public picks. */
export async function loadAll() {
  const [bundle, state, picks] = await Promise.all([
    getJSON('data/bundle.json'),
    getJSON('data/state.json').catch(() => ({paused: [], saved: {}, lastSeen: null})),
    getJSON('data/picks.json').catch(() => ({items: []})),
  ]);
  return {bundle, state, picks: Array.isArray(picks && picks.items) ? picks.items : []};
}
