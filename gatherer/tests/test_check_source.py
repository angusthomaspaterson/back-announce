"""Tests for check_source.py: recognising links and proposing sources, on saved real pages.

Nothing here touches the network: a fake fetcher serves fixture files by address.
"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import check_source as cs  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


PAGES = {
    "https://www.nts.live/api/v2/shows/gigi-fm/episodes": "nts-gigi-fm.json",
    "https://www.nts.live/api/v2/shows/gigi-fm": "nts-show-gigi-fm.json",
    "https://www.rinse.fm/shows/papaoul": "rinse-papaoul.html",
    "https://api.mixcloud.com/JohnDigweed/cloudcasts/": "mixcloud-johndigweed.json",
    "https://api.mixcloud.com/johndigweed/cloudcasts/": "mixcloud-johndigweed.json",
    "https://api.mixcloud.com/JohnDigweed/": "mixcloud-user-johndigweed.json",
    "https://api.mixcloud.com/johndigweed/": "mixcloud-user-johndigweed.json",
    "https://soundcloud.com/andrew-wowk/time-to-track-on-2ser-01-10": "soundcloud-track-andrew-wowk.html",
    "https://soundcloud.com/andrew-wowk": "soundcloud-profile-andrew-wowk.html",
    "https://on.soundcloud.com/AbCd123": "soundcloud-track-andrew-wowk.html",   # a short link lands on the track page
    "https://feeds.soundcloud.com/users/soundcloud:users:1908954/sounds.rss": "soundcloud-time-to-track.rss",
    "https://itunes.apple.com/lookup?id=788236947": "apple-lookup-788236947.json",
    "https://feed.songexploder.net/SongExploder": "soundcloud-time-to-track.rss",   # any real RSS will do for the preview
    "https://www.gorillavsbear.net/feed/": "substack-first-floor.rss",
    "https://www.gorillavsbear.net/": "html-gorillavsbear.html",
    "https://firstfloor.substack.com/feed": "substack-first-floor.rss",
}


def fake(url, timeout=25):
    for prefix in sorted(PAGES, key=len, reverse=True):
        if url.startswith(prefix):
            return fixture(PAGES[prefix])
    raise OSError(f"HTTP Error 404: not in fixtures {url}")


def network_forbidden(url, timeout=25):
    raise AssertionError(f"tried to fetch {url}")


EXISTING = [{"id": "nts-yu-su", "kind": "nts", "slug": "yu-su", "name": "Yu Su"}]
NOW = "2026-10-14T04:00:00Z"


class Links(unittest.TestCase):
    def test_shared_text_and_tracking(self):
        self.assertEqual(cs.first_link("Listen to this on SoundCloud https://on.soundcloud.com/AbCd123 via app"), "https://on.soundcloud.com/AbCd123")
        self.assertEqual(cs.first_link("www.nts.live/shows/gigi-fm"), "https://www.nts.live/shows/gigi-fm")
        self.assertEqual(cs.clean_url("https://open.spotify.com/show/x?si=abc&utm_source=y"), "https://open.spotify.com/show/x")
        self.assertEqual(cs.clean_url("https://rtrfm.com.au/podcasts/no-skips/?podcast_feed"), "https://rtrfm.com.au/podcasts/no-skips/?podcast_feed")
        self.assertEqual(cs.clean_url("https://example.com/feed?size=10#top"), "https://example.com/feed?size=10")
        with self.assertRaises(cs.Refused):
            cs.first_link("just some words")


class Check(unittest.TestCase):
    def ok(self, url, sources=EXISTING):
        r = cs.check(url, sources, fake, NOW)
        self.assertTrue(r["ok"], r)
        self.assertNotIn("duplicate", r, r)
        return r

    def test_nts_show_and_episode_links(self):
        for url in ("https://www.nts.live/shows/gigi-fm", "https://www.nts.live/shows/gigi-fm/episodes/gigi-fm-1st-october-2026?x=1"):
            r = self.ok(url)
            self.assertEqual(r["source"], {"id": "nts-gigi-fm", "name": "GiGi FM", "kind": "nts", "slug": "gigi-fm", "home": "https://www.nts.live/shows/gigi-fm"})
            self.assertTrue(1 <= len(r["items"]) <= 5)
            self.assertTrue(r["items"][0]["url"].startswith("https://www.nts.live/shows/gigi-fm/episodes/"))

    def test_rinse_show_and_episode_links(self):
        for url in ("https://www.rinse.fm/shows/papaoul", "https://rinse.fm/episodes/papaoul-06-10-2026-1000"):
            r = self.ok(url)
            self.assertEqual(r["source"]["kind"], "rinse")
            self.assertEqual(r["source"]["slug"], "papaoul")
            self.assertEqual(r["source"]["name"], "Papaoul")
            self.assertEqual(r["source"]["id"], "rinse-papaoul")
            self.assertTrue(r["items"])

    def test_mixcloud_account_and_mix_links(self):
        for url in ("https://www.mixcloud.com/JohnDigweed/", "https://www.mixcloud.com/JohnDigweed/transitions-1154/"):
            r = self.ok(url)
            self.assertEqual(r["source"]["kind"], "mixcloud")
            self.assertEqual(r["source"]["name"], "John Digweed")
            self.assertEqual(r["source"]["home"], f"https://www.mixcloud.com/{r['source']['user']}/")
            self.assertTrue(r["items"])

    def test_soundcloud_profile_track_and_short_link_resolve_to_the_user_feed(self):
        for url in ("https://soundcloud.com/andrew-wowk", "https://soundcloud.com/andrew-wowk/time-to-track-on-2ser-01-10", "https://on.soundcloud.com/AbCd123"):
            r = self.ok(url)
            self.assertEqual(r["source"]["url"], "https://feeds.soundcloud.com/users/soundcloud:users:1908954/sounds.rss")
            self.assertEqual(r["source"]["home"], "https://soundcloud.com/andrew-wowk")
            self.assertEqual(r["source"]["kind"], "rss")
            self.assertTrue(r["items"])

    def test_soundcloud_already_followed_is_a_duplicate(self):
        mine = [{"id": "time-to-track", "kind": "rss", "name": "Time To Track", "url": "https://feeds.soundcloud.com/users/soundcloud:users:1908954/sounds.rss"}]
        r = cs.check("https://soundcloud.com/andrew-wowk", mine, fake, NOW)
        self.assertEqual(r["duplicate"], {"id": "time-to-track", "name": "Time To Track"})

    def test_apple_podcasts_uses_the_published_feed(self):
        r = self.ok("https://podcasts.apple.com/au/podcast/song-exploder/id788236947?i=1000700000000")
        self.assertEqual(r["source"]["url"], "https://feed.songexploder.net/SongExploder")
        self.assertEqual(r["source"]["name"], "Song Exploder")
        self.assertEqual(r["source"]["id"], "song-exploder")

    def test_a_web_page_that_names_its_feed(self):
        r = self.ok("https://www.gorillavsbear.net/")
        self.assertEqual(r["source"]["url"], "https://www.gorillavsbear.net/feed/")
        self.assertEqual(r["source"]["home"], "https://www.gorillavsbear.net/")
        self.assertEqual(r["source"]["name"], "First Floor")   # title of the fixture feed served for it

    def test_a_feed_itself(self):
        r = self.ok("https://firstfloor.substack.com/feed")
        self.assertEqual(r["source"]["url"], "https://firstfloor.substack.com/feed")
        self.assertEqual(r["source"]["home"], "https://firstfloor.substack.com/")

    def test_substack_is_proposed_without_fetching(self):
        for url in ("https://toneglow.substack.com/p/some-post", "https://open.substack.com/pub/toneglow/p/x", "https://substack.com/@toneglow"):
            r = cs.check(url, [], network_forbidden, NOW)
            self.assertTrue(r["ok"], r)
            self.assertEqual(r["source"]["url"], "https://toneglow.substack.com/feed")
            self.assertEqual(r["items"], [])
            self.assertIn("laptop", r["note"])

    def test_ids_never_clash(self):
        mine = [{"id": "nts-gigi-fm", "kind": "nts", "slug": "something-else"}, {"id": "nts-gigi-fm-2", "kind": "rss", "url": "x"}]
        self.assertEqual(self.ok("https://www.nts.live/shows/gigi-fm", mine)["source"]["id"], "nts-gigi-fm-3")

    def test_refusals_explain_themselves(self):
        cases = {
            "https://open.spotify.com/show/abc?si=1": "Spotify",
            "https://www.youtube.com/watch?v=x": "YouTube",
            "https://someone.bandcamp.com/album/x": "Bandcamp",
            "https://www.nts.live/explore": "isn't a show",
            "https://www.mixcloud.com/discover/house/": "isn't an account",
            "https://soundcloud.com/discover": "isn't a profile",
            "https://www.nts.live/shows/no-such-show": "doesn't have a show",
            "https://example.org/broken": "Couldn't open that link",
        }
        for url, words in cases.items():
            r = cs.check(url, [], fake, NOW)
            self.assertFalse(r["ok"], url)
            self.assertIn(words, r["error"], url)

    def test_existing_slug_is_a_duplicate(self):
        mine = [{"id": "nts-gigi-fm", "kind": "nts", "slug": "gigi-fm", "name": "GiGi FM"}]
        r = cs.check("https://www.nts.live/shows/gigi-fm/episodes/anything", mine, fake, NOW)
        self.assertEqual(r["duplicate"], {"id": "nts-gigi-fm", "name": "GiGi FM"})


class Main(unittest.TestCase):
    def test_answers_new_requests_and_removes_old_ones(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "requests"))
            with open(os.path.join(d, "sources.json"), "w") as f:
                json.dump({"items": EXISTING}, f)
            with open(os.path.join(d, "requests", "old.json"), "w") as f:
                json.dump({"url": "https://www.nts.live/shows/gigi-fm", "at": "2026-01-01T00:00:00Z"}, f)
            with open(os.path.join(d, "requests", "old.result.json"), "w") as f:
                json.dump({"ok": False}, f)
            with open(os.path.join(d, "requests", "new.json"), "w") as f:
                json.dump({"url": "https://open.spotify.com/show/x", "at": "2999-01-01T00:00:00Z"}, f)
            cs.main(["--data", d])
            left = sorted(os.listdir(os.path.join(d, "requests")))
            self.assertEqual(left, ["new.json", "new.result.json"])
            with open(os.path.join(d, "requests", "new.result.json")) as f:
                self.assertIn("Spotify", json.load(f)["error"])


if __name__ == "__main__":
    unittest.main()
