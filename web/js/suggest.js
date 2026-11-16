// Suggest a show: a visitor pastes a link, the page says what it is and whether the
// catalogue already has it, and the suggestion goes to Angus. Visitors can't add sources
// themselves (only his list is gathered), so this is how the catalogue grows.
//
// A site on GitHub Pages can't receive a form by itself. Until SUGGEST_FORM in data.js
// names somewhere to post to, the suggestion is written out as a message to send on
// LinkedIn, to post as a GitHub issue, or to copy.
import {$, esc, toast} from './util.js';
import {CURATOR, REPO, SUGGEST_FORM} from './data.js';

const clean = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const words = slug => String(slug || '').replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim();

/**
 * What a pasted link is, without fetching anything: {ok, kind, label, name, note, existing}.
 * `existing` is the catalogue source it matches, if any. Pure, so it can be tested.
 */
export function classifyLink(raw, sources = []) {
  const text = String(raw || '').trim();
  const m = text.match(/https?:\/\/\S+/i) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(text) ? ['https://' + text] : null);
  if (!m) return {ok: false};
  let u;
  try { u = new URL(m[0]); } catch (e) { return {ok: false}; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, ''), parts = u.pathname.split('/').filter(Boolean);
  const find = fn => sources.find(fn) || null;
  const sameHome = find(s => clean(s.home) === clean(u.href) || clean(s.url) === clean(u.href));
  const out = (kind, label, name, existing, note = '') => ({ok: true, url: u.href, kind, label, name: name || '', existing: existing || sameHome, note});

  if (host === 'nts.live' && parts[0] === 'shows' && parts[1]) return out('nts', 'an NTS show', words(parts[1]), find(s => s.kind === 'nts' && s.slug === parts[1]));
  if (host === 'rinse.fm' && (parts[0] === 'shows' || parts[0] === 'episodes') && parts[1]) {
    const slug = parts[0] === 'episodes' ? parts[1].replace(/-\d{2}-\d{2}-\d{4}-\d{4}$/, '') : parts[1];
    return out('rinse', 'a Rinse FM show', words(slug), find(s => s.kind === 'rinse' && s.slug === slug));
  }
  if (host === 'mixcloud.com' && parts[0]) return out('mixcloud', 'a Mixcloud account', words(parts[0]), find(s => s.kind === 'mixcloud' && String(s.user || '').toLowerCase() === parts[0].toLowerCase()));
  if (host === 'soundcloud.com' && parts[0]) return out('soundcloud', 'a SoundCloud account', words(parts[0]), find(s => clean(s.home).startsWith('soundcloud.com/' + parts[0].toLowerCase())));
  if ((host === 'bbc.co.uk' || host === 'bbc.com') && (parts[0] === 'sounds' || parts[0] === 'programmes')) {
    const pid = parts[0] === 'programmes' ? parts[1] : parts[2];
    const ep = parts[0] === 'sounds' && parts[1] === 'play';
    return out('bbc', ep ? 'a BBC Sounds episode' : 'a BBC radio show', '', ep ? null : find(s => s.kind === 'bbc' && s.pid === pid), ep ? "That's one episode. Angus will find the show it belongs to." : '');
  }
  if (host === 'abc.net.au' && parts[1] === 'programs' && parts[2]) {
    return out('abc', parts[0] === 'triplej' ? 'a triple j show' : 'an ABC radio show', words(parts[2].replace(/^doublej-/, '')), find(s => s.kind === 'abc' && clean(s.home).endsWith('/programs/' + parts[2])));
  }
  if (host === 'podcasts.apple.com') return out('podcast', 'a podcast on Apple Podcasts', words((parts[2] || '').replace(/^id\d+$/, '')), null);
  if (host.endsWith('.substack.com') || host === 'substack.com') return out('substack', 'a Substack newsletter', words(host.split('.')[0]), find(s => clean(s.home).startsWith(host) || clean(s.url).startsWith(host)));
  if (host === 'open.spotify.com') return out('spotify', 'a Spotify link', '', null, "Spotify shows can't be followed directly. If it's a podcast, its Apple Podcasts link works better, but send this if it's all you have.");
  if (host === 'youtube.com' || host === 'youtu.be') return out('youtube', 'a YouTube link', '', null, 'YouTube channels are hit and miss for gathering, but send it.');
  if (host.endsWith('bandcamp.com')) return out('bandcamp', 'a Bandcamp page', words(host.split('.')[0]), null);
  return out('site', 'a website or feed', '', find(s => { try { return new URL(s.home || s.url).hostname.replace(/^www\./, '') === host && host.split('.').length >= 2 && !/(soundcloud|mixcloud|substack|apple|bbc|abc\.net|nts|rinse|youtube|spotify)/.test(host); } catch (e) { return false; } }));
}

