# Back Announce: one data store, a web app and an Android app

You are rebuilding **Back Announce** for Angus, a former music journalist in Perth. It is a feed he uses daily, on his phone and laptop. Today it runs as a Claude artifact, whose data lives in Claude's private storage, which nothing outside Claude can read. The goal is one place that holds everything, with two front ends reading and writing it:

1. **The store and gatherer:** a GitHub repository holding the source list, his settings and the gathered feed as JSON. A scheduled GitHub Actions workflow refreshes the feed.
2. **The web app:** a static site on GitHub Pages, installable on the laptop and phone as a proper web app with its own icon.
3. **The Android app:** native, reading and writing the same data, with background audio and offline reading.

Pausing a source or saving a card in either front end must show up in the other.

## What the product is for

Angus wants human curation: radio shows, mixes, podcasts and writing where a presenter or writer gives context ("back-announcing" what was just played). He does not want algorithmic recommendations. Back Announce collects the latest episodes and articles from about 150 sources he chose into one timeline. Its On Air tab shows what is live now on the stations he listens to.

Copy is in Australian English. Times display in Perth time (`Australia/Perth`, AWST, UTC+8, no daylight saving) unless a screen says otherwise.

## Material in this folder (read-only)

- `seed/sources.json`: the source list, about 150 items of `{id, name, kind, group, home, added, url | slug | user, rollup?, image?}`.
- `seed/prefs.json`: `{paused: [source ids]}`.
- `seed/likes.json`: saved cards, keyed by id.
- `reference/gather.py`: the working Python gatherer. It is the specification for how each source kind is read. Reuse it as the basis of the Actions job.
- `reference/web-feed-tab.html` and `reference/web-onair-tab.html`: the current app. They are the reference for behaviour, layout, wording, group colours and CSS tokens, and for the On Air schedule (the `STATIONS` and `SHOWS` objects).
- `reference/on-air-stations.m3u`: verified live stream addresses.

## Repository layout

```
back-announce/
  data/
    sources.json        the source list (edited by the apps when adding, editing or regrouping sources)
    state.json          {paused: [...], saved: {key: card}, lastSeen: iso}  (written by the apps)
    feed/<id>.json      per-source gathered items (written only by the workflow)
    status.json         {lastRun, sources: {id: {ok, count, newest, error?}}}  (workflow only)
  gatherer/             Python, standard library only, ported from reference/gather.py
  web/                  the static site published to GitHub Pages
  android/              the Android Studio project
  .github/workflows/    gather.yml (scheduled) and pages.yml (deploy)
```

On first setup, import `seed/` into `data/`. Move `likes.json` into `state.json` under `saved`.

## 1. Gatherer (GitHub Actions)

- Port `reference/gather.py`. Keep the source kinds rss, nts, rinse, mixcloud and manual, plus the rollup rule, the desktop Chrome User-Agent and 25 second timeouts.
- Fetch in parallel with at most 6 at a time. A failing source keeps its previous `feed/<id>.json` and records the error in `status.json`. Keep the newest 25 items per source.
- No thumbnails step is needed. Store the original `image` URL. Both front ends load pictures directly.
- `manual` (Bandcamp Daily and Bandcamp Radio): try fetching and parsing from the runner. Bandcamp blocked Claude's cloud servers and may block GitHub's too. If it does, mark the source as link-only and the front ends show a card that opens the site.
- Schedule: once a day at about 5:17 am Perth time (Angus changed this from every 6 hours on 14 Oct 2026), plus manual `workflow_dispatch`. Commit only when files changed, with the message `feed: refresh <time>`.
- GitHub disables scheduled workflows in a public repository after 60 days without repository activity. Make sure the refresh commits keep the repo active. If they don't count, add a safe keep-alive, and tell Angus how to re-enable the workflow if it is ever switched off.
- Handle a push race with the apps' writes: rebase and retry.

## 2. Writes from the front ends

- Both front ends write `data/state.json`, and `data/sources.json` when adding or editing sources, through the GitHub REST contents API (`PUT /repos/{owner}/{repo}/contents/{path}` with the current `sha`).
- On a 409 or sha mismatch, re-read the file, re-apply the change, and retry.
- Debounce writes for about 2 seconds so a burst of toggles becomes one commit.
- Authentication: a fine-grained personal access token restricted to this one repository, with Contents read and write and nothing else. Angus creates it once, and you give him exact steps.
  - It is entered in each front end's Settings.
  - Web: keep it in `localStorage` on his own devices only.
  - Android: keep it in EncryptedSharedPreferences.
  - Never commit it and never log it.
- Reads:
  - Without a token, read `data/` from the Pages site, which is cached for a few minutes.
  - With a token, read `state.json` through the API so his own changes show at once.
