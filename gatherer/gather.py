#!/usr/bin/env python3
"""Back Announce gatherer.

Reads data/sources.json, fetches the newest items from every source and writes
one file per source to data/feed/<id>.json plus data/status.json.

Usage:  python3 gatherer/gather.py [--data data] [--only id,id,...] [--workers 6]

SOURCE KINDS
  rss       {"id","name","kind":"rss","url","home"}         any RSS/Atom feed (SoundCloud, podcasts, Substack)
  nts       {"id","name","kind":"nts","slug","home"}        an NTS show, read from the public NTS API
  rinse     {"id","name","kind":"rinse","slug","home"}      a Rinse FM show, read from its show page
  mixcloud  {"id","name","kind":"mixcloud","user","home"}   a Mixcloud account, read from api.mixcloud.com/<user>/cloudcasts/
  manual    {"id","name","kind":"manual","home"}            Bandcamp Daily and Bandcamp Radio, read from their home pages.
                                                             If Bandcamp refuses the request the source is marked link-only.
Optional on any source:
  "rollup": {"match": "<regex on title>", "title": "Recommendations"}
            items whose title matches are folded into one item per day
            (First Floor posts each track recommendation as its own post).
  "image":  a fallback image URL for items that carry none (a show's artwork).

A source that fails keeps its previous feed file and the error is written to
status.json. Only the standard library is used. Each source keeps its newest 25.
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
KEEP = 25
TIMEOUT = 25
WORKERS = 6
UTC = datetime.timezone.utc

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


# ---------- helpers ----------

def fetch(url, timeout=TIMEOUT):
    """GET a URL as bytes, presenting as desktop Chrome."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def iso(dt):
    """Format a datetime as an ISO 8601 UTC string with a Z."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(s):
    """Turn an ISO 8601 or RFC 2822 date string into ISO UTC, or None."""
    if not s:
        return None
    s = s.strip()
    try:
        return iso(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")))
    except ValueError:
        pass
    try:
        return iso(parsedate_to_datetime(s))
    except (TypeError, ValueError):
        return None


def strip(s, n=600):
    """Remove tags, collapse whitespace, unescape entities and cap the length."""
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(re.sub(r"\s+", " ", s)).strip()
    return s[: n - 1] + "…" if len(s) > n else s


def clean_id(s):
    return re.sub(r"[^A-Za-z0-9_.~:@+-]", "-", s or "")[-120:]


def item(id_, title, url, date, desc="", extra=None):
    d = {"id": clean_id(id_), "title": (title or "").strip(), "url": url, "date": date, "desc": strip(desc)}
    if extra:
        d.update(extra)
    return d


def day_month(d):
    """'4 Oct' without the platform-specific %-d."""
    return f"{d.day} {d.strftime('%b')}"


def _last_sunday(year, month):
    d = datetime.date(year, month, 31 if month in (3, 10) else 28)
    while d.weekday() != 6:
        d -= datetime.timedelta(days=1)
    return d


def uk_to_utc(naive):
    """Convert a naive UK wall-clock time to an aware UTC datetime.

    British Summer Time runs from 01:00 UTC on the last Sunday of March to
    01:00 UTC on the last Sunday of October.
    """
    start = datetime.datetime.combine(_last_sunday(naive.year, 3), datetime.time(1), tzinfo=UTC)
    end = datetime.datetime.combine(_last_sunday(naive.year, 10), datetime.time(1), tzinfo=UTC)
    as_utc = naive.replace(tzinfo=UTC)
    if start <= as_utc - datetime.timedelta(hours=1) < end:
        return as_utc - datetime.timedelta(hours=1)
    return as_utc


def _text(el, path):
    return (el.findtext(path, default="", namespaces=NS) or "").strip()


# ---------- parsers (no network; each takes the fetched body) ----------

def parse_rss(data, src):
    """RSS 2.0 or Atom. Returns a list of items."""
    if isinstance(data, bytes):
        data = data.lstrip()
    root = ET.fromstring(data)
    out = []
    channel = root.find("channel")
    channel_img = None
    if channel is not None:
        ci = channel.find("itunes:image", NS)
        if ci is not None:
            channel_img = ci.get("href")
        if not channel_img:
            channel_img = _text(channel, "image/url") or None
    for e in root.iter("item"):  # RSS 2.0
        title = _text(e, "title")
        link = _text(e, "link")
        enc = e.find("enclosure")
        audio = enc.get("url") if enc is not None else None
        if audio and not (enc.get("type") or "audio").startswith("audio"):
            audio = None
        guid = _text(e, "guid") or link or title
        date = parse_date(_text(e, "pubDate"))
        desc = _text(e, "description") or _text(e, "itunes:summary")
        dur = _text(e, "itunes:duration") or None
        img = None
        ii = e.find("itunes:image", NS)
        if ii is not None:
            img = ii.get("href")
        if not img and enc is not None and (enc.get("type") or "").startswith("image/"):
            img = enc.get("url")
        if not img:
            mc = e.find("media:content", NS)
            if mc is None:
                mc = e.find("media:thumbnail", NS)
            if mc is not None:
                img = mc.get("url")
        if not img:
            body = _text(e, "content:encoded") or desc
            m = re.search(r'<img[^>]+src="([^"]+)"', body)
            if m:
                img = html.unescape(m.group(1))
        out.append(item(guid, title, link or audio or "", date, desc,
                        {"audio": audio, "duration": dur, "image": img or channel_img}))
    if not out:  # Atom
        for e in root.findall("atom:entry", NS):
            title = _text(e, "atom:title")
            link = ""
            for le in e.findall("atom:link", NS):
                if le.get("rel") in (None, "alternate"):
                    link = le.get("href") or ""
                    break
            date = parse_date(_text(e, "atom:published") or _text(e, "atom:updated"))
            desc = _text(e, "atom:summary") or _text(e, "atom:content")
            out.append(item(_text(e, "atom:id") or link, title, link, date, desc))
    return out


def parse_nts(data, src):
    data = json.loads(data)
    out = []
    for ep in data.get("results", []):
        alias = ep.get("episode_alias") or ""
        url = f"https://www.nts.live/shows/{src['slug']}/episodes/{alias}"
        genres = ", ".join(g.get("value", "") for g in (ep.get("genres") or [])[:4])
        media = ep.get("media") or {}
        out.append(item(alias or url, ep.get("name") or src["name"], url, parse_date(ep.get("broadcast")),
                        ep.get("description") or "",
                        {"tags": genres, "location": ep.get("location_long") or "",
                         "image": media.get("picture_medium") or media.get("picture_small")}))
    return out


def parse_rinse(page, src):
    if isinstance(page, bytes):
        page = page.decode("utf-8", "ignore")
    og = re.search(r'property="og:image" content="([^"]+)"', page)
    show_img = html.unescape(og.group(1)) if og else None
    seen, out = set(), []
    for m in re.finditer(r"/episodes/([a-z0-9-]+)", page):
        slug = m.group(1)
        if slug in seen or not slug.startswith(src["slug"]):
            continue
        seen.add(slug)
        dm = re.search(r"(\d{2})-(\d{2})-(\d{4})-(\d{2})(\d{2})$", slug)
        date = None
        if dm:
            d, mo, y, hh, mm = map(int, dm.groups())
            date = iso(uk_to_utc(datetime.datetime(y, mo, d, hh, mm)))
            title = f"{src['name']}, {day_month(datetime.date(y, mo, d))} {y}"
        else:
            title = src["name"]
        out.append(item(slug, title, f"https://www.rinse.fm/episodes/{slug}", date, "", {"image": show_img}))
        if len(out) >= KEEP:
            break
    return out


def parse_mixcloud(data, src):
    data = json.loads(data)
    out = []
    for c in data.get("data", []):
        pics = c.get("pictures") or {}
        secs = c.get("audio_length")
        tags = ", ".join(t.get("name", "") for t in (c.get("tags") or [])[:4])
        out.append(item(c.get("key") or c.get("url"), c.get("name") or src["name"], c.get("url"),
                        parse_date(c.get("created_time")), "",
                        {"image": pics.get("large") or pics.get("medium"),
                         "duration": str(secs) if secs else None, "tags": tags}))
    return out


def parse_bandcamp_daily(page, src):
    """daily.bandcamp.com: every 'list-article' block on the home page."""
    if isinstance(page, bytes):
        page = page.decode("utf-8", "ignore")
    out, seen = [], set()
    for chunk in page.split('class="list-article')[1:]:
        m = re.search(r'<a class="title" href="(/[a-z0-9-]+/[a-z0-9-]+)">(.*?)</a>', chunk, re.S)
        if not m:
            continue
        path, title = m.group(1), html.unescape(m.group(2))
        if path in seen:
            continue
        seen.add(path)
        fr = re.search(r'<a class="franchise" href="[^"]*">(.*?)</a>', chunk, re.S)
        franchise = html.unescape(fr.group(1)).strip().title() if fr else ""
        dm = re.search(r"([A-Z][a-z]+ \d{1,2}, \d{4})", chunk)
        date = None
        if dm:
            try:
                date = iso(datetime.datetime.strptime(dm.group(1), "%B %d, %Y"))
            except ValueError:
                pass
        im = re.search(r'<img src="([^"]+)"', chunk)
        bl = re.search(r'<p class="blurb">(.*?)</p>', chunk, re.S)
        out.append(item(path.strip("/").replace("/", "-"), title, "https://daily.bandcamp.com" + path, date,
                        bl.group(1) if bl else "", {"tags": franchise, "image": im.group(1) if im else None}))
    return out


def parse_bandcamp_radio(page, src):
    """bandcamp.com/radio: the shows list in the page's data-blob JSON."""
    if isinstance(page, bytes):
        page = page.decode("utf-8", "ignore")
    m = re.search(r'data-blob="([^"]+)"', page)
    if not m:
        raise ValueError("no data-blob on the Bandcamp Radio page")
    blob = json.loads(html.unescape(m.group(1)))
    out = []
    for s in (blob.get("appData") or {}).get("shows") or []:
        if s.get("isDraft"):
            continue
        path = s.get("itemUrl") or ""
        if not path:
            continue
        franchise = s.get("franchiseName") or ""
        title = s.get("title") or franchise
        if franchise and franchise.lower() not in title.lower():
            title = f"{franchise}: {title}"
        desc = " ".join(x for x in (s.get("description") or "", strip(s.get("attribution") or "")) if x)
        img = s.get("imageId")
        out.append(item(path.strip("/").replace("/", "-"), title, "https://bandcamp.com" + path,
                        parse_date(s.get("date")), desc,
                        {"tags": franchise, "image": f"https://f4.bcbits.com/img/{int(img):010d}_170.jpg" if img else None}))
    return out


