"""Unit tests for the gatherer. Every parser runs on a real feed saved under fixtures/.

Nothing here touches the network: fetch() is replaced by a reader of fixture files.
Run with:  python -m unittest discover -s gatherer/tests -v
"""
import datetime
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import gather  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


class ParseRss(unittest.TestCase):
    def test_soundcloud_rss(self):
        src = {"id": "time-to-track", "name": "Time To Track", "kind": "rss", "url": "x"}
        items = gather.parse_rss(fixture("soundcloud-time-to-track.rss"), src)
        self.assertGreater(len(items), 5)
        first = items[0]
        self.assertTrue(first["title"])
        self.assertTrue(first["url"].startswith("https://soundcloud.com/"))
        self.assertTrue(first["audio"].startswith("http"))
        self.assertRegex(first["date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertTrue(first["image"].startswith("http"))
        self.assertTrue(first["duration"])
        self.assertRegex(first["id"], r"^[A-Za-z0-9_.~:@+-]+$")

    def test_substack_rss_picks_image_from_body(self):
        src = {"id": "first-floor", "name": "First Floor", "kind": "rss", "url": "x"}
        items = gather.parse_rss(fixture("substack-first-floor.rss"), src)
        self.assertGreater(len(items), 10)
        self.assertTrue(any(i.get("image") for i in items), "no image found in any item")
        self.assertTrue(all(i["url"].startswith("https://firstfloor.substack.com/p/") for i in items))
        self.assertTrue(all(i["date"] for i in items))

    def test_atom(self):
        src = {"id": "cpython", "name": "CPython releases", "kind": "rss", "url": "x"}
        items = gather.parse_rss(fixture("atom-cpython-releases.atom"), src)
        self.assertGreater(len(items), 3)
        self.assertTrue(items[0]["title"])
        self.assertTrue(items[0]["url"].startswith("https://github.com/python/cpython/releases/tag/"))
        self.assertRegex(items[0]["date"], r"^\d{4}-\d{2}-\d{2}T")

    def test_description_is_stripped_and_capped(self):
        self.assertEqual(gather.strip("<p>Hello &amp;   world</p>"), "Hello & world")
        self.assertEqual(len(gather.strip("x" * 1000)), 600)


class ParseNts(unittest.TestCase):
    def test_show_episodes(self):
        src = {"id": "nts-gigi-fm", "name": "GiGi FM", "kind": "nts", "slug": "gigi-fm"}
        items = gather.parse_nts(fixture("nts-gigi-fm.json"), src)
        self.assertGreater(len(items), 5)
        first = items[0]
        self.assertTrue(first["url"].startswith("https://www.nts.live/shows/gigi-fm/episodes/"))
        self.assertRegex(first["date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertTrue(first["image"].startswith("http"))
        self.assertIn("tags", first)
        self.assertIn("location", first)


class ParseRinse(unittest.TestCase):
    def test_show_page(self):
        src = {"id": "rinse-papaoul", "name": "Papaoul", "kind": "rinse", "slug": "papaoul"}
        items = gather.parse_rinse(fixture("rinse-papaoul.html"), src)
        self.assertGreater(len(items), 5)
        self.assertLessEqual(len(items), gather.KEEP)
        ids = [i["id"] for i in items]
        self.assertEqual(len(ids), len(set(ids)), "duplicate episodes")
        self.assertTrue(all(i["id"].startswith("papaoul") for i in items))
        ep = next(i for i in items if i["id"] == "papaoul-06-10-2026-1000")
        self.assertEqual(ep["title"], "Papaoul, 6 Oct 2026")
        self.assertEqual(ep["date"], "2026-10-06T09:00:00Z")  # 10:00 BST
        self.assertEqual(ep["url"], "https://www.rinse.fm/episodes/papaoul-06-10-2026-1000")
        self.assertTrue(ep["image"].startswith("https://image.rinse.fm/"))

    def test_uk_clock(self):
        dt = datetime.datetime
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 1, 15, 10, 0))), "2026-01-15T10:00:00Z")
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 7, 1, 10, 0))), "2026-07-01T09:00:00Z")
        # BST starts 29 Mar 2026 at 01:00 UTC and ends 25 Oct 2026 at 01:00 UTC
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 3, 29, 0, 30))), "2026-03-29T00:30:00Z")
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 3, 29, 3, 0))), "2026-03-29T02:00:00Z")
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 10, 25, 0, 30))), "2026-10-24T23:30:00Z")
        self.assertEqual(gather.iso(gather.uk_to_utc(dt(2026, 10, 25, 3, 0))), "2026-10-25T03:00:00Z")