/** The suggestion as a short message, for LinkedIn, an issue or the clipboard. */
export function messageFor({url, show, why, from}) {
  return ['A show for Back Announce', '', `Link: ${url}`, show ? `Show: ${show}` : '', why ? `Why: ${why}` : '', from ? `From: ${from}` : ''].filter((l, i) => i < 2 || l).join('\n');
}
export const issueLink = v => `https://github.com/${REPO.owner}/${REPO.repo}/issues/new?title=${encodeURIComponent('Suggestion: ' + (v.show || v.url))}&body=${encodeURIComponent(messageFor(v))}`;

const BANNER = `<svg class="sgart" viewBox="0 0 600 150" role="img" aria-label="Suggest a show" preserveAspectRatio="xMidYMid slice">
  <rect width="600" height="150" fill="#121417"/>
  <g fill="none" stroke="#ff6a3d" stroke-linecap="round">
    <path d="M470 118a52 52 0 0 1 0-86" stroke-width="5" opacity=".95"/><path d="M444 132a80 80 0 0 1 0-114" stroke-width="5" opacity=".6"/><path d="M418 146a108 108 0 0 1 0-142" stroke-width="5" opacity=".3"/>
    <path d="M530 118a52 52 0 0 0 0-86" stroke-width="5" opacity=".95"/><path d="M556 132a80 80 0 0 0 0-114" stroke-width="5" opacity=".6"/><path d="M582 146a108 108 0 0 0 0-142" stroke-width="5" opacity=".3"/>
  </g>
  <circle cx="500" cy="75" r="13" fill="#ff6a3d"/>
  <text x="36" y="70" fill="#ecebe4" font-family="'Bricolage Grotesque',sans-serif" font-weight="700" font-size="42" letter-spacing="-1">Suggest a show<tspan fill="#ff6a3d">.</tspan></text>
  <text x="36" y="104" fill="#9a9ea8" font-family="'Instrument Sans',sans-serif" font-size="17">Know a presenter worth hearing? Tell Angus.</text>
</svg>`;

let api = null, sent = false;
const val = id => ($(id) ? $(id).value.trim() : '');
const values = () => ({url: (classifyLink(val('sgLink'), api.sources()).url || val('sgLink')), show: val('sgShow'), why: val('sgWhy'), from: val('sgFrom')});

function verdict() {
  const c = classifyLink(val('sgLink'), api.sources()), box = $('sgVerdict');
  if (!val('sgLink')) { box.innerHTML = ''; return c; }
  if (!c.ok) { box.innerHTML = '<p class="sgno">That doesn\'t look like a link yet. Paste the address of the show\'s page.</p>'; return c; }
  if (c.existing) {
    const off = api.isPaused(c.existing.id);
    box.innerHTML = `<p class="sghave">Already in the catalogue: <b>${esc(c.existing.name)}</b>${off ? ', but it\'s switched off in your feed' : ''}.</p>
      <div class="setrow"><button type="button" class="btn" data-open="${esc(c.existing.id)}">Open its page</button>${off ? `<button type="button" class="btn p" data-on="${esc(c.existing.id)}">Switch it on</button>` : ''}</div>`;
    return c;
  }
  box.innerHTML = `<p class="sgok">That looks like ${esc(c.label)}, and it isn't in the catalogue yet.</p>${c.note ? `<p class="hint">${esc(c.note)}</p>` : ''}`;
  if (c.name && !val('sgShow')) $('sgShow').value = c.name;
  return c;
}

