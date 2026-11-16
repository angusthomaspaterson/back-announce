// A feed in a link. There are no accounts and no server, so the only way to move a
// visitor's setup to another device, or to show a friend what you follow, is to put it
// in the address itself: #setup=<code>. The code is the choices as JSON, compressed and
// written in URL-safe base64. Nothing is uploaded; whoever opens the link reads it locally.
//
//   kind 'feed'   the selection of shows only (Share my feed)
//   kind 'setup'  the selection plus Saved cards and the seen marker (take it to another device)

const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Trim a saved card to what a card needs, so a link with a few saves stays a sensible length. */
function slim(card) {
  const c = {};
  for (const k of ['sid', 'sname', 'group', 'id', 'title', 'url', 'date', 'savedAt', 'image', 'audio', 'duration']) if (card[k]) c[k] = card[k];
  if (card.desc) c.desc = String(card.desc).length > 160 ? String(card.desc).slice(0, 159) + '…' : card.desc;
  return c;
}

/**
 * state: {paused, saved, lastSeen}; allIds: every source id in the catalogue.
 * Whichever is shorter is written: the shows followed, or the shows switched off.
 */
export async function encodeSetup(state, allIds, kind = 'feed') {
  const paused = new Set(state.paused || []);
  const off = allIds.filter(id => paused.has(id)), on = allIds.filter(id => !paused.has(id));
  const doc = {v: 1, k: kind};
  if (on.length <= off.length) doc.f = on; else doc.p = off;
  if (kind === 'setup') {
    const saved = {};
    for (const [key, card] of Object.entries(state.saved || {})) saved[key] = slim(card);
    if (Object.keys(saved).length) doc.s = saved;
    if (state.lastSeen) doc.t = state.lastSeen;
  }
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (e) {}
  }
  return 'j' + b64url(raw);
}

/** Read a code back. Returns {kind, paused, following, saved, lastSeen}; throws if it isn't one of ours. */
export async function decodeSetup(code, allIds) {
  code = String(code || '').trim();
  const body = unb64url(code.slice(1));
  let raw;
  if (code[0] === 'z') raw = await pipe(body, new DecompressionStream('deflate-raw'));
  else if (code[0] === 'j') raw = body;
  else throw new Error('not a Back Announce link');
  const doc = JSON.parse(new TextDecoder().decode(raw));
  if (!doc || doc.v !== 1 || !(Array.isArray(doc.f) || Array.isArray(doc.p))) throw new Error('not a Back Announce link');
  const known = new Set(allIds);
  // Shows that have left the catalogue since the link was made are dropped; shows added
  // since are off for a "followed" list and on for a "switched off" list.
  const paused = doc.f ? allIds.filter(id => !doc.f.includes(id)) : doc.p.filter(id => known.has(id));
  const saved = {};
  for (const [key, card] of Object.entries(doc.s || {})) if (card && typeof card === 'object' && card.url) saved[key] = card;
  return {kind: doc.k === 'setup' ? 'setup' : 'feed', paused: paused.sort(), following: allIds.length - paused.length, saved, lastSeen: doc.t || null};
}

/** The full link for a code, on this site. */
export const setupLink = code => `${location.origin}${location.pathname}#setup=${code}`;
