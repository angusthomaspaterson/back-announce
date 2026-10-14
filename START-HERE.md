# Start here

Back Announce is your feed of radio shows, mixes, podcasts and writing, rebuilt so one place holds everything. `CLAUDE.md` is the brief Claude Code works from. This note says where things stand and where to find what.

## Where things are

- **The app:** https://angusthomaspaterson.github.io/back-announce/ , installed on the Pixel and the laptop. Its **Help** page (Settings, then "How to use Back Announce", or the link at the bottom of the feed) explains every button.
- **The one place that holds everything:** the GitHub repository https://github.com/angusthomaspaterson/back-announce . Your sources, pauses, saves and the gathered feed are all in its `data/` folder.
- **The refresh:** GitHub gathers the feed every six hours. The laptop gathers the Substack newsletters every three hours while it's on, because Substack turns GitHub away.
- **This folder** is your copy of that repository. `seed/` and `reference/` are the export from the old Claude version, kept for reference.

## Done

1. The repository, the data imported from the old version, and the six-hourly gather on GitHub.
2. The web app, with the Feed and On Air tabs, installable on the Pixel and laptop.
3. Saving, pausing and Mark all seen, with a GitHub token per device, the Sources screen and the source pages.
4. The fixes after the review: BBC streams play inside the app, the lock screen shows the episode or the show on now, recent pictures are kept for offline reading, and the Help page.

## Still to do

- **Add source** inside the app: paste a link and the app works out the feed. Until then, ask Claude in this folder.
- **The Android app**, as a first app project, which brings new-episode notifications and Android Auto. You'll need Android Studio from developer.android.com/studio; open it once after installing so it downloads the Android tools.
- **Retire the Claude version:** ask Claude to switch off its daily "Episode Feed gather" task once you're happy.

## Working with Claude Code here

In File Explorer, right-click this folder and choose "Open in Terminal", type `claude` and press Enter. Or open the folder in the Claude desktop app. Then say what you want, for example "add this source to the Writing group: <link>" or "start the Android app".