function render() {
  const first = esc(CURATOR.name.split(' ')[0]);
  $('suggestBody').innerHTML = sent
    ? `${BANNER}<div class="sgdone"><h2>Thanks. That's on its way to ${first}.</h2><p>If it fits, it'll turn up in the catalogue, tagged New.</p><div class="setrow"><button type="button" class="btn p" id="sgAgain">Suggest another</button><button type="button" class="btn" id="sgBack">Back to the feed</button></div></div>`
    : `${BANNER}
    <p class="lead">Back Announce only gathers shows ${first} has chosen, so this is how the catalogue grows. Paste a link to a radio show, a mix series, a podcast or a writer, and say why it belongs.</p>
    <label for="sgLink">Link to the show</label>
    <input id="sgLink" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://www.nts.live/shows/…">
    <div id="sgVerdict" aria-live="polite"></div>
    <label for="sgShow">What's it called? <span class="opt">optional</span></label>
    <input id="sgShow" type="text" autocomplete="off" maxlength="120">
    <label for="sgWhy">Why does it belong here? <span class="opt">optional</span></label>
    <textarea id="sgWhy" rows="3" maxlength="500" placeholder="Who presents it, and what do they do that an algorithm can't?"></textarea>
    <label for="sgFrom">Your name <span class="opt">optional</span></label>
    <input id="sgFrom" type="text" autocomplete="name" maxlength="80">
    ${SUGGEST_FORM.action
      ? `<div class="setrow"><button type="button" class="btn p big" id="sgSend">Send to ${first}</button></div>`
      : `<div class="setrow"><button type="button" class="btn p big" id="sgLinkedIn" title="Copies your suggestion, then opens ${first}'s LinkedIn so you can paste it into a message">Copy, then message ${first} on LinkedIn ↗</button></div>
         <div class="setrow"><button type="button" class="btn" id="sgIssue" title="For people with a GitHub account">Post it on GitHub ↗</button><button type="button" class="btn" id="sgCopy">Copy the suggestion</button></div>`}
    <p class="setstatus" id="sgStatus" role="status"></p>
    <p class="hint">Nothing here is stored or tracked. Your suggestion goes only where you send it.</p>`;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { window.prompt('Copy this:', text); return false; }
}
function need() {
  const c = verdict();
  if (!c.ok) { $('sgStatus').textContent = 'Add a link to the show first.'; $('sgLink').focus(); return null; }
  if (c.existing) { $('sgStatus').textContent = `${c.existing.name} is already in the catalogue.`; return null; }
  $('sgStatus').textContent = '';
  return values();
}

export function wireSuggest(hooks) {
  api = hooks;
  const view = $('suggestView');
  view.addEventListener('input', e => { if (e.target.id === 'sgLink') verdict(); });
  view.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'suggestBack' || b.id === 'sgBack') api.back();
    else if (b.dataset.open) api.open(b.dataset.open);
    else if (b.dataset.on) { api.resume(b.dataset.on); verdict(); }
    else if (b.id === 'sgAgain') { sent = false; render(); $('sgLink').focus(); }
    else if (b.id === 'sgCopy') { const v = need(); if (v && await copy(messageFor(v))) $('sgStatus').textContent = 'Copied. Paste it wherever you like.'; }
    else if (b.id === 'sgIssue') { const v = need(); if (v) window.open(issueLink(v), '_blank', 'noopener'); }
    else if (b.id === 'sgLinkedIn') {
      const v = need(); if (!v) return;
      await copy(messageFor(v));
      toast('Copied. Paste it into a message on LinkedIn.');
      window.open(CURATOR.linkedin, '_blank', 'noopener');
    } else if (b.id === 'sgSend') {
      const v = need(); if (!v) return;
      b.disabled = true; $('sgStatus').textContent = 'Sending…';
      const body = new URLSearchParams();
      for (const k of ['url', 'show', 'why', 'from']) if (SUGGEST_FORM.fields[k]) body.set(SUGGEST_FORM.fields[k], v[k]);
      // A form on another site answers without letting this page read the reply, so a
      // request that leaves without a network error is taken as sent.
      try { await fetch(SUGGEST_FORM.action, {method: 'POST', mode: 'no-cors', body}); sent = true; render(); }
      catch (err) { b.disabled = false; $('sgStatus').textContent = "Couldn't send it. Check the connection and try again."; }
    }
  });
}

/** Called whenever the Suggest screen is shown. */
export function showSuggest() {
  $('title').textContent = 'Suggest a show';
  if (!$('sgLink') && !sent) render();
  else if (sent && !$('sgAgain')) render();
}
