#!/usr/bin/env python3
"""Gather the latest episodes and articles for the Feed page.

Usage:  python3 gather.py sources.json out_dir
  sources.json  the `config/sources` document from the artifact's database
                (an object with an "items" array; see SOURCE KINDS below)
  out_dir       one JSON file per source is written here as <id>.json,
                each a document body for the `sources` collection, plus
                status.json (the body for `meta/status`).

SOURCE KINDS
  rss       {"id","name","kind":"rss","url","home"}         any RSS/Atom feed (SoundCloud, podcasts, Substack)
  nts       {"id","name","kind":"nts","slug","home"}        an NTS show, read from the public NTS API
  rinse     {"id","name","kind":"rinse","slug","home"}      a Rinse FM show, read from its show page
  mixcloud  {"id","name","kind":"mixcloud","user","home"}   a Mixcloud account, read from api.mixcloud.com/<user>/cloudcasts/
  manual    {"id","name","kind":"manual","home"}            items are written by Claude with WebFetch
                                                             (Bandcamp Daily and Bandcamp Radio block scripts)
Optional on any source:
  "rollup": {"match": "<regex on title>", "title": "Recommendations"}
            items whose title matches are folded into one item per day
            (First Floor posts each track recommendation as its own post).
  "image":  a fallback image URL for items that carry none (a show's artwork).
Each item may carry "image" (the picture's source URL). thumbs.py turns those
into artifact assets and writes the served URL into "img"; the page only
shows "img", because the viewer cannot load pictures from other sites.
Only the standard library is used. Each source keeps its newest 25 items.
"""
import sys, json, re, html, datetime, urllib.request, xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
KEEP = 25