def parse_anjunadeep(page, src):
    """anjunadeep.com/music: the label's releases, including upcoming ones.

    The page embeds its data as Next.js JSON (Apollo cache): product_groups with title, type,
    release_date, slug and artwork, pointing at artists and labels by reference.
    """
    if isinstance(page, bytes):
        page = page.decode("utf-8", "ignore")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not m:
        raise ValueError("no release data on the Anjunadeep music page")
    cache = json.loads(m.group(1))["props"]["pageProps"]["__APOLLO_STATE__"]
    ref = lambda r: cache.get((r or {}).get("__ref", ""), {})  # noqa: E731
    out = []
    for key, g in cache.items():
        if not key.startswith("product_groups:") or g.get("reference_type") != "release" or not g.get("slug"):
            continue
        artist = (ref(g.get("artist")).get("name") or "").strip()
        label = (ref(g.get("label")).get("name") or "Anjunadeep").strip()
        kind = (g.get("type") or "release").replace("_", " ")
        kind = kind.upper() if kind in ("ep", "lp") else kind.capitalize()
        title = g.get("title") or ""
        if artist and artist.lower() != "various artists":
            title = f"{artist} – {title}"
        out_date = parse_date((g.get("release_date") or "")[:10] + "T00:00:00Z") if g.get("release_date") else None
        when = datetime.datetime.fromisoformat(out_date.replace("Z", "+00:00")) if out_date else None
        images = {i.get("size"): i.get("url") for i in (g.get("images") or [])}
        out.append(item(g["slug"], title, f"https://anjunadeep.com/products/{g['slug']}", out_date,
                        f"{kind} on {label}" + (f", out {day_month(when)} {when.year}." if when else "."),
                        {"tags": f"{kind} · {label}", "out": out_date, "image": images.get("m") or g.get("image_url")}))
    return out


