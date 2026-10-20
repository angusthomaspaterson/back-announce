# Back Announce

A personal feed of radio shows, mixes, podcasts and writing where a presenter or writer gives context. No algorithm, just about 150 sources chosen by hand, gathered into one timeline.

This repository is the one place that holds everything:

| Folder | What it holds | Who writes it |
| --- | --- | --- |
| `data/sources.json` | The source list | The apps, when a source is added or regrouped |
| `data/state.json` | Paused sources, saved cards and the "last seen" time | The apps |
| `data/feed/<id>.json` | The newest 25 items from each source | The gatherer only |
| `data/status.json` | When the gatherer last ran and how each source went | The gatherer only |
| `gatherer/` | The Python script that reads every source, and its tests | |
| `web/` | The web app, published on GitHub Pages | |
| `android/` | The Android app | |
| `seed/`, `reference/` | The export from the old Claude version, kept for reference | |

## How the feed refreshes

A GitHub Actions workflow, `.github/workflows/gather.yml`, runs once a day at about 5:17 am Perth time, whenever `data/sources.json` changes (so a new source arrives within minutes), and whenever you press **Run workflow** on the Actions tab. It reads every source in parallel (6 at a time), keeps the newest 25 items per source, and commits the result with a message like `feed: refresh Wed 14 Oct 05:17 AWST`.

It also writes `data/glance.json`, a small summary (the newest 20 items from sources that aren't paused, the count of new ones, upcoming releases and the Saved list). A Claude routine copies it into the Back Announce page in Claude each morning at 7 am, because Claude pages can't read other websites themselves.

- A source that fails keeps its previous items. The error is recorded in `data/status.json`, so the apps can show "failed" against it.
- Bandcamp Daily and Bandcamp Radio sit behind a bot check that sometimes refuses scripts. When that happens the source is marked `linkOnly` and the apps show a card that opens the site. The gatherer tries again every run and recovers on its own.
- If the apps push a change while the gatherer is running, the gatherer starts again from the newest commit and pushes again.

### Substack and YouTube are gathered from the laptop

Substack puts a browser check in front of its feeds for requests from cloud servers, including GitHub's, and YouTube answers GitHub's servers with "not found" for channel feeds, so the workflow skips every source whose address contains `substack.com` or `youtube.com`. Those are gathered by a small scheduled task on Angus's laptop instead, `tools/laptop-substack.ps1`, which keeps its own copy of the repository under `%LOCALAPPDATA%\BackAnnounce\repo`, runs once a day at 5:30 am (or as soon as the laptop is next on), and commits as `feed: refresh Substack ... (laptop)`. Install or remove it with `tools/install-laptop-task.ps1`. Its log is `%LOCALAPPDATA%\BackAnnounce\laptop-substack.log`.

### If the schedule ever stops

GitHub switches off scheduled workflows in a public repository after 60 days without a commit. The refresh commits normally keep it alive, but if the feed goes stale:

1. Open the repository on github.com and click the **Actions** tab.
2. Click **Gather the feed** in the left column.
3. If there is a yellow banner saying the workflow was disabled, click **Enable workflow**.
4. Click **Run workflow**, then the green **Run workflow** button, to refresh straight away.

## The web app

The site in `web/` is plain HTML, CSS and JavaScript with no build step. `.github/workflows/pages.yml` publishes it, together with a copy of `data/`, to GitHub Pages at **https://angusthomaspaterson.github.io/back-announce/**. It republishes whenever `web/` or `data/` changes on main, and the gatherer asks for a republish after every refresh, so the site is never more than a few minutes behind the repository.

- `#feed`, `#saved`, `#source/<id>` and `#onair` are deep links.
- The gatherer also writes `data/bundle.json`, every feed file plus the source list and status in one document, so the app loads in two requests instead of 150.
- It is a progressive web app: `manifest.webmanifest` and `sw.js` let Chrome install it with its own icon, and the shell and the last feed are cached for offline reading.
- Without a GitHub token it is read only: Save, Pause and Mark all seen are hidden.
- `#sources` is the Sources screen: a switch per source, Pause or Resume per group, the batch buttons, and each source's latest date or "failed".

To try it on a computer, serve the `web/` folder with any static server and put a copy of `data/` inside it (that copy is ignored by git). Open `tests/index.html` on the same server to run the tests for the write path. On localhost, setting `sessionStorage['ba.mock'] = '1'` swaps GitHub for a pretend one kept in the browser, so writes can be tried without a token; neither file is published.

## Saving, pausing and marking seen

With a token, the apps change `data/state.json` through GitHub's contents API (`PUT /repos/{owner}/{repo}/contents/data/state.json` with the file's current `sha`). The web app's logic is in `web/js/store.js`:

