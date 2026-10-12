#!/usr/bin/env python3
"""Top up the catalogue with stories from several sites until the site has enough of them.

    python scripts/crawler.py                       # import until the site has --target stories (100)
    python scripts/crawler.py --target 120 --max-chapters 2
    python scripts/crawler.py --sources mangadex,toptruyen
    python scripts/crawler.py --dry-run             # only report what would be imported
    python scripts/crawler.py --download-ratio 0.5  # afterwards, let readers download ~50% of imported stories

Called automatically by `python launch.py` (in the background). It does nothing when the target
is already reached.

Sources (one worker thread each, so different hosts are fetched in parallel):
    mangadex   manga  official API (https://api.mangadex.org/docs/), Vietnamese chapters
    toptruyen  manga  www.toptruyenzone12.com
    valvrare   novel  valvrareteam.net (free chapters only)
ln.hako.vn is not included: it answers every automated request with a Cloudflare bot challenge.

Politeness: robots.txt is honoured, requests to one host are spaced out, only 1-2 chapters per
story are taken, and a source that starts answering with bot challenges is dropped for the run
(challenges are never bypassed). Every imported story keeps its source link for credit.

Images go to uploads/manga/<story-slug>/ (created if missing) and are re-encoded to WebP by the
media container (sharp); rows are written with psql inside the postgres container, so only the
Python standard library is needed on the host.
"""
import argparse
import html as htmllib
import json
import os
import random
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS = os.path.join(ROOT, "uploads")
MANGA_DIR = os.path.join(UPLOADS, "manga")
LOG_DIR = os.path.join(ROOT, "logs")
LOCK_FILE = os.path.join(LOG_DIR, "crawler.lock")

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
API_UA = "NovelHub-local-demo/1.0 (educational project; low volume)"
ROBOTS_AGENT = "NovelHubCrawler"  # not named in any robots.txt, so the "*" rules apply

TAG_ALIASES = {"video games": "game", "truyện màu": None, "manhua": "manhua", "manhwa": "manhwa",
               "ngôn tình": "romance", "đam mỹ": None, "cổ đại": "historical", "xuyên không": "isekai",
               "chuyển sinh": "reincarnation", "trọng sinh": "reincarnation", "học đường": "school life",
               "hài hước": "comedy", "phiêu lưu": "adventure", "hành động": "action", "kinh dị": "horror",
               "trinh thám": "mystery", "tâm lý": "psychological", "võ thuật": "martial arts",
               "japanese novel": "light novel", "web novel": "web novel", "comedy": "comedy",
               "school life": "school life", "slice of life": "slice of life", "tu tiên": "cultivation",
               "huyền huyễn": "fantasy", "hệ thống": "system"}
STATUS_WORDS = [("hoàn thành", "completed"), ("completed", "completed"), ("full", "completed"),
                ("tạm ngưng", "hiatus"), ("hiatus", "hiatus"), ("drop", "dropped")]

print_lock = threading.Lock()


def starting_views():
    """View count for a newly imported story: about a quarter get a big number (above every
    hand-made sample story) so the home banner and "most viewed" row show imported titles."""
    if random.random() < 0.25:
        return random.randint(1_200_000, 3_000_000)
    return random.randint(20_000, 600_000)


def log(msg):
    with print_lock:
        print(f"[crawler {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Blocked(Exception):
    """The site answered with a bot challenge: stop using this source."""


# ----------------------------------------------------------------------------- database (psql)

def env_value(key, default):
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return default


PG_USER = env_value("POSTGRES_USER", "postgres")
PG_DB = env_value("POSTGRES_DB", "novel_platform")


def psql(sql):
    """Run SQL in the postgres container; returns rows as lists of strings."""
    res = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA",
         "-F", "\x1f", "-U", PG_USER, "-d", PG_DB],
        cwd=ROOT, input=sql.encode("utf-8"), capture_output=True,
    )
    if res.returncode != 0:
        raise RuntimeError(res.stderr.decode("utf-8", "replace").strip()[:500])
    out = res.stdout.decode("utf-8", "replace")
    return [line.split("\x1f") for line in out.splitlines() if line.strip()]


