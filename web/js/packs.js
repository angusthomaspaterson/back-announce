// Starter packs for a first-time visitor, and what counts as new in the catalogue.
// A pack is a named bundle of the catalogue's groups, so it stays current as sources are
// added: nothing here lists individual shows.
import {BATCHES, catsOf} from './util.js';

export const PACKS = [
  {id: 'radio', name: 'Radio presenters', blurb: 'BBC 6 Music and Radio 1, triple j, Double J', groups: ['BBC', 'triple j', 'Double J', 'Radio', 'Perth']},
  {id: 'underground', name: 'Underground radio', blurb: 'NTS and Rinse FM residencies', groups: ['NTS', 'Rinse FM']},
  {id: 'club', name: 'House and techno', blurb: 'Club music from NTS, Rinse FM and beyond', groups: ['House', 'Techno']},
  {id: 'bass', name: 'Bass and jungle', blurb: 'Drum & bass, dubstep, garage', groups: ['Bass']},
  {id: 'prog', name: 'Progressive and mixes', blurb: 'Melodic house, trance, DJ mixes', groups: ['Progressive', 'Mixes']},
  {id: 'words', name: 'Writing and podcasts', blurb: 'Critics, newsletters, interviews', groups: ['Writing', 'Podcasts']},
];

/** The sources a set of packs would follow: those in the packs' groups that Angus himself follows. */
export function followedBy(packIds, sources, ownerPaused) {
  const groups = new Set(PACKS.filter(p => packIds.includes(p.id)).flatMap(p => p.groups));
  const off = new Set(ownerPaused || []);
  return sources.filter(s => catsOf(s).some(g => groups.has(g)) && !off.has(s.id));
}
/** The paused list that gives a visitor exactly those packs. */
export function pausedFor(packIds, sources, ownerPaused) {
  const keep = new Set(followedBy(packIds, sources, ownerPaused).map(s => s.id));
  return sources.filter(s => !keep.has(s.id)).map(s => s.id).sort();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** When a source joined the catalogue, from its `added` label ("6 Nov", or a batch name), or null
 *  for the originals. The label carries no year, so take the latest such date that isn't ahead of now. */
export function addedDate(added, now = new Date()) {
  const label = BATCHES[added] || added || '';
  const m = String(label).match(/^(\d{1,2}) ([A-Za-z]{3})/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  let d = new Date(Date.UTC(now.getUTCFullYear(), mon, +m[1]));
  if (d - now > 864e5) d = new Date(Date.UTC(now.getUTCFullYear() - 1, mon, +m[1]));
  return d;
}
/** Added to the catalogue in the last three weeks. */
export function isNewInCatalogue(source, now = new Date(), days = 21) {
  const d = addedDate(source.added, now);
  return !!d && now - d <= days * 864e5;
}
