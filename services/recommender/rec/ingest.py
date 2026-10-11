"""Everything that fills recommender_db: the story copy (polled from the backend), events from the bus, the one-time
import of the backend's rec_events and the library's history."""
import json
import threading
import time
import urllib.parse

import pika

from .common import call, connect, data_of, log

# ---- story copy ----------------------------------------------------------------------------------------------------
# Every 30 s: rows changed since the cursor ((updated_at, id) of the last row taken), same endpoint as library's copy.
# Once a day: drop copies of stories the backend no longer has. shortcut: polling, until catalog publishes story events.

UPSERT_STORIES = """
INSERT INTO ext_stories (id, title, slug, cover_image_url, story_type, status, approval_status, author_name, group_id, synopsis,
  tags, total_chapters, total_views, total_favorites, last_chapter_at, created_at, updated_at, synced_at)
SELECT id, title, slug, cover_image_url, story_type, status, approval_status, author_name, group_id, synopsis,
  COALESCE(tags, '[]'), COALESCE(total_chapters, 0), COALESCE(total_views, 0), COALESCE(total_favorites, 0), last_chapter_at,
  created_at, updated_at, NOW()
FROM jsonb_to_recordset(%s::jsonb) AS x(id uuid, title text, slug text, cover_image_url text, story_type text, status text,
  approval_status text, author_name text, group_id uuid, synopsis text, tags jsonb, total_chapters int, total_views bigint,
  total_favorites bigint, last_chapter_at timestamptz, created_at timestamptz, updated_at timestamptz)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, cover_image_url = EXCLUDED.cover_image_url,
  story_type = EXCLUDED.story_type, status = EXCLUDED.status, approval_status = EXCLUDED.approval_status,
  author_name = EXCLUDED.author_name, group_id = EXCLUDED.group_id, synopsis = EXCLUDED.synopsis, tags = EXCLUDED.tags,
  total_chapters = EXCLUDED.total_chapters, total_views = EXCLUDED.total_views, total_favorites = EXCLUDED.total_favorites,
  last_chapter_at = EXCLUDED.last_chapter_at, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, synced_at = NOW()"""


def sync_stories(conn, cfg):
    while True:
        row = conn.execute("SELECT last_ts::text, last_id::text FROM sync_state WHERE name = 'stories'").fetchone()
        since, after = (row["last_ts"], row["last_id"]) if row else ("1970-01-01T00:00:00Z", "00000000-0000-0000-0000-000000000000")
        q = urllib.parse.urlencode({"since": since, "after": after, "limit": 500})
        page = data_of(cfg.backend_url, cfg.backend_key, f"/internal/library/stories?{q}", timeout=30)
        if not page:
            return
        with conn.transaction():
            conn.execute(UPSERT_STORIES, (json.dumps(page),))
            conn.execute("""INSERT INTO sync_state (name, last_ts, last_id) VALUES ('stories', %s, %s)
                ON CONFLICT (name) DO UPDATE SET last_ts = EXCLUDED.last_ts, last_id = EXCLUDED.last_id""",
                         (page[-1]["updated_at"], page[-1]["id"]))
        if len(page) < 500:
            return


def reconcile_stories(conn, cfg):
    """Drops copies (and results) of stories the backend no longer has; restarts the cursor so the next sync copies all."""
    ids = data_of(cfg.backend_url, cfg.backend_key, "/internal/library/ids?type=story", timeout=30)
    with conn.transaction():
        conn.execute("DELETE FROM sync_state WHERE name = 'stories'")
        n = conn.execute("DELETE FROM ext_stories WHERE NOT (id = ANY(%s::uuid[]))", (ids,)).rowcount
        conn.execute("DELETE FROM rec_item_similar WHERE NOT (story_id = ANY(%s::uuid[]) AND similar_id = ANY(%s::uuid[]))", (ids, ids))
        conn.execute("DELETE FROM rec_user_scores WHERE NOT (story_id = ANY(%s::uuid[]))", (ids,))
    if n:
        log("info", f"reconcile: dropped {n} story copies")