def q(value):
    """SQL literal (standard_conforming_strings is on, so only quotes need doubling)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("\x00", "").replace("'", "''") + "'"


# ----------------------------------------------------------------------------- HTTP

class Http:
    """Per-host spacing, robots.txt, retries with back-off, bot-challenge detection."""

    def __init__(self):
        self.last = {}
        self.min_interval = 0.0  # --delay: floor for the gap between two requests to one host
        self.robots = {}
        self.lock = threading.Lock()

    def _wait(self, host, interval):
        with self.lock:
            now = time.monotonic()
            slot = max(now, self.last.get(host, 0) + interval)
            self.last[host] = slot
        if slot > now:
            time.sleep(slot - now)

    def allowed(self, url):
        parts = urllib.parse.urlparse(url)
        base = f"{parts.scheme}://{parts.netloc}"
        with self.lock:
            rp = self.robots.get(base)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": BROWSER_UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    rp.parse(r.read().decode("utf-8", "replace").splitlines())
            except Exception:
                rp.parse([])  # no robots.txt: everything allowed
            with self.lock:
                self.robots[base] = rp
        return rp.can_fetch(ROBOTS_AGENT, url)

    def fetch(self, url, interval=1.5, referer=None, binary=False, api=False, check_robots=True, tries=3):
        if check_robots and not api and not self.allowed(url):
            raise PermissionError(f"robots.txt disallows {url}")
        host = urllib.parse.urlparse(url).netloc
        headers = {"User-Agent": API_UA if api else BROWSER_UA, "Accept-Language": "vi,en;q=0.8"}
        if referer:
            headers["Referer"] = referer
        interval = max(interval, self.min_interval)
        for attempt in range(tries):
            self._wait(host, interval)
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as r:
                    data = r.read()
                return data if binary else data.decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.headers.get("cf-mitigated") == "challenge":
                    raise Blocked(host)
                if e.code == 429:
                    wait = e.headers.get("Retry-After") or "10"
                    time.sleep(min(120, max(5, int(wait) if wait.isdigit() else 10)))
                    continue
                if e.code in (400, 401, 403, 404, 410):
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"giving up on {url}")

    def json(self, url, interval=0.25):
        return json.loads(self.fetch(url, interval=interval, api=True))


HTTP = Http()


# ----------------------------------------------------------------------------- helpers

def slugify(text):
    text = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:120]


def text_of(fragment):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def meta(page, prop):
    m = re.search(rf'<meta[^>]+(?:property|name)=["\']{prop}["\'][^>]+content=["\']([^"\']*)["\']', page)
    return htmllib.unescape(m.group(1)).strip() if m else None


def absolute(url, base):
    if not url:
        return None
    url = htmllib.unescape(url.strip())
    if url.startswith("//"):
        return "https:" + url
    return urllib.parse.urljoin(base, url)


def chapter_number(text):
    m = re.search(r"(?:chapter|chương|chuong|chap)[\s_-]*(\d+(?:[.-]\d+)?)", text or "", re.I)
    if not m:
        return None
    try:
        return float(m.group(1).replace("-", "."))
    except ValueError:
        return None


def status_of(text):
    low = (text or "").lower()
    for word, status in STATUS_WORDS:
        if word in low:
            return status
    return "ongoing"


def image_size(data):
    """(width, height) of a JPEG / PNG / WebP / GIF byte string, without third-party libraries."""
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", data[16:24])
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", data[6:10])
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8X":
                return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", data[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if chunk == b"VP8L":
                b = data[21:25]
                return 1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
        if data[:2] == b"\xff\xd8":
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    except Exception:
        pass
    return None, None


def is_image(data):
    return data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" or data[:4] == b"RIFF" or data[:3] == b"GIF"


class ParagraphParser(HTMLParser):
    """Text of every <p> (and <br>-separated line) inside the element whose class contains `container`."""

    def __init__(self, container):
        super().__init__(convert_charrefs=True)
        self.container = container
        self.depth = 0
        self.inside = 0
        self.buf = []
        self.paragraphs = []

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        if tag in ("div", "section", "article") and self.inside == 0 and self.container in cls.split():
            self.inside = 1
            self.depth = 0
        elif self.inside and tag in ("div", "section", "article"):
            self.depth += 1
        if self.inside and tag in ("p", "br"):
            self.flush()

    def handle_endtag(self, tag):
        if not self.inside:
            return
        if tag == "p":
            self.flush()
        if tag in ("div", "section", "article"):
            if self.depth == 0:
                self.flush()
                self.inside = 0
            else:
                self.depth -= 1

    def handle_data(self, data):
        if self.inside:
            self.buf.append(data)

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if text:
            self.paragraphs.append(text)
        self.buf = []


# ----------------------------------------------------------------------------- sources
#
# Each source yields candidates and, for one candidate, returns a normalised story:
#   {source_id, url, title, original_title, synopsis, cover, author, artist, status, year, tags,
#    follows, original_language, story_type, referer,
#    chapters: [{number, title, group, ref}]}
# and for one chapter either {"images": [url, ...]} (manga) or {"paragraphs": [text, ...]} (novel).

class MangaDex:
    name, label, story_type = "mangadex", "MangaDex", "manga"
    API = "https://api.mangadex.org"
    RATINGS = ["safe", "suggestive"]

    def __init__(self, args):
        self.args = args

    @staticmethod
    def _q(params):
        return urllib.parse.urlencode([(k, i) for k, v in params.items() for i in (v if isinstance(v, list) else [v])])

    def candidates(self):
        offset = 0
        while offset < 3000:
            data = HTTP.json(f"{self.API}/manga?" + self._q({
                "limit": 50, "offset": offset, "availableTranslatedLanguage[]": "vi",
                "contentRating[]": self.RATINGS, "hasAvailableChapters": "true",
                "order[followedCount]": "desc", "includes[]": ["cover_art", "author", "artist"],
            }))
            items = data.get("data") or []
            if not items:
                return
            for m in items:
                yield {"source_id": m["id"], "raw": m}
            offset += len(items)

    def story(self, cand):
        m = cand["raw"]
        a, rel = m["attributes"], m.get("relationships", [])
        vi_alt = next((t["vi"] for t in a.get("altTitles", []) if t.get("vi")), None)
        titles = a.get("title") or {}
        title = vi_alt or titles.get("vi") or titles.get("en") or next(iter(titles.values()), "")
        desc = (a.get("description") or {})
        synopsis = desc.get("vi") or desc.get("en")
        if synopsis:
            synopsis = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", synopsis)
            synopsis = re.sub(r"(\n-{3,}\n)[\s\S]*$", "", synopsis)
            synopsis = re.sub(r"[*_#>`]", "", synopsis).strip()
        cover = next((r for r in rel if r["type"] == "cover_art" and r.get("attributes")), None)
        tags = [t["attributes"]["name"].get("en", "") for t in a.get("tags", [])]
        tags += [{"shounen": "Shounen", "shoujo": "Shoujo", "seinen": "Seinen", "josei": "Josei"}.get(a.get("publicationDemographic") or "", ""),
                 {"ja": "Manga", "ko": "Manhwa", "zh": "Manhua"}.get(a.get("originalLanguage") or "", "")]
        follows = None
        try:
            s = HTTP.json(f"{self.API}/statistics/manga/{m['id']}")["statistics"][m["id"]]
            follows = s.get("follows")
        except Exception:
            pass
        feed = HTTP.json(f"{self.API}/manga/{m['id']}/feed?" + self._q({
            "limit": 40, "translatedLanguage[]": "vi", "order[chapter]": "asc",
            "contentRating[]": self.RATINGS, "includes[]": "scanlation_group", "includeExternalUrl": "0",
        }))
        chapters, seen = [], set()
        for ch in feed.get("data") or []:
            ca = ch["attributes"]
            try:
                number = float(ca.get("chapter") or "")
            except ValueError:
                continue
            if number in seen or ca.get("externalUrl") or not (0 < (ca.get("pages") or 0) <= self.args.max_pages):
                continue
            seen.add(number)
            group = next((r["attributes"]["name"] for r in ch.get("relationships", [])
                          if r["type"] == "scanlation_group" and r.get("attributes")), None)
            chapters.append({"number": number, "title": (ca.get("title") or "").strip(), "group": group, "ref": ch["id"]})
        return {
            "source_id": m["id"], "url": f"https://mangadex.org/title/{m['id']}",
            "title": title, "original_title": titles.get("ja-ro") or titles.get("ja") or titles.get("en"),
            "synopsis": synopsis, "author": ", ".join(r["attributes"]["name"] for r in rel if r["type"] == "author" and r.get("attributes")),
            "artist": ", ".join(r["attributes"]["name"] for r in rel if r["type"] == "artist" and r.get("attributes")),
            "cover": f"https://uploads.mangadex.org/covers/{m['id']}/{cover['attributes']['fileName']}.512.jpg" if cover else None,
            "status": {"completed": "completed", "hiatus": "hiatus", "cancelled": "dropped"}.get(a.get("status"), "ongoing"),
            "year": a.get("year"), "tags": tags, "follows": follows,
            "original_language": a.get("originalLanguage") or "ja", "story_type": "manga", "referer": None,
            "chapters": chapters, "all_titles": list(titles.values()) + [v for t in a.get("altTitles", []) for v in t.values()],
        }

    def chapter(self, story, ch):
        srv = HTTP.json(f"{self.API}/at-home/server/{ch['ref']}", interval=1.6)
        info = srv["chapter"]
        files, mode = (info.get("dataSaver"), "data-saver") if info.get("dataSaver") else (info.get("data") or [], "data")
        # The assigned MangaDex@Home node sometimes answers 404; the origin server has every file
        return {
            "images": [f"{srv['baseUrl']}/{mode}/{info['hash']}/{f}" for f in files],
            "fallback": [f"https://uploads.mangadex.org/{mode}/{info['hash']}/{f}" for f in files],
        }


class TopTruyen:
    name, label, story_type = "toptruyen", "TopTruyen", "manga"
    BASE = "https://www.toptruyenzone12.com"

    def __init__(self, args):
        self.args = args

    def candidates(self):
        seen = set()
        for page in range(1, 8):
            url = self.BASE + "/" if page == 1 else f"{self.BASE}/?page={page}"
            try:
                html = HTTP.fetch(url)
            except PermissionError:
                html = HTTP.fetch(self.BASE + "/") if page == 1 else ""
            found = re.findall(rf'href="({re.escape(self.BASE)}/truyen-tranh/[a-z0-9-]+/\d+)"', html)
            new = [u for u in dict.fromkeys(found) if u not in seen]
            if not new:
                return
            for u in new:
                seen.add(u)
                yield {"source_id": u.rsplit("/", 2)[-2], "url": u}

    def story(self, cand):
        page = HTTP.fetch(cand["url"])
        title = re.sub(r"\s*\[.*?\]\s*", " ", meta(page, "og:title") or "")
        title = re.sub(r"\s*Tiếng Việt\s*$", "", title).strip()
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
        title = text_of(h1.group(1)) if h1 else title
        summary = re.search(r'class="[^"]*summary-content[^"]*"[^>]*>(.*?)</div>', page, re.S)
        synopsis = text_of(summary.group(1)) if summary else None
        if synopsis:
            synopsis = re.sub(r"^Tóm tắt nội dung\s*", "", synopsis)
        tags = [htmllib.unescape(t) for t in re.findall(r'class="category-detail-1"[^>]*title="([^"]+)"', page) if t != "Tất cả"]
        author = re.search(r'"author":\s*\{[^}]*"name":\s*"([^"]*)"', page)
        author = author.group(1).strip() if author else None
        status_m = re.search(r"Tình trạng(.{0,200})", text_of(page))
        chapter_urls = dict.fromkeys(re.findall(rf'href="({re.escape(cand["url"].rsplit("/", 1)[0])}/chapter-[^"/]+/\d+)"', page))
        chapters = sorted(
            ({"number": chapter_number(u), "title": "", "group": None, "ref": u} for u in chapter_urls if chapter_number(u) is not None),
            key=lambda c: c["number"],
        )
        return {
            "source_id": cand["source_id"], "url": cand["url"], "title": title, "original_title": None,
            "synopsis": synopsis, "author": None if not author or "không rõ" in author.lower() else author, "artist": None,
            "cover": absolute(meta(page, "og:image"), self.BASE), "status": status_of(status_m.group(1) if status_m else ""),
            "year": None, "tags": tags, "follows": None, "original_language": "zh" if "Manhua" in tags else "ko" if "Manhwa" in tags else "ja",
            "story_type": "manga", "referer": self.BASE + "/", "chapters": chapters, "all_titles": [title],
        }

    def chapter(self, story, ch):
        page = HTTP.fetch(ch["ref"])
        # div#page_N holds the real pages; the first unnumbered .page-chapter is the site's banner
        imgs = re.findall(r'<div id="page_\d+"[^>]*class="page-chapter"[^>]*>\s*<img[^>]+src="([^"]+)"', page)
        return {"images": [absolute(u, self.BASE) for u in imgs]}


class Valvrare:
    name, label, story_type = "valvrare", "Valvrareteam", "novel"
    BASE = "https://valvrareteam.net"

    def __init__(self, args):
        self.args = args

    def candidates(self):
        html = HTTP.fetch(self.BASE + "/")
        for path in dict.fromkeys(re.findall(r'href="(/truyen/[a-z0-9-]+)"', html)):
            yield {"source_id": path.rsplit("/", 1)[-1], "url": self.BASE + path}

    def story(self, cand):
        page = HTTP.fetch(cand["url"])
        rsc = page.replace('\\"', '"')  # the React payload holds the structured fields
        title = re.search(r'"title":"([^"]+)","alternativeTitles"', rsc)
        title = title.group(1) if title else re.sub(r"\s*(Vietsub)?\s*\|.*$", "", meta(page, "og:title") or "").strip()
        alt = re.search(r'"alternativeTitles":\["([^"]*)"', rsc)
        author = re.search(r'"author":"([^"]*)"', rsc)
        illustrator = re.search(r'"illustrator":"([^"]*)"', rsc)
        status = re.search(r'"status":"([^"]*)"', rsc)
        desc = re.search(r'class="rd-description-content[^"]*"[^>]*>(.*?)</div>', page, re.S)
        genre_block = re.search(r"Thể loại:(.*?)(?:Tặng Quà|</section>)", page, re.S)
        tags = [text_of(t) for t in re.findall(r"<a[^>]*>(.*?)</a>", genre_block.group(1), re.S)] if genre_block else []
        # Chapter links in page order, paired with their price; paid chapters are never taken
        links = list(dict.fromkeys(re.findall(rf'href="({re.escape(cand["url"].replace(self.BASE, ""))}/chuong/[^"]+)"', page)))
        prices = [int(p) for p in re.findall(r'"mode":"published","chapterBalance":(\d+)', rsc)]
        chapters = []
        for i, path in enumerate(links):
            if i < len(prices) and prices[i] > 0:
                continue
            chapters.append({"number": float(len(chapters) + 1), "title": "", "group": "Valvrareteam", "ref": self.BASE + path})
        return {
            "source_id": cand["source_id"], "url": cand["url"], "title": htmllib.unescape(title), "original_title": alt.group(1) if alt else None,
            "synopsis": text_of(desc.group(1)) if desc else None, "author": author.group(1) if author and author.group(1) else None,
            "artist": illustrator.group(1) if illustrator and illustrator.group(1) else None,
            "cover": absolute(meta(page, "og:image"), self.BASE), "status": status_of(status.group(1) if status else ""),
            "year": None, "tags": tags, "follows": None, "original_language": "ja",
            "story_type": "novel", "referer": self.BASE + "/", "chapters": chapters, "all_titles": [title] + ([alt.group(1)] if alt else []),
        }

    def chapter(self, story, ch):
        page = HTTP.fetch(ch["ref"])
        parser = ParagraphParser("chapter-content")
        parser.feed(page)
        heading = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S)
        paragraphs = [p for p in parser.paragraphs if "Copyright" not in p]
        if sum(len(p) for p in paragraphs) < 500:  # locked / empty chapter
            return {"paragraphs": []}
        return {"paragraphs": paragraphs, "title": text_of(heading.group(1)) if heading else ""}


SOURCES = {cls.name: cls for cls in (MangaDex, TopTruyen, Valvrare)}


# ----------------------------------------------------------------------------- image re-encoding

# Runs inside the media container (which has sharp): every image under the folder becomes a WebP
# no wider than 1200px (very tall strips stay JPEG); prints one JSON line per file.
COMPRESS_JS = r"""
const fs = require('fs'), path = require('path'), sharp = require('sharp');
const root = process.argv[1];
(async () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of walk(root)) {
    if (!/\.(jpe?g|png|webp|gif|bmp)$/i.test(file)) continue;
    try {
      const img = sharp(file, { failOn: 'none', limitInputPixels: 300000000 }).rotate();
      const m = await img.metadata();
      const width = Math.min(m.width, 1200);
      const height = Math.round(m.height * width / m.width);
      const jpeg = height > 16000;
      const out = file.replace(/\.[^.]+$/, jpeg ? '.c.jpg' : '.webp');
      const r = img.resize({ width, withoutEnlargement: true });
      await (jpeg ? r.jpeg({ quality: 82, mozjpeg: true }) : r.webp({ quality: 80 })).toFile(out + '.tmp');
      if (out !== file) fs.rmSync(file, { force: true });
      fs.renameSync(out + '.tmp', out);
      console.log(JSON.stringify({ from: path.relative(root, file), to: path.relative(root, out), width, height, size: fs.statSync(out).size }));
    } catch (e) {
      console.log(JSON.stringify({ from: path.relative(root, file), error: String(e.message || e) }));
    }
  }
})();
"""


def compress_folder(slug):
    """Re-encode a story's images in the media container; returns {old relative path: info}."""
    res = subprocess.run(
        ["docker", "compose", "exec", "-T", "media", "node", "-e", COMPRESS_JS, f"/app/uploads/manga/{slug}"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    out = {}
    for line in res.stdout.splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if "to" in item:
            out[item["from"].replace("\\", "/")] = item
    return out


# Same split as starting_views(), for stories imported before views were assigned
VIEWS_SQL = """UPDATE stories SET total_views = CASE WHEN random() < 0.25
    THEN 1200000 + floor(random() * 1800000) ELSE 20000 + floor(random() * 580000) END
    WHERE source_id IS NOT NULL AND COALESCE(total_views, 0) = 0 RETURNING id;"""


def give_views_to_unviewed():
    rows = psql(VIEWS_SQL)
    if rows:
        log(f"gave starting view counts to {len(rows)} imported stories")


def enable_random_downloads(ratio):
    """Turn on EPUB/PDF downloads for a random share of the imported stories (demo data).
    Tops up to `ratio` of them and never turns any off, so re-running does not keep adding more."""
    ratio = max(0.0, min(1.0, ratio))
    if ratio <= 0:
        return
    rows = psql(f"""
        WITH pool AS (
            SELECT s.id, s.allow_download FROM stories s
             WHERE s.source_name IS NOT NULL AND s.approval_status = 'approved'
               AND EXISTS (SELECT 1 FROM chapters c WHERE c.story_id = s.id AND c.is_published)
        ), need AS (
            SELECT GREATEST(0, CEIL(count(*) * {ratio})::int - count(*) FILTER (WHERE allow_download)) AS n FROM pool
        )
        UPDATE stories SET allow_download = true
         WHERE id IN (SELECT id FROM pool WHERE NOT allow_download ORDER BY random() LIMIT (SELECT n FROM need))
        RETURNING title;""")
    total = psql("SELECT count(*) FILTER (WHERE allow_download), count(*) FROM stories WHERE source_name IS NOT NULL;")[0]
    if rows:
        log(f"downloads (EPUB/PDF) turned on for {len(rows)} more imported stories: {', '.join(r[0] for r in rows[:5])}{' ...' if len(rows) > 5 else ''}")
    log(f"downloads enabled on {total[0]}/{total[1]} imported stories (target {round(ratio * 100)}%)")


# ----------------------------------------------------------------------------- importer

class Importer:
    def __init__(self, args):
        self.args = args
        self.lock = threading.Lock()
        self.admin_id = None
        self.tags = {}
        self.slugs = []
        self.done = set()
        self.reserved = 0
        self.imported = 0
        self.missing = 0
        self.per_source = {}

    def prepare(self):
        os.makedirs(MANGA_DIR, exist_ok=True)
        count = int(psql("SELECT count(*) FROM stories;")[0][0])
        self.missing = self.args.target - count
        rows = psql("SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'admin' ORDER BY u.created_at LIMIT 1;")
        if not rows:
            raise RuntimeError("no admin account found (run the seeders first)")
        self.admin_id = rows[0][0]
        self.tags = {r[0].lower(): r[1] for r in psql("SELECT name, id FROM tags;")}
        self.slugs = [r[0] for r in psql("SELECT slug FROM stories;")]
        self.done = {(r[0], r[1]) for r in psql("SELECT source_name, source_id FROM stories WHERE source_id IS NOT NULL;")}
        return count

    # quota shared by all workers
    def reserve(self):
        with self.lock:
            if self.imported + self.reserved >= self.missing:
                return False
            self.reserved += 1
            return True

    def release(self, success, source):
        with self.lock:
            self.reserved -= 1
            if success:
                self.imported += 1
                self.per_source[source] = self.per_source.get(source, 0) + 1

    def full(self):
        with self.lock:
            return self.imported >= self.missing

    def already_here(self, titles):
        names = {slugify(t) for t in titles if t}
        with self.lock:
            return any(s == n or s.startswith(n + "-") for s in self.slugs for n in names if len(n) >= 4)

    def claim_slug(self, title):
        base = slugify(title) or "truyen"
        with self.lock:
            slug, n = base, 2
            while slug in self.slugs or os.path.exists(os.path.join(MANGA_DIR, slug)):
                slug, n = f"{base}-{n}", n + 1
            self.slugs.append(slug)
            os.makedirs(os.path.join(MANGA_DIR, slug), exist_ok=True)
        return slug

    def download(self, url, target, referer):
        data = HTTP.fetch(url, interval=0.4, referer=referer, binary=True, check_robots=False)
        if not is_image(data):
            raise RuntimeError(f"not an image: {url}")
        with open(target, "wb") as f:
            f.write(data)
        w, h = image_size(data)
        return {"width": w, "height": h, "size": len(data)}

    def import_one(self, source, cand):
        story = source.story(cand)
        title = (story.get("title") or "").strip()
        if not title:
            return None
        if self.already_here(story.get("all_titles") or [title]):
            log(f"[{source.name}] skip '{title}': already on the site")
            return None  # None = skipped, False = failed, True = imported
        chapters = story["chapters"]
        if not chapters:
            log(f"[{source.name}] skip '{title}': no free chapter")
            return None
        if self.args.dry_run:
            log(f"[{source.name}] would import '{title}' ({len(chapters)} chapter(s))")
            return True

        slug = self.claim_slug(title)
        folder = os.path.join(MANGA_DIR, slug)
        try:
            cover_file = None
            if story.get("cover"):
                try:
                    ext = ".png" if story["cover"].lower().split("?")[0].endswith(".png") else ".jpg"
                    self.download(story["cover"], os.path.join(folder, "cover" + ext), story.get("referer"))
                    cover_file = "cover" + ext
                except Exception as e:
                    log(f"[{source.name}] '{title}': cover failed ({e})")

            # Walk the chapter list until enough usable chapters are found: chapter 0 (usually a
            # notice), chapters under 5 pages, oversized or locked chapters are passed over.
            fetched, tried, index = [], 0, 0
            while index < len(chapters) and len(fetched) < self.args.max_chapters and tried < 6:
                ch = chapters[index]
                index += 1
                if ch["number"] == 0 and len(chapters) > 1:
                    continue
                tried += 1
                sub = f"chuong-{ch['number']:g}".replace(".", "-")
                try:
                    body = source.chapter(story, ch)
                    if story["story_type"] == "manga":
                        urls = body.get("images") or []
                        backup = body.get("fallback") or []
                        if not (5 <= len(urls) <= self.args.max_pages):
                            continue
                        os.makedirs(os.path.join(folder, sub), exist_ok=True)
                        pages = []
                        for i, url in enumerate(urls, 1):
                            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
                            name = f"{i:03d}{ext if ext in ('.jpg', '.jpeg', '.png', '.webp', '.gif') else '.jpg'}"
                            target = os.path.join(folder, sub, name)
                            try:
                                info = self.download(url, target, story.get("referer"))
                            except Blocked:
                                raise
                            except Exception:
                                if i - 1 >= len(backup):
                                    raise
                                info = self.download(backup[i - 1], target, story.get("referer"))
                            pages.append({"file": f"{sub}/{name}", **info})
                        fetched.append((ch, {"pages": pages}))
                    else:
                        paragraphs = body.get("paragraphs") or []
                        if paragraphs:
                            fetched.append(({**ch, "title": body.get("title") or ch["title"]}, {"paragraphs": paragraphs}))
                except Blocked:
                    raise
                except Exception as e:
                    shutil.rmtree(os.path.join(folder, sub), ignore_errors=True)
                    log(f"[{source.name}] '{title}' chương {ch['number']:g} skipped: {e}")
            if not fetched:
                raise RuntimeError("no chapter content")

            # Smaller files and exact sizes from the backend's sharp (keeps originals if that fails)
            if story["story_type"] == "manga" or cover_file:
                converted = compress_folder(slug)
                if cover_file and cover_file in converted:
                    cover_file = converted[cover_file]["to"]
                for _, body in fetched:
                    for p in body.get("pages", []):
                        c = converted.get(p["file"])
                        if c:
                            p.update(file=c["to"].replace("\\", "/"), width=c["width"], height=c["height"], size=c["size"])

            self.insert(source, story, slug, cover_file, fetched)
            pages = sum(len(b.get("pages", [])) for _, b in fetched)
            log(f"[{source.name}] imported '{title}' -> /truyen/{slug} ({len(fetched)} chương{f', {pages} trang' if pages else ''})")
            with self.lock:
                self.done.add((source.name, story["source_id"]))
            return True
        except Blocked:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        except Exception as e:
            shutil.rmtree(folder, ignore_errors=True)  # never leave orphan files behind
            with self.lock:
                if slug in self.slugs:
                    self.slugs.remove(slug)
            log(f"[{source.name}] failed '{title}': {e}")
            return False

    def insert(self, source, story, slug, cover_file, fetched):
        tag_ids = set()
        for t in story.get("tags") or []:
            key = (t or "").strip().lower()
            key = TAG_ALIASES.get(key, key)
            if key and key in self.tags:
                tag_ids.add(self.tags[key])
        sql = ["BEGIN;", f"""
            INSERT INTO stories (title, slug, original_title, synopsis, cover_image_url, story_type, status,
                approval_status, approved_by, approved_at, uploader_id, original_language, translated_language,
                author_name, artist_name, year_published, total_chapters, total_favorites,
                total_views, last_chapter_at, source_name, source_id, source_url)
            VALUES ({q(story['title'][:500])}, {q(slug)}, {q((story.get('original_title') or '')[:500] or None)},
                {q((story.get('synopsis') or '')[:4000] or None)},
                {q(f'/uploads/manga/{slug}/{cover_file}' if cover_file else None)}, {q(story['story_type'])},
                {q(story.get('status') or 'ongoing')}, 'approved', {q(self.admin_id)}, NOW(), {q(self.admin_id)},
                {q((story.get('original_language') or 'ja')[:10])}, 'vi', {q((story.get('author') or '')[:200] or None)},
                {q((story.get('artist') or '')[:200] or None)}, {q(story.get('year'))}, {len(fetched)},
                {q(int(story.get('follows') or 0))},
                {starting_views()}, NOW(),
                {q(source.name)}, {q(str(story['source_id'])[:100])}, {q(story['url'])});"""]
        sid = f"(SELECT id FROM stories WHERE source_name = {q(source.name)} AND source_id = {q(str(story['source_id'])[:100])})"
        for tid in sorted(tag_ids):
            sql.append(f"INSERT INTO story_tags (story_id, tag_id) VALUES ({sid}, {q(tid)}) ON CONFLICT DO NOTHING;")
        for ch, body in fetched:
            number = ch["number"]
            name = ch.get("title") or ""
            if name and not re.match(r"(?i)^(chương|chapter|chap)\b", name):
                name = f"Chương {number:g}: {name}"
            name = name or f"Chương {number:g}"
            suffix = slugify(re.sub(r"(?i)^(chương|chapter|chap)\s*[\d.]+\s*[:.-]?\s*", "", ch.get("title") or ""))
            ch_slug = f"chuong-{number:g}".replace(".", "-") + (f"-{suffix}" if suffix else "")
            if "pages" in body:
                urls = [f"/uploads/manga/{slug}/{p['file']}" for p in body["pages"]]
                blocks = [{"id": f"p{i + 1}", "type": "image", "image_url": u,
                           **({"width": p["width"], "height": p["height"]} if p.get("width") and p.get("height") else {})}
                          for i, (u, p) in enumerate(zip(urls, body["pages"]))]
                content, words = "", 0
            else:
                blocks = [{"id": f"b{i + 1}", "type": "paragraph", "text": t} for i, t in enumerate(body["paragraphs"])]
                content = "\n\n".join(body["paragraphs"])
                words = len(content.split())
            sql.append(f"""
                INSERT INTO chapters (story_id, title, chapter_number, slug, content, content_blocks, word_count,
                    is_published, approval_status, uploader_id, published_at, source_group)
                VALUES ({sid}, {q(name[:500])}, {number}, {q(ch_slug[:500])}, {q(content)}, {q(json.dumps(blocks, ensure_ascii=False))}::jsonb,
                    {words}, TRUE, 'approved', {q(self.admin_id)}, NOW(), {q((ch.get('group') or source.label)[:200])});""")
            if "pages" in body:
                cid = f"(SELECT id FROM chapters WHERE story_id = {sid} AND chapter_number = {number})"
                for i, (u, p) in enumerate(zip(urls, body["pages"]), 1):
                    sql.append(f"INSERT INTO chapter_pages (chapter_id, page_number, image_url, width, height, file_size) "
                               f"VALUES ({cid}, {i}, {q(u)}, {q(p.get('width'))}, {q(p.get('height'))}, {int(p.get('size') or 0)});")
        sql.append("COMMIT;")
        psql("\n".join(sql))

    # one thread per source
    def worker(self, source):
        attempts = failures = streak = 0
        try:
            for cand in source.candidates():
                if self.full():
                    return
                if (source.name, str(cand["source_id"])) in self.done:
                    continue
                if not self.reserve():
                    return
                ok = False
                try:
                    ok = self.import_one(source, cand)
                except Blocked as b:
                    log(f"[{source.name}] {b} now answers with a bot challenge, dropping this source")
                    self.release(False, source.name)
                    return
                except PermissionError as e:
                    log(f"[{source.name}] {e}")
                    ok = None
                except Exception as e:
                    log(f"[{source.name}] error: {e}")
                self.release(bool(ok), source.name)
                time.sleep(self.args.delay * random.uniform(1, 2))  # rest between two stories

                # Circuit breaker: a source that keeps failing is dropped for this run
                if ok is None:
                    continue
                attempts += 1
                if ok:
                    streak = 0
                else:
                    failures += 1
                    streak += 1
                if streak >= self.args.max_failures or (attempts >= 12 and failures / attempts > 0.6):
                    log(f"[{source.name}] {failures}/{attempts} imports failed ({streak} in a row), dropping this source for this run")
                    return
        except Blocked as b:
            log(f"[{source.name}] {b} answers with a bot challenge, skipping this source")
        except Exception as e:
            log(f"[{source.name}] stopped: {e}")

    def run(self):
        count = self.prepare()
        if not self.args.dry_run:
            give_views_to_unviewed()
        if self.missing <= 0:
            log(f"site already has {count} stories (target {self.args.target}), nothing to do")
            return 0
        names = [n.strip() for n in self.args.sources.split(",") if n.strip() in SOURCES]
        log(f"site has {count} stories, importing up to {self.missing} from: {', '.join(names)}")
        threads = [threading.Thread(target=self.worker, args=(SOURCES[n](self.args),), daemon=True) for n in names]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        summary = ", ".join(f"{k}: {v}" for k, v in sorted(self.per_source.items())) or "none"
        log(f"done: {self.imported} new stories ({summary})")
        return self.imported


# ----------------------------------------------------------------------------- single instance

def pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == "nt":  # os.kill(pid, 0) would send CTRL_C on Windows
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_lock():
    os.makedirs(LOG_DIR, exist_ok=True)
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE) as f:
                if pid_alive(int(f.read().strip() or 0)):
                    return False
        except (OSError, ValueError):
            pass  # unreadable or left behind by a killed run: take it over
    with open(LOCK_FILE, "w") as f:
        f.write(str(os.getpid()))
    return True


def main():
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to a legacy code page
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    p = argparse.ArgumentParser(description="Import stories from several sites until the site has enough")
    p.add_argument("--target", type=int, default=100, help="stop when the site has this many stories (default 100)")
    p.add_argument("--max-chapters", type=int, default=2, help="chapters per story (default 2)")
    p.add_argument("--max-pages", type=int, default=45, help="skip manga chapters longer than this (default 45 pages)")
    p.add_argument("--sources", default=",".join(SOURCES), help=f"comma-separated, from: {', '.join(SOURCES)}")
    p.add_argument("--delay", type=float, default=2.0,
                   help="seconds between two requests to the same site, and a longer rest between stories (default 2)")
    p.add_argument("--max-failures", type=int, default=8, help="drop a source after this many failed imports in a row (default 8)")
    p.add_argument("--dry-run", action="store_true", help="list what would be imported, write nothing")
    p.add_argument("--no-reindex", action="store_true", help="don't restart catalog to refresh search afterwards")
    p.add_argument("--download-ratio", type=float, default=0.3,
                   help="after crawling, allow EPUB/PDF downloads on this share of imported stories, picked at random (default 0.3, 0 = off)")
    args = p.parse_args()

    HTTP.min_interval = args.delay
    if not acquire_lock():
        log("another crawler is already running (logs/crawler.lock); exiting")
        return
    try:
        imported = Importer(args).run()
        if not args.dry_run:
            try:
                enable_random_downloads(args.download_ratio)
            except Exception as e:  # e.g. migration 007 not applied yet
                log(f"could not enable random downloads: {e}")
        if imported and not args.dry_run:
            # Chapter content lives in the workspace service: give the new chapters their version 1 (safe to re-run)
            res = subprocess.run(["docker", "compose", "run", "--rm", "workspace", "import"], cwd=ROOT, capture_output=True)
            log("new chapters imported into the workspace" if res.returncode == 0 else "workspace import failed: run `docker compose run --rm workspace import`")
        if imported and not args.dry_run and not args.no_reindex:
            subprocess.run(["docker", "compose", "restart", "catalog"], cwd=ROOT, capture_output=True)
            log("catalog restarted to refresh the search index")
    except KeyboardInterrupt:
        log("interrupted")
    except Exception as e:
        log(f"error: {e}")
        sys.exit(1)
    finally:
        try:
            os.remove(LOCK_FILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