def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def iso(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def strip(s, n=600):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(re.sub(r"\s+", " ", s)).strip()
    return s[: n - 1] + "…" if len(s) > n else s

def item(id_, title, url, date, desc="", extra=None):
    d = {"id": id_, "title": title.strip(), "url": url, "date": date, "desc": strip(desc)}
    if extra: d.update(extra)
    return d

# ---------- kinds ----------
def do_rss(src):
    root = ET.fromstring(fetch(src["url"]).lstrip())
    ns = {"atom": "http://www.w3.org/2005/Atom", "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
    out = []
    for e in root.iter("item"):  # RSS 2.0
        title = (e.findtext("title") or "").strip()
        link = (e.findtext("link") or "").strip()
        enc = e.find("enclosure")
        audio = enc.get("url") if enc is not None else None
        guid = (e.findtext("guid") or link or title).strip()
        pd = e.findtext("pubDate")
        try: date = iso(parsedate_to_datetime(pd)) if pd else None
        except Exception: date = None
        desc = e.findtext("description") or e.findtext("itunes:summary", namespaces=ns) or ""
        dur = e.findtext("itunes:duration", namespaces=ns)
        img = None
        ii = e.find("itunes:image", ns)
        if ii is not None: img = ii.get("href")
        if not img and enc is not None and (enc.get("type") or "").startswith("image/"): img = enc.get("url")
        if not img:
            mc = e.find("{http://search.yahoo.com/mrss/}content") or e.find("{http://search.yahoo.com/mrss/}thumbnail")
            if mc is not None: img = mc.get("url")
        if not img:
            body = e.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or desc or ""
            m = re.search(r'<img[^>]+src="([^"]+)"', body)
            if m: img = html.unescape(m.group(1))
        out.append(item(re.sub(r"[^A-Za-z0-9_.~:@+-]", "-", guid)[-120:], title, link or audio or "", date, desc, {"audio": audio, "duration": dur, "image": img}))
    if not out:  # Atom
        for e in root.findall("atom:entry", ns):
            title = e.findtext("atom:title", default="", namespaces=ns)
            link_el = e.find("atom:link", ns)
            link = link_el.get("href") if link_el is not None else ""
            pd = e.findtext("atom:updated", namespaces=ns) or e.findtext("atom:published", namespaces=ns)
            date = iso(datetime.datetime.fromisoformat(pd.replace("Z", "+00:00"))) if pd else None
            out.append(item(re.sub(r"[^A-Za-z0-9_.~:@+-]", "-", e.findtext("atom:id", default=link, namespaces=ns))[-120:], title, link, date, e.findtext("atom:summary", default="", namespaces=ns)))
    return out

def do_nts(src):
    data = json.loads(fetch(f"https://www.nts.live/api/v2/shows/{src['slug']}/episodes?limit={KEEP}&offset=0"))
    out = []
    for ep in data.get("results", []):
        alias = ep.get("episode_alias") or ""
        url = f"https://www.nts.live/shows/{src['slug']}/episodes/{alias}"
        date = ep.get("broadcast")
        try: date = iso(datetime.datetime.fromisoformat(date.replace("Z", "+00:00"))) if date else None
        except Exception: pass
        genres = ", ".join(g.get("value", "") for g in (ep.get("genres") or [])[:4])
        media = ep.get("media") or {}
        out.append(item(alias or url, ep.get("name") or src["name"], url, date, ep.get("description") or "", {"tags": genres, "location": ep.get("location_long") or "", "image": media.get("picture_medium") or media.get("picture_small")}))
    return out

def do_rinse(src):
    page = fetch(f"https://www.rinse.fm/shows/{src['slug']}").decode("utf-8", "ignore")
    og = re.search(r'property="og:image" content="([^"]+)"', page)
    show_img = html.unescape(og.group(1)) if og else None
    seen, out = set(), []
    for m in re.finditer(r'/episodes/([a-z0-9-]+)', page):
        slug = m.group(1)
        if slug in seen or not slug.startswith(src["slug"]): continue
        seen.add(slug)
        dm = re.search(r"(\d{2})-(\d{2})-(\d{4})-(\d{2})(\d{2})$", slug)
        date = None
        if dm:
            d, mo, y, hh, mm = map(int, dm.groups())
            date = iso(datetime.datetime(y, mo, d, hh, mm, tzinfo=datetime.timezone.utc))  # UK clock, close enough for ordering
            title = f"{src['name']}, {d} {datetime.date(y, mo, d).strftime('%b %Y')}"
        else:
            title = src["name"]
        out.append(item(slug, title, f"https://www.rinse.fm/episodes/{slug}", date, "", {"image": show_img}))
        if len(out) >= KEEP: break
    return out

def do_mixcloud(src):
    data = json.loads(fetch(f"https://api.mixcloud.com/{src['user']}/cloudcasts/?limit={KEEP}"))
    out = []
    for c in data.get("data", []):
        date = c.get("created_time")
        try: date = iso(datetime.datetime.fromisoformat(date.replace("Z", "+00:00"))) if date else None
        except Exception: pass
        pics = c.get("pictures") or {}
        secs = c.get("audio_length")
        tags = ", ".join(t.get("name", "") for t in (c.get("tags") or [])[:4])
        out.append(item(c.get("key") or c.get("url"), c.get("name") or src["name"], c.get("url"), date, "",
                        {"image": pics.get("large") or pics.get("medium"), "duration": str(secs) if secs else None, "tags": tags}))
    return out

def do_manual(src):
    return None  # left to Claude via WebFetch

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
        names = [i["title"] for i in grp]
        lines = [f"{i['title']}" + (f" ({i['desc']})" if i.get("desc") and len(i["desc"]) < 60 else "") for i in grp]
        newest = grp[-1]
        keep.append(item(f"rollup-{day}", f"{src['name']} {label.lower()}, {datetime.date.fromisoformat(day).strftime('%-d %b')}: {len(grp)} record{'s' if len(grp)!=1 else ''}",
                         newest["url"], newest["date"], "\n".join(lines),
                         {"image": next((i.get("image") for i in grp if i.get("image")), None), "links": [{"t": i["title"], "u": i["url"]} for i in grp]}))
    return keep

KINDS = {"rss": do_rss, "nts": do_nts, "rinse": do_rinse, "mixcloud": do_mixcloud, "manual": do_manual}

def main():
    cfg = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    import os; os.makedirs(out_dir, exist_ok=True)
    now = iso(datetime.datetime.now(datetime.timezone.utc))
    status = {"lastRun": now, "sources": {}}
    for src in cfg["items"]:
        try:
            items = KINDS[src["kind"]](src)
        except Exception as e:
            status["sources"][src["id"]] = {"ok": False, "error": str(e)[:200], "at": now}
            print(f"FAIL {src['id']}: {e}", file=sys.stderr); continue
        if items is None:
            status["sources"][src["id"]] = {"ok": None, "note": "manual: fetch with WebFetch", "at": now}
            print(f"MANUAL {src['id']}"); continue
        items = [i for i in items if i.get("url")]
        if src.get("image"):
            for i in items:
                if not i.get("image"): i["image"] = src["image"]
        if src.get("rollup"):
            items = rollup(items, src)
        items.sort(key=lambda i: i.get("date") or "", reverse=True)
        items = items[:KEEP]
        body = {"name": src["name"], "kind": src["kind"], "home": src.get("home", ""), "updatedAt": now, "items": items}
        json.dump(body, open(os.path.join(out_dir, f"{src['id']}.json"), "w"), ensure_ascii=False, indent=1)
        status["sources"][src["id"]] = {"ok": True, "count": len(items), "newest": items[0]["date"] if items else None, "at": now}
        print(f"OK   {src['id']}: {len(items)} items, newest {items[0]['date'] if items else '-'}")
    json.dump(status, open(os.path.join(out_dir, "status.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
