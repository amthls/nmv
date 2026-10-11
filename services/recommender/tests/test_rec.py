"""Tests: signatures, event handling, training on a small synthetic catalogue, the API.
Integration tests need REC_TEST_DATABASE_URL (a throwaway database: it is wiped)."""
import hashlib
import hmac
import json
import os
import time
import uuid

import numpy as np
import pytest

from rec import algorithms as alg
from rec.common import Config, connect, internal_header, migrate, user_from

DB = os.environ.get("REC_TEST_DATABASE_URL", "")
KEY = "k" * 32
need_db = pytest.mark.skipif(not DB, reason="REC_TEST_DATABASE_URL not set")


def signed(uid, roles="", key=KEY, exp=None):
    exp = str(exp or int(time.time()) + 60)
    sig = hmac.new(key.encode(), f"{uid}|{roles}|{exp}".encode(), hashlib.sha256).hexdigest()
    return {"x-user-id": uid, "x-user-roles": roles, "x-user-exp": exp, "x-user-sig": sig}


def test_signatures():
    uid = str(uuid.uuid4())
    assert user_from(KEY.encode(), signed(uid, "admin,user")) == (uid, ["admin", "user"])
    assert user_from(KEY.encode(), signed(uid, key="x" * 32)) == (None, [])
    assert user_from(KEY.encode(), signed(uid, exp=int(time.time()) - 1)) == (None, [])
    assert user_from(KEY.encode(), {**signed(uid), "x-user-roles": "admin"}) == (None, [])  # roles are signed too
    exp, sig = internal_header(b"i" * 32, 1234).split(".")
    assert exp == "1234" and sig == hmac.new(b"i" * 32, b"internal|1234", hashlib.sha256).hexdigest()


def test_algorithms_small():
    # co-visitation: B after A twice, C after A once (second step counts half)
    cov = alg.co_visitation([[(0, 0), (1, 10), (2, 20)], [(0, 0), (1, 10)]], 3)
    assert cov[0, 1] == 1 and cov[0, 2] == 0.25 and cov[1, 2] == 1
    # content: the two stories sharing tags and author are neighbours, the third is not
    docs = [{"tags": ["a", "b"], "type": "novel", "author": "X", "group": None, "text": "kiếm hiệp giang hồ"},
            {"tags": ["a", "b"], "type": "novel", "author": "X", "group": None, "text": "kiếm hiệp giang hồ"},
            {"tags": ["c"], "type": "manga", "author": "Y", "group": None, "text": "học đường"}]
    S = alg.content_similarity(docs)
    assert S[0, 1] > 0.5 and S[0, 2] == 0 and S[0, 0] == 0
    # item cosine with shrinkage: items read together are similar
    sim, co, readers = alg.item_cosine(np.array([0, 0, 1, 1, 2]), np.array([0, 1, 0, 1, 2]), np.ones(5), 3, 3)
    assert sim[0, 1] > 0 and sim[0, 2] == 0 and co[0, 1] == 2 and list(readers) == [2, 2, 1]
    assert alg.rank_metrics([5, 3, 1], 3) == (1.0, 1 / np.log2(3))


# ---- integration ---------------------------------------------------------------------------------------------------

@pytest.fixture
def conn():
    with connect(DB) as c:
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        migrate(c)
        yield c


STORIES = [str(uuid.UUID(int=i + 1)) for i in range(8)]


def seed_catalogue(conn):
    for i, sid in enumerate(STORIES):
        tags = [{"slug": "fantasy", "name": "Fantasy"}] if i < 4 else [{"slug": "romance", "name": "Romance"}]
        conn.execute("""INSERT INTO ext_stories (id, title, slug, story_type, approval_status, author_name, tags, total_chapters,
            created_at, updated_at) VALUES (%s, %s, %s, 'novel', 'approved', %s, %s, 10, NOW() - make_interval(days => %s), NOW())""",
                     (sid, f"Truyện {i}", f"truyen-{i}", f"Tác giả {i % 3}", json.dumps(tags), 10 - i))


def event(t, data):
    return {"event_id": str(uuid.uuid4()), "type": t, "version": 1, "occurred_at": "2026-10-11T00:00:00Z", "data": data}


@need_db
def test_events_idempotent_and_ordered(conn):
    from rec.ingest import apply_event
    u, s = str(uuid.uuid4()), STORIES[0]
    read = event("catalog.chapter.read", {"user_id": u, "story_id": s, "chapter_id": str(uuid.uuid4()), "at": "2026-10-11T10:00:00Z"})
    apply_event(conn, read)
    apply_event(conn, read)  # redelivered
    again = event("catalog.chapter.read", {**read["data"], "at": "2026-10-11T18:00:00Z"})
    apply_event(conn, again)  # same chapter, same day
    assert conn.execute("SELECT count(*) AS n FROM events").fetchone()["n"] == 1
    apply_event(conn, event("catalog.story.viewed", {"visitor_id": "a" * 32, "story_id": s, "at": "2026-10-11T10:00:00Z"}))
    # an older "unfollowed" arriving after a newer "followed" changes nothing
    apply_event(conn, event("library.story.followed", {"user_id": u, "story_id": s, "at": "2026-10-11T10:00:00Z"}))
    apply_event(conn, event("library.story.unfollowed", {"user_id": u, "story_id": s, "at": "2026-10-11T09:00:00Z"}))
    assert conn.execute("SELECT following FROM favorites").fetchone()["following"] is True
    a = str(uuid.uuid4())
    apply_event(conn, event("library.album.story_added", {"user_id": u, "album_id": a, "story_id": s, "at": "2026-10-11T10:00:00Z"}))
    apply_event(conn, event("library.album.story_removed", {"user_id": u, "album_id": a, "story_id": s, "at": "2026-10-11T11:00:00Z"}))
    assert conn.execute("SELECT present FROM album_stories").fetchone()["present"] is False
    apply_event(conn, event("library.bookmark.created", {"bookmark_id": a, "user_id": u, "story_id": s, "at": "2026-10-11T10:00:00Z"}))
    apply_event(conn, event("identity.user.deleted", {"id": u, "version": 2}))
    for table in ("favorites", "album_stories", "bookmarks"):
        assert conn.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"] == 0
    assert conn.execute("SELECT count(*) AS n FROM events").fetchone()["n"] == 1  # the guest's view stays