def settle_upcoming(items, prev_items, now_iso):
    """For a release schedule: date a not-yet-released item by when it was first seen.

    It enters the feed on the day it is announced (its release date is in the description),
    and comes back to the top on release day, when its date becomes the release date.
    """
    first_seen = {i["id"]: i.get("date") for i in (prev_items or []) if i.get("date") and i["date"] <= now_iso}
    for i in items:
        out = i.get("out") or i.get("date")
        i["date"] = first_seen.get(i["id"], now_iso) if out and out > now_iso else out
    return items


# ---------- kinds (fetch + parse) ----------

def do_rss(src, fetcher):
    return parse_rss(fetcher(src["url"]), src)


def do_nts(src, fetcher):
    return parse_nts(fetcher(f"https://www.nts.live/api/v2/shows/{src['slug']}/episodes?limit={KEEP}&offset=0"), src)


def do_rinse(src, fetcher):
    return parse_rinse(fetcher(f"https://www.rinse.fm/shows/{src['slug']}"), src)


def do_mixcloud(src, fetcher):
    return parse_mixcloud(fetcher(f"https://api.mixcloud.com/{src['user']}/cloudcasts/?limit={KEEP}"), src)


def _bandcamp_page(home, fetcher):
    page = fetcher(home)
    if isinstance(page, bytes):
        page = page.decode("utf-8", "ignore")
    if "<title>Client Challenge</title>" in page:
        raise RuntimeError("Bandcamp's bot check blocked the request (link-only until it lets us through)")
    return page