class ParseMixcloud(unittest.TestCase):
    def test_cloudcasts(self):
        src = {"id": "transitions", "name": "Transitions", "kind": "mixcloud", "user": "JohnDigweed"}
        items = gather.parse_mixcloud(fixture("mixcloud-johndigweed.json"), src)
        self.assertGreater(len(items), 5)
        first = items[0]
        self.assertTrue(first["url"].lower().startswith("https://www.mixcloud.com/johndigweed/"))
        self.assertRegex(first["date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertTrue(first["image"].startswith("http"))
        self.assertTrue(first["duration"].isdigit())


class ParseBandcamp(unittest.TestCase):
    def test_daily(self):
        src = {"id": "bandcamp-daily", "name": "Bandcamp Daily", "kind": "manual", "home": "https://daily.bandcamp.com/"}
        items = gather.parse_bandcamp_daily(fixture("bandcamp-daily.html"), src)
        self.assertGreater(len(items), 5)
        a = next(i for i in items if i["id"] == "features-instant-self-titled-feature")
        self.assertEqual(a["title"], "The French Prog Classic That Barely Escaped Oblivion")
        self.assertEqual(a["url"], "https://daily.bandcamp.com/features/instant-self-titled-feature")
        self.assertEqual(a["date"], "2026-10-12T00:00:00Z")
        self.assertEqual(a["tags"], "Features")
        self.assertTrue(a["image"].startswith("https://f4.bcbits.com/img/"))
        ids = [i["id"] for i in items]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(any(i["desc"] for i in items), "featured article should carry its blurb")

    def test_radio(self):
        src = {"id": "bandcamp-radio", "name": "Bandcamp Radio", "kind": "manual", "home": "https://bandcamp.com/radio"}
        items = gather.parse_bandcamp_radio(fixture("bandcamp-radio.html"), src)
        self.assertGreater(len(items), 3)
        a = next(i for i in items if i["id"] == "radio-bandcamp-selects-1009")
        self.assertEqual(a["url"], "https://bandcamp.com/radio/bandcamp-selects/1009")
        self.assertEqual(a["title"], "Bandcamp Selects: Hermanos Gutiérrez")
        self.assertEqual(a["date"], "2026-10-12T00:00:00Z")
        self.assertEqual(a["tags"], "Bandcamp Selects")
        self.assertEqual(a["image"], "https://f4.bcbits.com/img/0047838244_170.jpg")
        self.assertIn("Hosted by Tina Edwards", a["desc"])

    def test_radio_without_blob_fails_loudly(self):
        with self.assertRaises(ValueError):
            gather.parse_bandcamp_radio("<html></html>", {})


class ParseAnjunadeep(unittest.TestCase):
    SRC = {"id": "anjunadeep-releases", "name": "Anjunadeep releases", "kind": "manual", "home": "https://anjunadeep.com/music", "upcoming": True}

    def test_releases(self):
        items = gather.parse_anjunadeep(fixture("anjunadeep-music.html"), self.SRC)
        self.assertGreater(len(items), 20)
        a = next(i for i in items if i["id"] == "630928-anjunadeep-essentials-04")
        self.assertEqual(a["title"], "Anjunadeep Essentials 04")          # Various Artists left off
        self.assertEqual(a["url"], "https://anjunadeep.com/products/630928-anjunadeep-essentials-04")
        self.assertEqual(a["out"], "2026-12-10T00:00:00Z")
        self.assertEqual(a["desc"], "EP on Anjunadeep, out 10 Dec 2026.")
        self.assertEqual(a["tags"], "EP · Anjunadeep")
        self.assertTrue(a["image"].startswith("https://d1rgjmn2wmqeif.cloudfront.net/"))
        self.assertTrue(any(" – " in i["title"] for i in items), "artist names are included")
        labels = {i["tags"].split(" · ")[1] for i in items}
        self.assertTrue(labels <= {"Anjunadeep", "Anjunadeep Explorations", "Anjunachill"}, labels)

    def test_upcoming_enters_when_announced_and_returns_on_release_day(self):
        items = gather.parse_anjunadeep(fixture("anjunadeep-music.html"), self.SRC)
        day1 = "2026-10-14T03:00:00Z"
        first = {i["id"]: i for i in gather.gather_one(self.SRC, lambda u, timeout=25: fixture("anjunadeep-music.html"), None, day1)}
        ess = first["630928-anjunadeep-essentials-04"]
        self.assertEqual(ess["date"], day1, "upcoming release dated when first seen")
        past = next(i for i in first.values() if i["out"] < day1)
        self.assertEqual(past["date"], past["out"], "released items keep their release date")
        # a week later it is still dated by when it was announced
        later = gather.settle_upcoming([dict(i) for i in items], list(first.values()), "2026-10-21T03:00:00Z")
        self.assertEqual(next(i for i in later if i["id"] == ess["id"])["date"], day1)
        # on release day it takes its release date and comes back to the top
        out = gather.settle_upcoming([dict(i) for i in items], list(first.values()), "2026-12-10T01:00:00Z")
        self.assertEqual(next(i for i in out if i["id"] == ess["id"])["date"], "2026-12-10T00:00:00Z")


class Rollup(unittest.TestCase):
    SRC = {"id": "first-floor", "name": "First Floor", "kind": "rss", "url": "x",
           "rollup": {"match": "^[^–]+ – [^–]+$", "title": "Recommendations"}}

    def test_folds_recommendations_by_day(self):
        items = gather.parse_rss(fixture("substack-first-floor.rss"), self.SRC)
        out = gather.finish(items, self.SRC)
        rolls = [i for i in out if i["id"].startswith("rollup-")]
        self.assertTrue(rolls)
        r = rolls[0]
        self.assertRegex(r["title"], r"^First Floor recommendations, \d{1,2} [A-Z][a-z]{2}: \d+ records?$")
        self.assertTrue(r["links"])
        self.assertTrue(all(set(l) == {"t", "u"} for l in r["links"]))
        self.assertTrue(all(l["t"] in r["desc"] for l in r["links"]), "every record is named in the description")
        # the newsletter itself is not rolled away when its title has no dash
        self.assertTrue(any(i["title"] == "Underground Acquiescence" for i in out))
        self.assertLessEqual(len(out), gather.KEEP)
        dates = [i["date"] for i in out]
        self.assertEqual(dates, sorted(dates, reverse=True))


class Finish(unittest.TestCase):
    def test_fallback_image_dedupe_and_sort(self):
        src = {"id": "s", "name": "S", "kind": "rss", "url": "x", "image": "https://img/fallback.jpg"}
        items = [gather.item("a", "A", "https://u/a", "2026-01-01T00:00:00Z"),
                 gather.item("b", "B", "https://u/b", "2026-02-01T00:00:00Z", "", {"image": "https://img/b.jpg"}),
                 gather.item("a", "A again", "https://u/a2", "2026-03-01T00:00:00Z"),
                 gather.item("c", "no url", "", "2026-04-01T00:00:00Z")]
        out = gather.finish(items, src)
        self.assertEqual([i["id"] for i in out], ["b", "a"])
        self.assertEqual(out[1]["image"], "https://img/fallback.jpg")
        self.assertEqual(out[0]["image"], "https://img/b.jpg")

    def test_drops_items_more_than_a_day_ahead(self):
        src = {"id": "s", "name": "S", "kind": "rss", "url": "x"}
        now = datetime.datetime(2026, 10, 13, 12, 0, tzinfo=datetime.timezone.utc)
        items = [gather.item("past", "P", "https://u/p", "2026-10-12T00:00:00Z"),
                 gather.item("soon", "S", "https://u/s", "2026-10-14T06:00:00Z"),
                 gather.item("far", "F", "https://u/f", "2026-11-06T05:00:00Z"),
                 gather.item("undated", "U", "https://u/u", None)]
        self.assertEqual([i["id"] for i in gather.finish(items, src, now=now)], ["soon", "past", "undated"])

    def test_keeps_25(self):
        src = {"id": "s", "name": "S", "kind": "rss", "url": "x"}
        items = [gather.item(str(n), str(n), f"https://u/{n}", f"2026-01-{n % 28 + 1:02d}T00:00:00Z") for n in range(40)]
        self.assertEqual(len(gather.finish(items, src)), 25)


class SelectSources(unittest.TestCase):
    SRC = [{"id": "a", "url": "https://x.substack.com/feed", "home": "https://x.substack.com/"},
           {"id": "b", "url": "https://api.substack.com/feed/podcast/1.rss", "home": "https://notags.substack.com/"},
           {"id": "c", "slug": "moxie", "home": "https://www.nts.live/shows/moxie"}]

    def test_match_skip_only(self):
        ids = lambda xs: [s["id"] for s in xs]  # noqa: E731
        self.assertEqual(ids(gather.select_sources(self.SRC, match="substack.com")), ["a", "b"])
        self.assertEqual(ids(gather.select_sources(self.SRC, skip="Substack.com")), ["c"])
        self.assertEqual(ids(gather.select_sources(self.SRC, only="c, a")), ["a", "c"])
        self.assertEqual(ids(gather.select_sources(self.SRC)), ["a", "b", "c"])


class Run(unittest.TestCase):
    """The whole run against fixture files, with a fake fetch."""

    SOURCES = [
        {"id": "time-to-track", "name": "Time To Track", "kind": "rss",
         "url": "https://feeds.soundcloud.com/users/soundcloud:users:1908954/sounds.rss", "home": "https://soundcloud.com/andrew-wowk"},
        {"id": "nts-gigi-fm", "name": "GiGi FM", "kind": "nts", "slug": "gigi-fm", "home": "https://www.nts.live/shows/gigi-fm"},
        {"id": "rinse-papaoul", "name": "Papaoul", "kind": "rinse", "slug": "papaoul", "home": "https://www.rinse.fm/shows/papaoul"},
        {"id": "transitions", "name": "Transitions", "kind": "mixcloud", "user": "JohnDigweed", "home": "https://www.mixcloud.com/JohnDigweed/"},
        {"id": "bandcamp-daily", "name": "Bandcamp Daily", "kind": "manual", "home": "https://daily.bandcamp.com/"},
        {"id": "bandcamp-radio", "name": "Bandcamp Radio", "kind": "manual", "home": "https://bandcamp.com/radio"},
        {"id": "broken", "name": "Broken feed", "kind": "rss", "url": "https://example.invalid/feed", "home": "https://example.invalid/"},
    ]
    FILES = {
        "feeds.soundcloud.com/users/soundcloud:users:1908954": "soundcloud-time-to-track.rss",
        "nts.live/api/v2/shows/gigi-fm/episodes": "nts-gigi-fm.json",
        "rinse.fm/shows/papaoul": "rinse-papaoul.html",
        "api.mixcloud.com/JohnDigweed/cloudcasts": "mixcloud-johndigweed.json",
        "daily.bandcamp.com/": "bandcamp-daily.html",
        "bandcamp.com/radio": "bandcamp-radio.html",
    }

    def fake_fetch(self, url, timeout=25):
        for key, name in self.FILES.items():
            if key in url:
                return fixture(name)
        raise OSError(f"refused: {url}")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.feed = os.path.join(self.tmp.name, "feed")
        self.status = os.path.join(self.tmp.name, "status.json")

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, name):
        with open(os.path.join(self.feed, name + ".json"), encoding="utf-8") as f:
            return json.load(f)

    def test_run_writes_feed_and_status(self):
        status = gather.run(self.SOURCES, self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        self.assertEqual(status["lastRun"], "2026-10-13T00:00:00Z")
        for sid in ("time-to-track", "nts-gigi-fm", "rinse-papaoul", "transitions", "bandcamp-daily", "bandcamp-radio"):
            self.assertTrue(status["sources"][sid]["ok"], sid)
            body = self.read(sid)
            self.assertEqual(body["id"], sid)
            self.assertEqual(body["updatedAt"], "2026-10-13T00:00:00Z")
            self.assertEqual(len(body["items"]), status["sources"][sid]["count"])
            self.assertLessEqual(len(body["items"]), gather.KEEP)
            self.assertEqual(body["items"][0]["date"], status["sources"][sid]["newest"])
        broken = status["sources"]["broken"]
        self.assertFalse(broken["ok"])
        self.assertIn("refused", broken["error"])
        self.assertFalse(os.path.exists(os.path.join(self.feed, "broken.json")))
        with open(self.status, encoding="utf-8") as f:
            self.assertEqual(json.load(f), status)

    def test_failure_keeps_previous_file(self):
        gather.run(self.SOURCES[:1], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        before = self.read("time-to-track")

        def dead(url, timeout=25):
            raise OSError("timed out")
        status = gather.run(self.SOURCES[:1], self.feed, self.status, fetcher=dead, now="2026-10-14T00:00:00Z", log=lambda *a: None)
        self.assertEqual(self.read("time-to-track"), before)
        s = status["sources"]["time-to-track"]
        self.assertFalse(s["ok"])
        self.assertEqual(s["count"], len(before["items"]))
        self.assertEqual(s["newest"], before["items"][0]["date"])

    def test_unchanged_items_do_not_rewrite(self):
        gather.run(self.SOURCES[:1], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        gather.run(self.SOURCES[:1], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-14T00:00:00Z", log=lambda *a: None)
        self.assertEqual(self.read("time-to-track")["updatedAt"], "2026-10-13T00:00:00Z")

    def test_partial_run_keeps_other_status_entries(self):
        gather.run(self.SOURCES[:2], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        status = gather.run(self.SOURCES[1:2], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-14T00:00:00Z", log=lambda *a: None)
        self.assertEqual(set(status["sources"]), {"time-to-track", "nts-gigi-fm"})
        self.assertEqual(status["sources"]["time-to-track"]["at"], "2026-10-13T00:00:00Z")
        self.assertEqual(status["sources"]["nts-gigi-fm"]["at"], "2026-10-14T00:00:00Z")

    def test_bundle_collects_everything(self):
        data = self.tmp.name
        with open(os.path.join(data, "sources.json"), "w", encoding="utf-8") as f:
            json.dump({"items": self.SOURCES[:2]}, f)
        gather.run(self.SOURCES[:2], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        bundle = gather.write_bundle(data)
        self.assertEqual([s["id"] for s in bundle["sources"]], ["time-to-track", "nts-gigi-fm"])
        self.assertEqual(set(bundle["feed"]), {"time-to-track", "nts-gigi-fm"})
        self.assertEqual(bundle["status"]["lastRun"], "2026-10-13T00:00:00Z")
        with open(os.path.join(data, "bundle.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), bundle)

    def test_blocked_bandcamp_becomes_link_only(self):
        def blocked(url, timeout=25):
            raise OSError("HTTP Error 403: Forbidden")
        status = gather.run(self.SOURCES[4:6], self.feed, self.status, fetcher=blocked, now="2026-10-13T00:00:00Z", log=lambda *a: None)
        s = status["sources"]["bandcamp-daily"]
        self.assertFalse(s["ok"])
        self.assertTrue(s["linkOnly"])
        body = self.read("bandcamp-daily")
        self.assertTrue(body["linkOnly"])
        self.assertEqual(body["items"], [])
        self.assertEqual(body["home"], "https://daily.bandcamp.com/")
        # and it recovers once Bandcamp answers again
        gather.run(self.SOURCES[4:6], self.feed, self.status, fetcher=self.fake_fetch, now="2026-10-14T00:00:00Z", log=lambda *a: None)
        body = self.read("bandcamp-daily")
        self.assertNotIn("linkOnly", body)
        self.assertTrue(body["items"])


if __name__ == "__main__":
    unittest.main()
