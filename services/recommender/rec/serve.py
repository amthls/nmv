"""Serving side (port of the backend's former serve.ts): reads the precomputed tables, mixes in what the viewer did since
the last training run, and turns every pick into a card with a short Vietnamese reason label."""
import time
from datetime import datetime

from .common import data_of, log

CARD_SQL = """SELECT id, title, slug, cover_image_url, story_type, status, author_name, total_chapters, total_views, total_favorites,
    last_chapter_at, created_at FROM ext_stories WHERE id = ANY(%s::uuid[]) AND approval_status = 'approved'"""


def cards(conn, ids):
    if not ids:
        return {}
    return {str(r["id"]): {**r, "id": str(r["id"])} for r in conn.execute(CARD_SQL, (list(ids),))}


def pct_label(p):
    return f"{max(1, round(p * 100))}%"


_history_cache = {}  # one page asks up to 3 times


def library_history(cfg, user_id):
    """A signed-in reader's history from the library service; empty when library does not answer (picks then fall back
    to what everyone reads)."""
    hit = _history_cache.get(user_id)
    if hit and time.time() - hit[0] < 5:
        return hit[1]
    if len(_history_cache) > 5000:
        _history_cache.clear()
    try:
        v = data_of(cfg.library_url, cfg.library_key, f"/internal/reco/user/{user_id}", timeout=2)
    except Exception as e:
        log("warn", f"reading history of {user_id} unavailable: {e}")
        v = {"read_story_ids": [], "recent": [], "continue": []}
    _history_cache[user_id] = (time.time(), v)
    return v


def read_stories(conn, cfg, viewer):
    """Stories the viewer has read (signed in: history; guest: read events)."""
    if viewer["user_id"]:
        return set(library_history(cfg, viewer["user_id"])["read_story_ids"])
    if not viewer["visitor_id"]:
        return set()
    return {str(r["story_id"]) for r in conn.execute(
        "SELECT DISTINCT story_id FROM events WHERE visitor_id = %s AND kind = 'read'", (viewer["visitor_id"],))}


def _t(v):
    if isinstance(v, datetime):
        return v.timestamp()
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def recent_stories(conn, cfg, viewer, limit=8):
    """The viewer's latest stories (reads count more than page views), newest first, with a weight."""
    if not viewer["user_id"] and not viewer["visitor_id"]:
        return []
    history = library_history(cfg, viewer["user_id"])["recent"] if viewer["user_id"] else []
    col = "user_id" if viewer["user_id"] else "visitor_id"
    ev = conn.execute(f"""SELECT story_id::text, CASE WHEN kind = 'read' THEN 1.0 ELSE 0.4 END AS w, created_at AS t
        FROM events WHERE {col} = %s AND kind IN ('view', 'read') AND created_at > NOW() - INTERVAL '60 days'""",
                      (viewer["user_id"] or viewer["visitor_id"],)).fetchall()
    by_story = {}
    for e in [{"story_id": h["story_id"], "w": 1, "t": h["t"]} for h in history] + ev:
        cur = by_story.setdefault(e["story_id"], [0.0, 0.0])
        cur[0] += float(e["w"])
        cur[1] = max(cur[1], _t(e["t"]))
    ordered = sorted(by_story.items(), key=lambda x: -x[1][1])[:limit]
    return [(sid, min(3, w) * 0.8 ** i) for i, (sid, (w, _)) in enumerate(ordered)]  # newer stories weigh more


def session_candidates(conn, recent):
    """Sum of related-story scores of the viewer's recent stories: works for guests and fresh activity."""
    if not recent:
        return {}
    weights = dict(recent)
    out = {}
    for r in conn.execute("SELECT story_id::text, similar_id::text, score FROM rec_item_similar WHERE story_id = ANY(%s::uuid[])",
                          (list(weights),)):
        v = weights[r["story_id"]] * r["score"]
        cur = out.get(r["similar_id"])
        if not cur:
            out[r["similar_id"]] = {"score": v, "source": r["story_id"], "best": v}
        else:
            cur["score"] += v
            if v > cur["best"]:
                cur["best"], cur["source"] = v, r["story_id"]
    return out