def do_manual(src, fetcher):
    home = src.get("home", "")
    if "daily.bandcamp.com" in home:
        return parse_bandcamp_daily(_bandcamp_page(home, fetcher), src)
    if "bandcamp.com/radio" in home:
        return parse_bandcamp_radio(_bandcamp_page(home, fetcher), src)
    if "anjunadeep.com/music" in home:
        return parse_anjunadeep(fetcher(home), src)
    raise ValueError(f"no parser for manual source {home}")


KINDS = {"rss": do_rss, "nts": do_nts, "rinse": do_rinse, "mixcloud": do_mixcloud, "manual": do_manual}


# ---------- post-processing ----------

def rollup(items, src):
    """Fold items whose title matches the rollup regex into one item per day."""
    rx = re.compile(src["rollup"]["match"])
    label = src["rollup"].get("title", "Recommendations")
    keep, groups = [], {}
    for i in items:
        if rx.search(i["title"] or "") and i.get("date"):
            groups.setdefault(i["date"][:10], []).append(i)
        else:
            keep.append(i)
    for day, grp in groups.items():
        grp.sort(key=lambda i: i.get("date") or "")
        lines = [i["title"] + (f" ({i['desc']})" if i.get("desc") and len(i["desc"]) < 60 else "") for i in grp]
        newest = grp[-1]
        n = len(grp)
        keep.append(item(f"rollup-{day}",
                         f"{src['name']} {label.lower()}, {day_month(datetime.date.fromisoformat(day))}: {n} record{'s' if n != 1 else ''}",
                         newest["url"], newest["date"], "\n".join(lines),
                         {"image": next((i.get("image") for i in grp if i.get("image")), None),
                          "links": [{"t": i["title"], "u": i["url"]} for i in grp]}))
    return keep


def finish(items, src, now=None):
    """Apply the fallback image and rollup, drop duplicates, sort newest first, keep 25.

    Items dated more than a day ahead are dropped: Rinse lists upcoming episodes
    on its show pages, and they cannot be played yet.
    """
    horizon = iso((now or datetime.datetime.now(UTC)) + datetime.timedelta(days=1))
    items = [i for i in items if i.get("url") and not (i.get("date") and i["date"] > horizon)]
    if src.get("image"):
        for i in items:
            if not i.get("image"):
                i["image"] = src["image"]
    if src.get("rollup"):
        items = rollup(items, src)
    seen, unique = set(), []
    for i in items:
        if i["id"] in seen:
            continue
        seen.add(i["id"])
        unique.append(i)
    unique.sort(key=lambda i: i.get("date") or "", reverse=True)
    return unique[:KEEP]


def gather_one(src, fetcher=fetch, prev_items=None, now=None):
    items = KINDS[src["kind"]](src, fetcher)
    if src.get("upcoming"):
        items = settle_upcoming(items, prev_items, now or iso(datetime.datetime.now(UTC)))
    return finish(items, src)


