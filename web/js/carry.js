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
  if (code[0] === 'q') return decodeCompact(code, allIds);
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

// ---- the compact form, for a QR code ----
// A QR code that a phone can read off a screen wants a few hundred characters, not a few
// thousand, so this form names each show by a 3-byte fingerprint of its id and each saved
// card by 7 bytes (its show, then the item). The receiving device rebuilds saved cards
// from its own copy of the feed; a card whose episode has left the feed can't come across
// this way (the full link carries those).
//
//   byte 0      1 = the list is the shows followed, 0 = the shows switched off
//   bytes 1-2   how many shows are listed
//   then        3 bytes per show
//   then 4      the seen marker, seconds since 1970 (0 for none)
//   then 1      how many saved cards, then 7 bytes each
const fnv = s => { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(String(s))) { h ^= b; h = Math.imul(h, 0x01000193); } return h >>> 0; };
export const hash24 = s => fnv(s) & 0xFFFFFF;
export const hash32 = fnv;
const MAX_SAVED = 40;

/** Returns the code, or null when two shows in the catalogue share a fingerprint (then use the full link). */
export function encodeCompact(state, allIds) {
  if (new Set(allIds.map(hash24)).size !== allIds.length) return null;
  const paused = new Set(state.paused || []);
  const off = allIds.filter(id => paused.has(id)), on = allIds.filter(id => !paused.has(id));
  const list = on.length <= off.length ? on : off;
  const refs = Object.values(state.saved || {}).filter(c => c && c.sid && c.id).slice(0, MAX_SAVED);
  const out = [on.length <= off.length ? 1 : 0, list.length >>> 8, list.length & 0xFF];
  for (const id of list) { const h = hash24(id); out.push(h >>> 16, (h >>> 8) & 0xFF, h & 0xFF); }
  const t = state.lastSeen ? Math.floor(new Date(state.lastSeen) / 1000) : 0;
  out.push(t >>> 24, (t >>> 16) & 0xFF, (t >>> 8) & 0xFF, t & 0xFF, refs.length);
  for (const c of refs) {
    const s = hash24(c.sid), i = hash32(c.id);
    out.push(s >>> 16, (s >>> 8) & 0xFF, s & 0xFF, i >>> 24, (i >>> 16) & 0xFF, (i >>> 8) & 0xFF, i & 0xFF);
  }
  return 'q' + b64url(Uint8Array.from(out));
}
function decodeCompact(code, allIds) {
  const b = unb64url(code.slice(1));
  const byHash = new Map(allIds.map(id => [hash24(id), id]));
  const n = (b[1] << 8) | b[2];
  if (b.length < 3 + n * 3 + 5 || b[0] > 1) throw new Error('not a Back Announce link');
  const listed = new Set();
  for (let i = 0, p = 3; i < n; i++, p += 3) { const id = byHash.get((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]); if (id) listed.add(id); }
  let p = 3 + n * 3;
  const t = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const m = b[p + 4]; p += 5;
  const refs = [];
  for (let i = 0; i < m && p + 7 <= b.length; i++, p += 7) {
    const sid = byHash.get((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]);
    if (sid) refs.push({sid, item: ((b[p + 3] << 24) | (b[p + 4] << 16) | (b[p + 5] << 8) | b[p + 6]) >>> 0});
  }
  const paused = b[0] === 1 ? allIds.filter(id => !listed.has(id)) : allIds.filter(id => listed.has(id));
  return {kind: 'setup', paused: paused.sort(), following: allIds.length - paused.length, saved: {}, savedRefs: refs, savedCount: m,
    lastSeen: t ? new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null};
}

/** The full link for a code, on this site. */
export const setupLink = code => `${location.origin}${location.pathname}#setup=${code}`;