def home(conn, cfg, viewer, limit=18):
    """"Đề xuất cho bạn": continue reading first, then the model's picks, then popular stories."""
    cont = library_history(cfg, viewer["user_id"])["continue"][:3] if viewer["user_id"] else []
    read = read_stories(conn, cfg, viewer)
    recent = recent_stories(conn, cfg, viewer)

    picks = {}
    if viewer["user_id"]:
        for r in conn.execute("""SELECT story_id::text, score, reason, reason_story_id::text, reason_tag, pct FROM rec_user_scores
                WHERE user_id = %s ORDER BY score DESC""", (viewer["user_id"],)):
            picks[r["story_id"]] = {"score": r["score"], "reason": r["reason"], "source": r["reason_story_id"],
                                    "tag": r["reason_tag"], "pct": r["pct"]}
    # what they did since the last training run (and everything, for guests)
    session = session_candidates(conn, recent)
    max_session = max([1e-9] + [s["score"] for s in session.values()])
    personal = bool(picks)
    for sid, s in session.items():
        boost = s["score"] / max_session * (0.35 if personal else 1)
        if sid in picks:
            picks[sid]["score"] += boost
        else:
            picks[sid] = {"score": boost, "reason": "because_read", "source": s["source"]}

    cont_ids = {c["story_id"] for c in cont}
    ranked = sorted(((sid, p) for sid, p in picks.items() if sid not in read and sid not in cont_ids), key=lambda x: -x[1]["score"])
    if len(ranked) < limit:  # top up with popular stories
        for r in conn.execute("""SELECT s.id::text FROM ext_stories s LEFT JOIN rec_item_factors f ON f.story_id = s.id
                WHERE s.approval_status = 'approved' ORDER BY COALESCE(f.popularity, 0) DESC, s.total_views DESC LIMIT %s""", (limit * 2,)):
            if len(ranked) >= limit:
                break
            if r["id"] not in read and r["id"] not in cont_ids and r["id"] not in picks:
                ranked.append((r["id"], {"score": 0, "reason": "popular"}))
    ranked = ranked[: max(0, limit - len(cont))]

    info = cards(conn, [c["story_id"] for c in cont] + [sid for sid, _ in ranked] + [p["source"] for _, p in ranked if p.get("source")])
    out = []
    for c in cont:
        s = info.get(c["story_id"])
        if s:
            out.append({**s, "rec_reason": "continue", "rec_label": f"Đọc tiếp chương {_num(c['chapter_number'])}",
                        "continue_slug": c["chapter_slug"]})
    for sid, p in ranked:
        s = info.get(sid)
        if not s:
            continue
        src = info.get(p.get("source")) if p.get("source") else None
        reason, label = p["reason"], "Đang được đọc nhiều"
        if reason == "because_read" and src:
            label = f"Vì bạn đọc {src['title']}"
        elif reason == "taste" and p.get("tag"):
            label = f"Hợp gu {p['tag']}"
        elif reason == "similar_users" and p.get("pct"):
            label = f"{pct_label(p['pct'])} người cùng gu đã đọc"
        else:
            reason = "popular"
        out.append({**s, "rec_reason": reason, "rec_label": label})
    return {"personalized": bool(picks) or bool(cont), "stories": out}


def _num(v):
    """Number(x) in JS: 12.00 -> 12, 12.5 -> 12.5."""
    f = float(v)
    return int(f) if f.is_integer() else f


def related(conn, cfg, story_id, viewer, limit=18):
    """"Truyện liên quan": the story's neighbours, re-ranked by the viewer's taste vector."""
    rows = conn.execute("""SELECT r.similar_id::text, r.score, r.co_readers, r.pct_readers, r.covisit, r.reason, r.reason_tag, f.factors
        FROM rec_item_similar r LEFT JOIN rec_item_factors f ON f.story_id = r.similar_id
        WHERE r.story_id = %s ORDER BY r.score DESC""", (story_id,)).fetchall()
    read = read_stories(conn, cfg, viewer)
    if not rows:  # cold start (story too new for the model): same genres / type, most read first
        base = conn.execute("SELECT story_type, tags FROM ext_stories WHERE id = %s", (story_id,)).fetchone()
        if base:
            slugs = {t["slug"]: t["name"] for t in base["tags"] or []}
            cands = conn.execute("""SELECT id::text, story_type, tags, total_views FROM ext_stories
                WHERE id <> %s AND approval_status = 'approved'""", (story_id,)).fetchall()
            scored = []
            for c in cands:
                shared = sorted(t["name"] for t in c["tags"] or [] if t["slug"] in slugs)
                scored.append(((len(shared), c["story_type"] == base["story_type"], c["total_views"] or 0),
                               {"similar_id": c["id"], "score": float(len(shared)), "co_readers": 0, "pct_readers": 0, "covisit": 0,
                                "reason": "content" if shared else "popular", "reason_tag": shared[0] if shared else None, "factors": None}))
            rows = [r for _, r in sorted(scored, key=lambda x: x[0], reverse=True)[: limit * 2]]

    u = None
    if viewer["user_id"]:
        f = conn.execute("SELECT factors FROM rec_user_factors WHERE user_id = %s", (viewer["user_id"],)).fetchone()
        u = f["factors"] if f else None
    if u and rows:
        # personal taste nudges the order: 80% "what readers of this story read", 20% "what you like"
        prefs = [sum(a * b for a, b in zip(r["factors"], u)) if r["factors"] else 0 for r in rows]
        lo, hi = min(prefs), max(prefs)
        max_score = max([1e-9] + [r["score"] for r in rows])
        for r, p in zip(rows, prefs):
            r["final"] = 0.8 * (r["score"] / max_score) + 0.2 * ((p - lo) / (hi - lo) if hi > lo else 0)
        rows.sort(key=lambda r: -r["final"])
    # hide what the viewer already read, unless that would leave the row nearly empty
    unread = [r for r in rows if r["similar_id"] not in read and r["similar_id"] != story_id]
    rows = (unread if len(unread) >= 6 else [r for r in rows if r["similar_id"] != story_id])[:limit]

    info = cards(conn, [r["similar_id"] for r in rows])
    out = []
    for r in rows:
        s = info.get(r["similar_id"])
        if not s:
            continue
        if r["reason"] == "co_read" and r["co_readers"] > 0:
            label = f"{pct_label(r['pct_readers'])} người đọc truyện này cũng đọc"
        elif r["reason"] == "next_read":
            label = "Thường được đọc tiếp theo"
        elif r["reason"] == "same_author":
            label = "Cùng tác giả"
        elif r["reason_tag"]:
            label = f"Cùng thể loại {r['reason_tag']}"
        elif r["reason"] == "popular":
            label = "Đang được đọc nhiều"
        else:
            label = "Nội dung tương tự"
        out.append({**s, "rec_reason": r["reason"], "rec_label": label})
    return {"stories": out}