# ---------- the run ----------

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def dump_json(path, body):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(body, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def run(sources, feed_dir, status_path, fetcher=fetch, workers=WORKERS, now=None, log=print):
    """Gather every source. Returns the status document.

    A feed file is rewritten only when its items changed, so a quiet run leaves
    the feed untouched and only status.json moves.
    """
    os.makedirs(feed_dir, exist_ok=True)
    now = now or iso(datetime.datetime.now(UTC))
    # Start from the previous status so a partial run (--only) keeps the other entries.
    status = load_json(status_path, {}) or {}
    status = {"lastRun": now, "sources": dict(status.get("sources") or {})}

    def work(src):
        try:
            prev = load_json(os.path.join(feed_dir, f"{src['id']}.json"), None) if src.get("upcoming") else None
            return src, gather_one(src, fetcher, (prev or {}).get("items"), now), None
        except Exception as e:  # noqa: BLE001 - any failure keeps the old file
            return src, None, f"{type(e).__name__}: {e}"[:200]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(work, sources))

    for src, items, error in results:
        path = os.path.join(feed_dir, f"{src['id']}.json")
        prev = load_json(path, None)
        if error:
            entry = {"ok": False, "error": error, "at": now,
                     "count": len(prev["items"]) if prev else 0,
                     "newest": prev["items"][0].get("date") if prev and prev.get("items") else None}
            if src["kind"] == "manual":
                entry["linkOnly"] = True
                body = prev or {"id": src["id"], "name": src["name"], "kind": src["kind"],
                                "home": src.get("home", ""), "updatedAt": now, "items": []}
                if not body.get("linkOnly"):
                    body["linkOnly"] = True
                    dump_json(path, body)
            status["sources"][src["id"]] = entry
            log(f"FAIL {src['id']}: {error}")
            continue
        body = {"id": src["id"], "name": src["name"], "kind": src["kind"], "home": src.get("home", ""),
                "updatedAt": prev.get("updatedAt", now) if prev else now, "items": items}
        if not prev or prev.get("items") != items or prev.get("linkOnly") or prev.get("name") != src["name"]:
            body["updatedAt"] = now
            dump_json(path, body)
        status["sources"][src["id"]] = {"ok": True, "count": len(items), "at": now,
                                        "newest": items[0]["date"] if items else None}
        log(f"OK   {src['id']}: {len(items)} items, newest {items[0]['date'] if items else '-'}")

    dump_json(status_path, status)
    return status


def select_sources(sources, only="", match="", skip=""):
    """Narrow the source list: by id (--only), or by a substring of the url/home (--match, --skip)."""
    def where(s):
        return f"{s.get('url', '')} {s.get('home', '')}".lower()
    if only:
        wanted = set(x.strip() for x in only.split(",") if x.strip())
        sources = [s for s in sources if s["id"] in wanted]
    if match:
        sources = [s for s in sources if match.lower() in where(s)]
    if skip:
        sources = [s for s in sources if skip.lower() not in where(s)]
    return sources


def write_bundle(data_dir):
    """Write data/bundle.json: the source list, status and every feed file in one document.

    The web app loads this instead of 150 separate files. Rebuilt from whatever
    is on disk, so a partial run still produces a complete bundle.
    """
    feed_dir = os.path.join(data_dir, "feed")
    feed = {}
    for name in sorted(os.listdir(feed_dir)) if os.path.isdir(feed_dir) else []:
        if name.endswith(".json"):
            body = load_json(os.path.join(feed_dir, name), None)
            if body:
                feed[name[:-5]] = body
    cfg = load_json(os.path.join(data_dir, "sources.json"), {"items": []})
    bundle = {"sources": cfg.get("items", []),
              "status": load_json(os.path.join(data_dir, "status.json"), {}),
              "feed": feed}
    dump_json(os.path.join(data_dir, "bundle.json"), bundle)
    return bundle


def main(argv=None):
    ap = argparse.ArgumentParser(description="Gather the Back Announce feed.")
    ap.add_argument("--data", default="data", help="the data folder (default: data)")
    ap.add_argument("--only", default="", help="comma-separated source ids to gather (for testing)")
    ap.add_argument("--match", default="", help="only sources whose url or home contains this, e.g. substack.com")
    ap.add_argument("--skip", default="", help="leave out sources whose url or home contains this")
    ap.add_argument("--workers", type=int, default=WORKERS)
    args = ap.parse_args(argv)
    cfg = load_json(os.path.join(args.data, "sources.json"), {"items": []})
    sources = select_sources(cfg["items"], args.only, args.match, args.skip)
    status = run(sources, os.path.join(args.data, "feed"), os.path.join(args.data, "status.json"), workers=args.workers)
    write_bundle(args.data)
    ran = {s["id"] for s in sources}
    failed = [k for k, v in status["sources"].items() if k in ran and not v.get("ok")]
    print(f"done: {len(ran) - len(failed)} ok, {len(failed)} failed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