- Each change is queued on the device and sent about two seconds after the last one, so a burst of taps becomes one commit, named like `state: pause Moxie (web)`.
- If another device changed the file first, GitHub answers 409. The app reads the file again, applies the same changes on top and tries again, so neither device's changes are lost.
- If the device is offline, changes wait on the device and are sent when the connection is back.
- With a token, `state.json` is read from GitHub directly, so changes from the other device show when the app is reopened or Refresh is pressed.

### Making the token

Make one token per device, so either can be cancelled on its own.

1. On the device, open https://github.com/settings/personal-access-tokens/new and sign in.
2. **Token name:** `Back Announce Pixel` or `Back Announce Laptop`.
3. **Expiration:** the longest option offered. Note the date; when it passes, the app says the token was not accepted, and you make a new one.
4. **Repository access:** choose **Only select repositories**, then pick **back-announce**.
5. **Permissions:** under **Repository permissions**, set **Contents** to **Read and write**. Leave everything else. GitHub adds **Metadata: Read-only** by itself, which is expected.
6. Press **Generate token** and copy it. It starts with `github_pat_`.
7. In Back Announce, press the Settings button (top right, the two sliders), paste it, and press **Save token**. The app checks it with GitHub before keeping it.

The token stays in that browser's storage on that device. It is never committed, never logged, and only ever sent to `api.github.com`. To cancel one, delete it on the same GitHub page under **Fine-grained tokens**, and press **Remove token** in Settings.

## Running the gatherer on a computer

Python 3.10 or newer, nothing else to install.

```bash
python gatherer/gather.py --data data
```

Add `--only first-floor,nts-moxie` to try a couple of sources. Run the tests with:

```bash
python -m unittest discover -s gatherer/tests -v
```

The tests read saved copies of real feeds from `gatherer/tests/fixtures/` and never touch the network.

## Data formats

**A source** (`data/sources.json`, under `items`):

```json
{"id": "nts-moxie", "name": "Moxie", "kind": "nts", "group": "NTS", "home": "https://www.nts.live/shows/moxie", "added": "start", "slug": "moxie"}
```

`kind` is one of `rss` (needs `url`), `nts` (needs `slug`), `rinse` (needs `slug`), `mixcloud` (needs `user`) or `manual` (a web page read from `home`: Bandcamp Daily, Bandcamp Radio, or Anjunadeep's release list at anjunadeep.com/music). Optional: `rollup` folds matching titles into one item per day, `image` is a fallback picture, and `upcoming: true` (for a release schedule) dates an unreleased item by when it was first seen, so it appears when announced and returns to the top on release day. `match` keeps only the titles a regex matches (for a YouTube channel that also posts single tracks and teasers), `accumulate: true` keeps earlier items when the feed only shows its latest few (YouTube channel feeds show 15 uploads), and `spotify` names the Spotify search for the app's Spotify button, with `{title}` and `{num}` (the episode number) filled in.

**A feed file** (`data/feed/<id>.json`):

```json
{"id": "nts-moxie", "name": "Moxie", "kind": "nts", "home": "...", "updatedAt": "2026-10-13T04:17:00Z",
 "items": [{"id": "...", "title": "...", "url": "...", "date": "2026-10-12T19:00:00Z", "desc": "...",
            "image": "https://...", "audio": "https://...mp3", "duration": "3600", "tags": "...", "links": [{"t": "...", "u": "..."}]}]}
```

`updatedAt` is the last time the items changed. `linkOnly: true` means the site refused the gatherer.

**State** (`data/state.json`): `paused` is a list of source ids, `lastSeen` is the time "Mark all seen" was last pressed, and `saved` maps a key to a full copy of a card, with `savedAt`, the source id as `sid` and the source name as `sname`.

## Privacy

The repository is public so that GitHub Pages can host the web app for free. That means the source list, the paused list and the saved cards are visible to anyone who finds it. Nothing private should be committed here, and the GitHub access token the apps use to write lives only on your own devices.
