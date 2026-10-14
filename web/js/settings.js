// The Settings panel: add, check and remove the GitHub token for this device.
// The token field is never filled back in; once saved it only says a token is there.
import {$} from './util.js';
import {checkToken} from './store.js';

export function wireSettings({store, fetchImpl, onToken}) {
  const dlg = $('settings'), input = $('tokenIn'), status = $('tokenStatus');
  const say = (msg, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };

  function refresh() {
    const has = store.hasToken(), st = store.status();
    input.value = '';
    input.placeholder = has ? 'A token is saved on this device' : 'github_pat_…';
    $('tokenSave').textContent = has ? 'Replace token' : 'Save token';
    $('tokenRemove').hidden = !has;
    if (!has) say('No token on this device, so the app is read only.');
    else if (st.error) say(st.error, true);
    else say(`Connected. Save, Pause and Mark all seen are on for this device.${st.pending ? ` ${st.pending} change${st.pending === 1 ? '' : 's'} waiting to send.` : ''}`);
  }

  $('settingsBtn').addEventListener('click', () => { refresh(); dlg.showModal(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // tap outside to close
  $('helpLink').addEventListener('click', () => dlg.close());

  $('tokenSave').addEventListener('click', async () => {
    const t = input.value.trim();
    if (!t) { say('Paste the token into the box first.', true); input.focus(); return; }
    if (/\s/.test(t)) { say('That has spaces in it. Copy the token again, on its own.', true); return; }
    const btn = $('tokenSave'); btn.disabled = true; say('Checking with GitHub…');
    const r = await checkToken(t, fetchImpl);
    btn.disabled = false;
    if (!r.ok) { say(r.message, true); return; }
    store.setToken(t);
    input.value = '';
    await onToken(true);
    refresh();
  });

  $('tokenRemove').addEventListener('click', async () => {
    const waiting = store.status().pending;
    store.setToken('');
    await onToken(false);
    refresh();
    if (waiting) say(`Token removed. ${waiting} unsent change${waiting === 1 ? ' was' : 's were'} dropped. The app is read only on this device.`);
  });

  fetch('version.txt', {cache: 'no-store'}).then(r => r.ok ? r.text() : '').catch(() => '')
    .then(v => { $('versionLine').textContent = v.trim() ? `Version ${v.trim()}` : 'Local copy'; });
}
