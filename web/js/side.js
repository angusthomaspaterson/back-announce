// The laptop's second column, beside the feed: what's on air now and Angus's latest picks.
// Phones and narrow windows never show it (see .side in app.css), so it is drawn only when wide.
import {$, esc} from './util.js';
import {liveNow, playStation} from './onair.js';
import {S, pickedShows} from './feed.js';

const wide = matchMedia('(min-width: 1100px)');
let timer = null;

export function renderSide() {
  if (!wide.matches || $('feed').hidden) return;
  const on = liveNow();
  $('sideNow').innerHTML = on.length
    ? on.map(o => `<div class="snow" style="--sc:${o.colour}">
        <div class="st"><span class="sw"></span>${esc(o.station)}<span class="left">${esc(o.left)} left</span></div>
        <div class="nm">${esc(o.show)}</div>
        <div class="bar"><i style="width:${o.pct.toFixed(1)}%"></i></div>
        <div class="acts">${o.playable ? `<button class="btn q" data-k="${esc(o.key)}">▶ Play here</button>` : ''}<a class="btn q" href="${esc(o.live)}" target="_blank" rel="noopener">Listen live ↗</a></div>
      </div>`).join('')
    : `<p class="hint">Nothing scheduled on your stations right now.</p>`;
  // Picks are shows: each links to the show's page, with its latest episode and the start of the note.
  const picks = pickedShows().slice(0, 4);
  $('sidePicksBox').hidden = !picks.length;
  $('sidePicks').innerHTML = picks.map(p => `<a class="spick" href="#source/${encodeURIComponent(p.sid)}">
      <b>${esc(p.sname)}</b>${p.latest ? `<span class="sub">Latest: ${esc(p.title)}</span>` : ''}${p.pickNote ? `<span class="nt">${esc(p.pickNote.length > 140 ? p.pickNote.slice(0, 137).replace(/\s+\S*$/, '') + '…' : p.pickNote)}</span>` : ''}</a>`).join('');
}

export function wireSide() {
  $('side').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (b) { playStation(b.dataset.k); S.track('play-live'); }
  });
  wide.addEventListener('change', renderSide);
  clearInterval(timer);
  timer = setInterval(renderSide, 60000);
}