- Without a token, the site is read-only. Hide the Save, Pause and Add controls.

## 3. Web app (GitHub Pages)

- Plain HTML, CSS and JavaScript ES modules, no build step unless one is clearly needed. Port the look and behaviour from `reference/web-feed-tab.html` and `reference/web-onair-tab.html`.
- PWA: `manifest.webmanifest` with `start_url` pointing at the app itself, an original icon (not Claude's), and a service worker that caches the shell and the last feed for offline reading. On the Pixel, Chrome's Install must open Back Announce directly, not a home page.
- Tabs: Feed and On Air, deep-linkable as `#feed` and `#onair`.

## 4. Android app

- Kotlin, Jetpack Compose, Material 3, minSdk 26, latest stable compile and target SDK. Room for the offline cache, WorkManager to sync from the repo every 6 hours and on pull-to-refresh, OkHttp, kotlinx.serialization, Coil, Media3 (ExoPlayer and MediaSessionService).
- No Google Play Services, Firebase, analytics or ads. Debug-signed APK, sideloaded onto a Google Pixel.
- The app reads the gathered feed from the repo. It does not fetch the sources itself. It writes state as in section 2.
- Player: audio enclosures and the live streams from `STATIONS` and the m3u, with a mini player and lock-screen controls. For live streams, show the station and, where the schedule knows it, the current show. That keeps the back-announce context.
- Optional new-episode notifications, off by default, chosen per source.

## Behaviour both front ends must match

**Feed**
- Cards newest first, with day headers ("Sun, 4 Oct").
- A card shows: avatar (source initials on the group colour), source name and group, time and "13h ago", a "New" badge, title, a four-line description that expands on tap, the image, and rollup links when present.
- Actions: Open, Save (heart), Play (where there is audio) and Pause source.
- The filter row has the Saved chip first, then one chip per group with counts, then "Mark all seen" and Sources. Group chips toggle groups on and off.
- "New" means the item's date is after `lastSeen`.
- Paused sources are hidden but still gathered.

**Saved view**
- Saved cards, newest saved first, with headers by the date saved.
- Unsaving shows Undo.
- A saved card is a full copy, so it survives the item leaving its source's 25.

**Source page**
- Opened by tapping the avatar or source name.
- Header with group, kind, post count, latest date, "Visit site" and Pause or Resume.
- Below it, every stored item, including when the source is paused.
- Back returns to the same scroll position.

**Sources**
- Grouped list with an on/off switch per source and Pause group or Resume group per group.
- Filter between All, Following and Paused.
- "Keep only my original N" pauses every source whose `added` is not `start`.
- One "Pause the N added {date}" or "Bring back the N added {date}" button per batch (`sweep` = "1 Oct", `oct11` = "11 Oct"), and "Resume everything".
- Each row shows the latest date or "failed".
- Add source: paste a URL and detect an NTS show, a Rinse show, a Mixcloud user, a SoundCloud profile (resolve to `https://feeds.soundcloud.com/users/soundcloud:users:{id}/sounds.rss` from the profile HTML) or an RSS feed. Show the latest items as a preview, then pick a group.

**On Air**
- Port `STATIONS` and `SHOWS`. Times are each station's local clock, so convert them with proper time-zone rules (London, Sydney and Berlin all observe daylight saving).
- Sections: On now, Next 24 hours, and This week by day in Perth time, with a station filter and links to each station's live page.

## Milestones

Stop after each one so Angus can try it.

1. Repo, `data/` imported from `seed/`, and the gatherer running in Actions with unit tests on saved fixtures. Angus sees the first refresh commit.
2. Web app with the Feed and On Air tabs, read-only, published on Pages and installable on the Pixel.
3. Token setup and writes: Save, Pause, Mark all seen, the Sources screen, and the Source page.
4. Android app at feature parity with the web app, plus the player.
5. Add source in both front ends, notifications, and polish. Then help Angus retire the Claude version: he will ask Claude to switch off its daily "Episode Feed gather" task.

## Rules

- Write unit tests for every parser, using real feed fixtures saved under the gatherer's tests. Tests never touch the network.
- Never invent feed URLs, slugs or IDs. Report sources that fail instead of guessing replacements.
- Keep secrets out of the repo, history, logs and screenshots.
- The repo has to be public for free GitHub Pages, so his source list, paused list and saved cards will be visible to anyone who finds it. Tell him before creating it. A private repo with Pages needs GitHub Pro.
- Angus is not a developer. Explain each step in plain English and give exact clicks and taps when something needs him, such as creating the GitHub account and repo, making the token, installing Android Studio, or approving an install.