def sync_loop(cfg, stop: threading.Event):
    next_reconcile = time.time() + 300
    while not stop.is_set():
        try:
            with connect(cfg.database_url) as conn:
                sync_stories(conn, cfg)
                if time.time() > next_reconcile:
                    reconcile_stories(conn, cfg)
                    next_reconcile = time.time() + 86400
        except Exception as e:
            log("warn", f"story sync: {e}")
        stop.wait(30)


# ---- events --------------------------------------------------------------------------------------------------------
# Own queue recommender.events bound to the keys below; failures retry through .retry (10 s), parked in .dlq after 5.

EXCHANGE = "novelhub.events"
QUEUE = "recommender.events"
KEYS = ["catalog.story.viewed", "catalog.chapter.read", "library.story.followed", "library.story.unfollowed",
        "library.album.story_added", "library.album.story_removed", "library.bookmark.created", "library.bookmark.deleted",
        "identity.user.deleted"]


def apply_event(conn, ev):
    """Applies one event (envelope dict). Idempotent: redelivery and out-of-order delivery leave the same state."""
    t, d = ev["type"], ev.get("data") or {}
    if t in ("catalog.story.viewed", "catalog.chapter.read"):
        conn.execute("""INSERT INTO events (event_id, user_id, visitor_id, story_id, chapter_id, kind, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                     (ev["event_id"], d.get("user_id"), None if d.get("user_id") else d.get("visitor_id"), d["story_id"],
                      d.get("chapter_id"), "read" if t == "catalog.chapter.read" else "view", d["at"]))
    elif t in ("library.story.followed", "library.story.unfollowed"):
        conn.execute("""INSERT INTO favorites (user_id, story_id, following, at) VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, story_id) DO UPDATE SET following = EXCLUDED.following, at = EXCLUDED.at
            WHERE favorites.at <= EXCLUDED.at""", (d["user_id"], d["story_id"], t.endswith(".followed"), d["at"]))
    elif t in ("library.album.story_added", "library.album.story_removed"):
        conn.execute("""INSERT INTO album_stories (album_id, story_id, user_id, present, at) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (album_id, story_id) DO UPDATE SET present = EXCLUDED.present, at = EXCLUDED.at
            WHERE album_stories.at <= EXCLUDED.at""", (d["album_id"], d["story_id"], d["user_id"], t.endswith("_added"), d["at"]))
    elif t in ("library.bookmark.created", "library.bookmark.deleted"):
        conn.execute("""INSERT INTO bookmarks (id, user_id, story_id, present, at) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET present = EXCLUDED.present, at = EXCLUDED.at WHERE bookmarks.at <= EXCLUDED.at""",
                     (d["bookmark_id"], d["user_id"], d["story_id"], t.endswith(".created"), d["at"]))
    elif t == "identity.user.deleted":
        uid = d.get("id") or d.get("user_id")
        with conn.transaction():
            for table in ("events", "favorites", "album_stories", "bookmarks", "rec_user_scores", "rec_user_factors"):
                conn.execute(f"DELETE FROM {table} WHERE user_id = %s", (uid,))


def consume_loop(cfg, stop: threading.Event):
    if not cfg.rabbit_url:
        log("warn", "RABBITMQ_URL empty: no events")
        return
    backoff = 1
    while not stop.is_set():
        try:
            _consume(cfg, stop)
        except Exception as e:
            log("warn", f"event consumer stopped, retrying: {e}")
        stop.wait(backoff)
        backoff = min(backoff * 2, 30)


def _consume(cfg, stop):
    params = pika.URLParameters(cfg.rabbit_url)
    params.heartbeat = 30
    mq = pika.BlockingConnection(params)
    try:
        ch = mq.channel()
        ch.exchange_declare(EXCHANGE, "topic", durable=True)
        ch.queue_declare(QUEUE + ".dlq", durable=True)
        ch.queue_declare(QUEUE + ".retry", durable=True, arguments={
            "x-message-ttl": 10000, "x-dead-letter-exchange": "", "x-dead-letter-routing-key": QUEUE})
        ch.queue_declare(QUEUE, durable=True, arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": QUEUE + ".retry"})
        for k in KEYS:
            ch.queue_bind(QUEUE, EXCHANGE, k)
        ch.basic_qos(prefetch_count=50)
        log("info", "event consumer connected")
        with connect(cfg.database_url) as conn:
            for method, props, body in ch.consume(QUEUE, inactivity_timeout=1):
                if stop.is_set():
                    break
                if method is None:
                    continue
                try:
                    apply_event(conn, json.loads(body))
                    ch.basic_ack(method.delivery_tag)
                except Exception as e:
                    deaths = sum(int(x.get("count", 0)) for x in (props.headers or {}).get("x-death", []) if x.get("queue") == QUEUE)
                    if deaths >= 4:
                        log("error", f"event parked in {QUEUE}.dlq: {e}", type=_type(body))
                        ch.basic_publish("", QUEUE + ".dlq", body, pika.BasicProperties(delivery_mode=2, headers={"last_error": str(e)[:500]}))
                        ch.basic_ack(method.delivery_tag)
                    else:
                        log("warn", f"event failed, retry in 10 s: {e}", type=_type(body))
                        ch.basic_nack(method.delivery_tag, requeue=False)  # dead-letters to .retry
                    if conn.closed:
                        raise
    finally:
        if mq.is_open:
            mq.close()


def _type(body):
    try:
        return json.loads(body).get("type")
    except ValueError:
        return None


# ---- one-time import -----------------------------------------------------------------------------------------------

def import_legacy(cfg):
    """Copies the backend's rec_events (LEGACY_DATABASE_URL) and the library's history/follows/albums/bookmarks
    (GET /internal/reco/export) once; later runs skip the parts already done (legacy_imports). Needs the backend up
    for the story copy."""
    with connect(cfg.database_url) as conn:
        sync_stories(conn, cfg)
        done = {r["part"] for r in conn.execute("SELECT part FROM legacy_imports")}
        if "rec_events" not in done and cfg.legacy_url:
            with connect(cfg.legacy_url) as legacy, conn.transaction():
                # the table is gone once migration 027 ran (fresh installs never have it)
                has_table = legacy.execute("SELECT to_regclass('rec_events') IS NOT NULL AS ok").fetchone()["ok"]
                rows = legacy.execute("""SELECT user_id, visitor_id, story_id, chapter_id, kind, source, created_at
                    FROM rec_events ORDER BY id""").fetchall() if has_table else []
                with conn.cursor() as cur:
                    cur.executemany("""INSERT INTO events (user_id, visitor_id, story_id, chapter_id, kind, source, created_at)
                        VALUES (%(user_id)s, %(visitor_id)s, %(story_id)s, %(chapter_id)s, %(kind)s, %(source)s, %(created_at)s)
                        ON CONFLICT DO NOTHING""", rows)
                conn.execute("INSERT INTO legacy_imports (part) VALUES ('rec_events')")
            log("info", f"import-legacy: rec_events {len(rows)}")
        if "library" not in done:
            status, js = call(cfg.library_url, cfg.library_key, "GET", "/internal/reco/export?days=180", timeout=120)
            if status != 200:
                raise RuntimeError(f"library export: HTTP {status}")
            ex = js["data"]
            with conn.transaction(), conn.cursor() as cur:
                cur.executemany("""INSERT INTO events (user_id, story_id, chapter_id, kind, created_at)
                    VALUES (%(user_id)s, %(story_id)s, %(chapter_id)s, 'read', %(read_at)s) ON CONFLICT DO NOTHING""", ex["reads"])
                cur.executemany("""INSERT INTO favorites (user_id, story_id, following, at) VALUES (%(user_id)s, %(story_id)s, true, %(created_at)s)
                    ON CONFLICT DO NOTHING""", ex["favorites"])
                cur.executemany("""INSERT INTO album_stories (album_id, story_id, user_id, present, at)
                    VALUES (%(album_id)s, %(story_id)s, %(user_id)s, true, %(added_at)s) ON CONFLICT DO NOTHING""", ex["albums"])
                cur.executemany("""INSERT INTO bookmarks (id, user_id, story_id, present, at)
                    VALUES (%(id)s, %(user_id)s, %(story_id)s, true, %(created_at)s) ON CONFLICT DO NOTHING""", ex["bookmarks"])
                conn.execute("INSERT INTO legacy_imports (part) VALUES ('library')")
            log("info", "import-legacy: library " + ", ".join(f"{k} {len(v)}" for k, v in ex.items()))
