#!/usr/bin/env python3
"""Check a link Angus wants to follow, and propose a source for it.

The web app writes data/requests/<id>.json = {"url": ..., "at": ...}. The check-source
workflow runs this script, which answers in data/requests/<id>.result.json with one of:

  {"ok": true,  "source": {...}, "items": [newest 5], "note": "..."}   a new source, ready to add
  {"ok": true,  "duplicate": {"id": ..., "name": ...}}                  already followed
  {"ok": false, "error": "a plain-English reason"}

`source` is a data/sources.json item without its group, which the app asks for before it
adds the source itself. Requests and results older than two days are removed.

Recognised links: NTS shows and episodes, Rinse FM shows and episodes, Mixcloud accounts
and mixes, SoundCloud profiles and tracks (including on.soundcloud.com short links), Apple
Podcasts pages, Substack newsletters, any RSS or Atom feed, and any web page that names
its feed in a <link rel="alternate"> tag. Nothing is guessed: a feed address is either
read from the page or service that publishes it, or the link is refused with a reason.
Usage:  python3 gatherer/check_source.py [--data data]
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gather  # noqa: E402

PREVIEW = 5
KEEP_DAYS = 2
SOUNDCLOUD_RESERVED = {"discover", "stream", "search", "you", "upload", "charts", "pages", "tags", "stations",
                       "mobile", "settings", "people", "popular", "terms-of-use", "jobs", "messages", "notifications"}
MIXCLOUD_RESERVED = {"discover", "upload", "select", "live", "dashboard", "favorites", "settings", "search",
                     "categories", "tag", "pro", "about", "player", "widget", "creators"}


class Refused(Exception):
    """A link that cannot become a source, with the reason to show Angus."""


def first_link(text):
    """The first web address in shared text such as 'Listen to X on SoundCloud https://...'."""
    text = (text or "").strip()
    m = re.search(r"https?://\S+", text)
    if m:
        return m.group(0).rstrip(").,;!?'\"")
    if re.match(r"^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$", text, re.I):
        return "https://" + text
    raise Refused("That doesn't look like a link. Paste the full address, starting with https://.")


def clean_url(url):
    """Drop tracking parameters and fragments."""
    p = urllib.parse.urlsplit(url)
    drop = {"si", "fbclid", "gclid", "igshid", "ref", "ref_src", "mc_cid", "mc_eid"}
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
         if not k.lower().startswith("utm_") and k.lower() not in drop]
    query = "&".join(urllib.parse.quote(k, safe="") + ("=" + urllib.parse.quote(v, safe="") if v else "") for k, v in q)
    return urllib.parse.urlunsplit((p.scheme or "https", p.netloc, p.path, query, ""))


def slugify(s, limit=40):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:limit].rstrip("-") or "source"


def text_of(body):
    return body.decode("utf-8", "ignore") if isinstance(body, bytes) else body


def feed_info(body):
    """(title, link) of an RSS or Atom document, or None if it isn't one."""
    try:
        root = ET.fromstring(body.lstrip() if isinstance(body, bytes) else body.encode("utf-8"))
    except ET.ParseError:
        return None
    ch = root.find("channel")
    if ch is not None:
        return (ch.findtext("title") or "").strip(), (ch.findtext("link") or "").strip()
    if root.tag.endswith("feed"):
        ns = {"a": "http://www.w3.org/2005/Atom"}
        link = next((le.get("href") for le in root.findall("a:link", ns) if le.get("rel") in (None, "alternate")), "")
        return (root.findtext("a:title", default="", namespaces=ns) or "").strip(), link or ""
    return None


def alternate_feeds(page, base):
    """Feed addresses a web page names in <link rel="alternate" type="application/rss+xml"> tags."""
    out = []
    for tag in re.findall(r"<link\b[^>]*>", page, re.I):
        if re.search(r'type=["\']application/(rss|atom)\+xml["\']', tag, re.I) and re.search(r'rel=["\']alternate["\']', tag, re.I):
            m = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
            if m:
                href = urllib.parse.urljoin(base, html.unescape(m.group(1)))
                if not re.search(r"/comments/feed/?$", href):
                    out.append(href)
    return out


# ---------- recognising a link ----------

