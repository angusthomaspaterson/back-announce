// Where the data comes from. Without a token everything is read from this site's own
// copy of data/, which GitHub Pages republishes after every refresh. (With a token,
// milestone 3, state.json is read and written through the GitHub API instead.)
export const REPO = {owner: 'angusthomaspaterson', repo: 'back-announce', branch: 'main'};
// Who curates this feed, for the credit line and for suggestions.
export const CURATOR = {name: 'Angus Paterson', linkedin: 'https://www.linkedin.com/in/angusthomaspaterson/', portfolio: 'https://anguspatersonux.com/'};
// Where the Suggest a show page posts to. Empty until there is somewhere: then the page
// offers LinkedIn, a GitHub issue or the clipboard instead. For a Google Form, `action` is
// its .../formResponse address and `fields` maps each answer to the form's entry.NNN name.
export const SUGGEST_FORM = {
  action: 'https://docs.google.com/forms/d/e/1FAIpQLSckB6AhZAzTY14L05JPBHtl4ZZ6Fits11wT9SSvRR8Vu3cGiw/formResponse',
  fields: {url: 'entry.1056076283', show: 'entry.489576792', why: 'entry.128588031', from: 'entry.209701407'},
};
// Anonymous visit counting (goatcounter.com): which screens are opened and how often Play,
// Save and so on are pressed. Never which show or episode, no cookies. Devices with a token,
// and copies running on this computer, are not counted. Empty code = no counting.
export const COUNTER = {code: 'backannounce'};

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