def seed_readers(conn, n=40):
    """Fantasy fans read 0,1,2,3 in order, romance fans 4,5,6,7: "read next" and co-reading should find it."""
    users = []
    for k in range(n):
        u = str(uuid.UUID(int=1000 + k))
        users.append(u)
        base = 0 if k % 2 == 0 else 4
        upto = 2 + k % 3  # 2..4 stories each
        for step, sid in enumerate(STORIES[base:base + upto]):
            for ch in range(3):
                conn.execute("""INSERT INTO events (user_id, story_id, chapter_id, kind, created_at)
                    VALUES (%s, %s, %s, 'read', NOW() - make_interval(hours => %s))""",
                             (u, sid, str(uuid.uuid4()), 100 - step * 5 - ch))
        if k % 4 == 0:
            conn.execute("INSERT INTO favorites VALUES (%s, %s, true, NOW())", (u, STORIES[base]))
    return users


@need_db
def test_training(conn):
    from rec.train import train
    seed_catalogue(conn)
    users = seed_readers(conn)
    r = train(conn)
    assert r["users"] == 40 and r["stories"] == 8 and r["metrics"]["offline"]["evaluated_readers"] > 5
    run = conn.execute("SELECT status, metrics FROM rec_model_runs").fetchone()
    assert run["status"] == "ok" and "home" in run["metrics"]["offline"]
    # related stories of a fantasy story are fantasy stories first
    top = [x["similar_id"] for x in conn.execute(
        "SELECT similar_id::text FROM rec_item_similar WHERE story_id = %s ORDER BY score DESC LIMIT 3", (STORIES[0],))]
    assert set(top) <= set(STORIES[1:4]), top
    # a fantasy reader who read 0,1 is offered 2 or 3, never what they read
    picks = [x["story_id"] for x in conn.execute(
        "SELECT story_id::text FROM rec_user_scores WHERE user_id = %s ORDER BY score DESC LIMIT 2", (users[0],))]
    assert picks and picks[0] in STORIES[2:4] and not set(picks) & set(STORIES[:2]), picks
    assert conn.execute("SELECT count(*) AS n FROM rec_user_factors").fetchone()["n"] == 40
    # a second run while one holds the lock is skipped
    with connect(DB) as other:
        other.execute("SELECT pg_advisory_lock(74201001)")
        assert train(conn) == {"skipped": True}


@need_db
def test_api(conn):
    from fastapi.testclient import TestClient
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
    from rec.api import create_app
    from rec.train import train
    seed_catalogue(conn)
    users = seed_readers(conn)
    train(conn)
    cfg = Config({"RECOMMENDER_DATABASE_URL": DB, "USER_SIG_KEY_RECOMMENDER": KEY, "INTERNAL_KEY_BACKEND": "b" * 32,
                  "INTERNAL_KEY_LIBRARY": "l" * 32, "LIBRARY_INTERNAL_URL": "http://127.0.0.1:9"})  # library down: empty history
    pool = ConnectionPool(DB, kwargs={"row_factory": dict_row, "autocommit": True}, open=True)
    with TestClient(create_app(cfg, pool=pool, background=False)) as c:
        guest = c.get("/home", cookies={"nh_vid": "b" * 32}).json()
        assert guest["success"] and len(guest["data"]["stories"]) == 8 and guest["data"]["stories"][0]["rec_label"]
        me = c.get("/home?limit=3", headers=signed(users[0])).json()["data"]
        assert me["personalized"] and len(me["stories"]) == 3 and me["stories"][0]["slug"].startswith("truyen-")
        rel = c.get(f"/related/{STORIES[0]}").json()["data"]["stories"]
        assert rel and rel[0]["id"] in STORIES[1:4] and rel[0]["rec_label"]
        assert c.get("/related/nope").status_code == 404
        # cold start: a story nobody read yet gets same-genre stories
        cold = str(uuid.uuid4())
        conn.execute("""INSERT INTO ext_stories (id, title, slug, approval_status, tags, updated_at)
            VALUES (%s, 'Mới', 'moi', 'approved', '[{"slug": "romance", "name": "Romance"}]', NOW())""", (cold,))
        rel = c.get(f"/related/{cold}").json()["data"]["stories"]
        assert rel[0]["rec_label"] == "Cùng thể loại Romance"
        # feedback on the rows
        assert c.post("/events", json={"kind": "click", "source": "related", "story_ids": [STORIES[1], "x"]},
                      cookies={"nh_vid": "c" * 32}).status_code == 202
        assert conn.execute("SELECT count(*) AS n FROM events WHERE kind = 'click'").fetchone()["n"] == 1
        assert c.post("/events", json={"kind": "buy"}).status_code == 400
        # admin only
        assert c.get("/status").status_code == 401
        assert c.get("/status", headers=signed(users[0])).status_code == 403
        assert c.get("/status", headers=signed(users[0], "admin")).json()["data"][0]["status"] == "ok"
    pool.close()
