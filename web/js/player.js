// A small sticky player for audio enclosures and the plain live streams.
import {$} from './util.js';

export function play(url, name, sub) {
  const a = $('audio');
  // The published site is https, so a plain http stream would be blocked as mixed content.
  if (location.protocol === 'https:') url = url.replace(/^http:/i, 'https:');
  $('pName').textContent = name || ''; $('pSub').textContent = sub || '';
  $('player').hidden = false; document.body.classList.add('has-player');
  if (a.src !== url) { a.src = url; }
  a.play().catch(() => {});
}
export function stop() {
  const a = $('audio'); a.pause(); a.removeAttribute('src'); a.load();
  $('player').hidden = true; document.body.classList.remove('has-player');
}
export function wirePlayer() { $('pClose').addEventListener('click', stop); }
/** Browsers other than Safari cannot play HLS (.m3u8) in a plain audio element. */
export const playable = url => !!url && !/\.m3u8(\?|$)/i.test(url);