def detect(url, fetcher):
    """Return (source without id/group/added, display name, note). Raises Refused."""
    p = urllib.parse.urlsplit(url)
    host = p.netloc.lower().split(":")[0]
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    parts = [x for x in p.path.split("/") if x]

    if host == "nts.live":
        if len(parts) < 2 or parts[0] != "shows":
            raise Refused("That NTS link isn't a show. Open the show's page on NTS and share or copy that.")
        slug = parts[1]
        try:
            name = json.loads(fetcher(f"https://www.nts.live/api/v2/shows/{slug}")).get("name") or slug
        except Exception:
            raise Refused(f"NTS doesn't have a show called {slug}.")
        return {"kind": "nts", "slug": slug, "home": f"https://www.nts.live/shows/{slug}"}, name, ""

    if host == "rinse.fm":
        if len(parts) < 2 or parts[0] not in ("shows", "episodes"):
            raise Refused("That Rinse FM link isn't a show. Open the show's page on Rinse and share or copy that.")
        slug = re.sub(r"-\d{2}-\d{2}-\d{4}-\d{4}$", "", parts[1]) if parts[0] == "episodes" else parts[1]
        page = text_of(fetcher(f"https://www.rinse.fm/shows/{slug}"))
        m = re.search(r'property="og:title" content="([^"]+)"', page)
        if not m or f"/episodes/{slug}" not in page:
            raise Refused(f"Rinse FM doesn't have a show page for {slug}.")
        return {"kind": "rinse", "slug": slug, "home": f"https://www.rinse.fm/shows/{slug}"}, html.unescape(m.group(1)).strip(), ""

    if host == "mixcloud.com":
        if not parts or parts[0].lower() in MIXCLOUD_RESERVED:
            raise Refused("That Mixcloud link isn't an account. Open the account's page and share or copy that.")
        user = parts[0]
        try:
            d = json.loads(fetcher(f"https://api.mixcloud.com/{user}/"))
        except Exception:
            raise Refused(f"Mixcloud doesn't have an account called {user}.")
        user = d.get("username") or user
        return {"kind": "mixcloud", "user": user, "home": f"https://www.mixcloud.com/{user}/"}, d.get("name") or user, ""

    if host in ("soundcloud.com", "on.soundcloud.com"):
        if host == "soundcloud.com" and (not parts or parts[0].lower() in SOUNDCLOUD_RESERVED):
            raise Refused("That SoundCloud link isn't a profile or a track. Open the profile and share or copy that.")
        page = text_of(fetcher(url))
        user = None
        m = re.search(r"window\.__sc_hydration\s*=\s*(\[.*?\]);\s*</script>", page, re.S)
        if m:
            for h in json.loads(m.group(1)):
                if h.get("hydratable") == "user" and isinstance(h.get("data"), dict) and h["data"].get("id"):
                    user = h["data"]
                    break
        if not user:
            raise Refused("SoundCloud didn't say whose page that is. Try the profile's own link.")
        return ({"kind": "rss", "url": f"https://feeds.soundcloud.com/users/soundcloud:users:{user['id']}/sounds.rss",
                 "home": f"https://soundcloud.com/{user.get('permalink') or parts[0]}"},
                (user.get("username") or user.get("permalink") or "").strip(), "")

    if host == "podcasts.apple.com":
        m = re.search(r"/id(\d+)", p.path)
        if not m:
            raise Refused("That Apple Podcasts link doesn't include the podcast's number. Share the show itself, not a search.")
        res = (json.loads(fetcher(f"https://itunes.apple.com/lookup?id={m.group(1)}&entity=podcast")).get("results") or [{}])[0]
        if not res.get("feedUrl"):
            raise Refused("Apple doesn't list a public feed for that podcast.")
        return {"kind": "rss", "url": res["feedUrl"], "home": url}, res.get("collectionName") or "", "apple"

    if host.endswith("spotify.com"):
        raise Refused("Spotify doesn't publish feeds. Try the show's Apple Podcasts link or its own website instead.")
    if host in ("youtube.com", "youtu.be", "music.youtube.com"):
        raise Refused("YouTube isn't supported. Try the show's own website or podcast feed.")
    if host.endswith("bandcamp.com"):
        raise Refused("Bandcamp pages don't have feeds. Bandcamp Daily and Bandcamp Radio are already in your list.")

    if host.endswith(".substack.com") or (host == "substack.com" and parts and parts[0].startswith("@")) or host == "open.substack.com":
        # Substack turns GitHub away, so this can't be previewed here; the laptop gathers it.
        if host == "open.substack.com" and len(parts) >= 2 and parts[0] == "pub":
            host = f"{parts[1]}.substack.com"
        elif host == "substack.com":
            host = f"{parts[0][1:]}.substack.com"
        name = host.split(".")[0].replace("-", " ").title()
        return {"kind": "rss", "url": f"https://{host}/feed", "home": f"https://{host}/"}, name, "substack"

    # Anything else: a feed itself, or a page that names its feed.
    body = fetcher(url)
    info = feed_info(body)
    if info:
        return {"kind": "rss", "url": url, "home": info[1] or url}, info[0], ""
    for feed in alternate_feeds(text_of(body), url):
        try:
            fbody = fetcher(feed)
        except Exception:
            continue
        info = feed_info(fbody)
        if info:
            return {"kind": "rss", "url": feed, "home": url}, info[0], ""
    raise Refused("That page doesn't name a feed, so there's nothing to follow. If the site has a podcast or newsletter, try its feed or Apple Podcasts link.")


