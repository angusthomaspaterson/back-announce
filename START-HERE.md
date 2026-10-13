# Start here

This folder has everything Claude Code needs to rebuild Back Announce so one place holds everything, with a web app for your laptop and phone and an Android app. `CLAUDE.md` is the brief. Claude Code reads it automatically when you start it in this folder. `seed/` holds your 152 sources, the 16 you've paused and your saved cards, exported on 12 Oct 2026. `reference/` has the current app and gatherer for Claude Code to copy.

## How it fits together

- **A GitHub repository is the one place.** It holds your source list, your pauses and saves, and the gathered episodes.
- **A free GitHub Actions job refreshes the feed** every 6 hours. It replaces the Claude morning update.
- **The web app runs on GitHub Pages.** It's a proper installable app, so "Install" on your Pixel opens Back Announce itself, not Claude's home page.
- **The Android app reads and writes the same repository.**
- **Pausing or saving in one shows up in the other.**

## What you'll need

1. **A free GitHub account** (github.com). The repository has to be public for free hosting, so your source list and saves will be visible to anyone who finds it. A private repo needs GitHub Pro, about US$4 a month.
2. **Claude Code.** Follow Anthropic's install guide at docs.claude.com (search "Claude Code quickstart"). It runs in a terminal and signs in with your Claude account.
3. **Git**, which Claude Code will help you install if it's missing.
4. **Android Studio**, from developer.android.com/studio, but only from milestone 4. Open it once after installing so it downloads the Android SDK.

## First session

1. Unzip this folder somewhere sensible, for example `Documents\back-announce`.
2. In File Explorer, right-click the folder and choose "Open in Terminal".
3. Type `claude` and press Enter.
4. Say: **"Read CLAUDE.md and START-HERE.md, then walk me through milestone 1."**

Claude Code works in five milestones and stops after each one. You'll make one small thing yourself: a GitHub access token limited to this single repository. Claude Code will give you the exact clicks. Treat it like a password.

## Getting the Android app onto your Pixel (milestone 4)

**Copy the file over**
1. Claude Code tells you where the built `app-debug.apk` is.
2. Send it to your phone, for example by Google Drive.
3. Tap it on the phone and allow installs from that app when asked.

**USB debugging, for repeat builds**
1. On the Pixel, go to Settings, then About phone, and tap Build number seven times.
2. Go to Settings, then System, then Developer options, and turn on USB debugging.
3. Plug the phone in and accept the prompt.
4. Ask Claude Code to "install it on my phone".

## When you're happy with it

Ask Claude, in this project, to switch off the "Episode Feed gather" task. The old Back Announce page can stay as it is or be deleted.
