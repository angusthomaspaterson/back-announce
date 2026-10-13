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

A GitHub Actions workflow, `.github/workflows/gather.yml`, runs every 6 hours and whenever you press **Run workflow** on the Actions tab. It reads every source in parallel (6 at a time), keeps the newest 25 items per source, and commits the result with a message like `feed: refresh Tue 13 Oct 14:17 AWST`.

- A source that fails keeps its previous items. The error is recorded in `data/status.json`, so the apps can show "failed" against it.
- Bandcamp Daily and Bandcamp Radio sit behind a bot check that sometimes refuses scripts. When that happens the source is marked `linkOnly` and the apps show a card that opens the site. The gatherer tries again every run and recovers on its own.
- If the apps push a change while the gatherer is running, the gatherer starts again from the newest commit and pushes again.

### Substack is gathered from the laptop

Substack puts a browser check in front of its feeds for requests from cloud servers, including GitHub's, so the workflow skips every source whose address contains `substack.com`. Those are gathered by a small scheduled task on Angus's laptop instead, `tools/laptop-substack.ps1`, which keeps its own copy of the repository under `%LOCALAPPDATA%\BackAnnounce\repo`, runs about every three hours while the laptop is on, and commits as `feed: refresh Substack ... (laptop)`. Install or remove it with `tools/install-laptop-task.ps1`. Its log is `%LOCALAPPDATA%\BackAnnounce\laptop-substack.log`.

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

To try it on a computer, serve the `web/` folder with any static server and put a copy of `data/` inside it (that copy is ignored by git).

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

`kind` is one of `rss` (needs `url`), `nts` (needs `slug`), `rinse` (needs `slug`), `mixcloud` (needs `user`) or `manual` (Bandcamp, read from `home`). Optional: `rollup` folds matching titles into one item per day, and `image` is a fallback picture.

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