def duplicate_of(src, sources):
    norm = lambda u: re.sub(r"^https?://(www\.)?", "", (u or "").lower()).rstrip("/")  # noqa: E731
    for s in sources:
        if s.get("kind") == src["kind"] and (
                (src.get("slug") and s.get("slug") == src["slug"])
                or (src.get("user") and (s.get("user") or "").lower() == src["user"].lower())
                or (src.get("url") and norm(s.get("url")) == norm(src["url"]))):
            return s
    return None


def check(raw, sources, fetcher=gather.fetch, now=None):
    """Check one link. Returns the result document (never raises)."""
    try:
        url = clean_url(first_link(raw))
        src, name, note = detect(url, fetcher)
        dup = duplicate_of(src, sources)
        if dup:
            return {"ok": True, "url": url, "duplicate": {"id": dup["id"], "name": dup.get("name", dup["id"])}}
        name = re.sub(r"\s+", " ", name or "").strip() or slugify(src.get("slug") or src.get("user") or url).replace("-", " ").title()
        base = {"nts": "nts-", "rinse": "rinse-"}.get(src["kind"], "") + slugify(src.get("slug") or name)
        ids = {s["id"] for s in sources}
        sid, n = base, 2
        while sid in ids:
            sid, n = f"{base}-{n}", n + 1
        src = {"id": sid, "name": name, **src}
        items, notes = [], []
        if note == "substack":
            notes.append("Substack turns GitHub away, so there's no preview. The laptop gathers Substack newsletters once a day, in the morning or as soon as it's next on; if this address is wrong, the source will show as failed.")
        else:
            try:
                items = gather.gather_one(src, fetcher, None, now)[:PREVIEW]
            except Exception as e:  # noqa: BLE001
                return {"ok": False, "url": url, "error": f"Found {name}, but couldn't read its latest episodes ({type(e).__name__}). Try again later."}
            if not items:
                notes.append("Nothing has been published here yet, so the preview is empty. It will fill in when something is.")
        return {"ok": True, "url": url, "source": src, "items": items, "note": " ".join(notes)}
    except Refused as e:
        return {"ok": False, "url": raw, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "url": raw, "error": f"Couldn't open that link ({type(e).__name__}). Check it works in a browser, then try again."}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Answer the app's add-source requests.")
    ap.add_argument("--data", default="data")
    args = ap.parse_args(argv)
    req_dir = os.path.join(args.data, "requests")
    if not os.path.isdir(req_dir):
        return 0
    sources = gather.load_json(os.path.join(args.data, "sources.json"), {"items": []})["items"]
    now = datetime.datetime.now(gather.UTC)
    for name in sorted(os.listdir(req_dir)):
        if not name.endswith(".json") or name.endswith(".result.json"):
            continue
        path = os.path.join(req_dir, name)
        res_path = path[:-5] + ".result.json"
        req = gather.load_json(path, {}) or {}
        at = req.get("at") or ""
        try:
            old = now - datetime.datetime.fromisoformat(at.replace("Z", "+00:00")) > datetime.timedelta(days=KEEP_DAYS)
        except ValueError:
            old = True
        if old:
            for p in (path, res_path):
                if os.path.exists(p):
                    os.remove(p)
            print(f"removed old request {name}")
            continue
        if os.path.exists(res_path):
            continue
        result = check(req.get("url", ""), sources, gather.fetch, gather.iso(now))
        result["at"] = gather.iso(now)
        gather.dump_json(res_path, result)
        print(f"{name}: {'ok' if result['ok'] else 'refused'} {result.get('source', {}).get('id') or (result.get('duplicate') or {}).get('id') or result.get('error')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
