"""Training job (python -m rec train): reads every behaviour signal from recommender_db, fits the models, learns the blend
weights on a leave-last-out split and writes the precomputed results (rec_item_similar, rec_user_scores, factors).
Port of the backend's former train.ts. Runs as its own process (exits when done); a Postgres advisory lock keeps two
runs from overlapping."""
import itertools
import json
import math
import time
from datetime import datetime, timezone

import numpy as np

from . import algorithms as alg
from .common import log

LOCK_KEY = 74_201_001
HISTORY_DAYS = 180
HALF_LIFE_DAYS = 120
RELATED_PER_STORY = 30
RECS_PER_USER = 40
EVAL_MAX_ACTORS = 400

DEFAULT_USER_WEIGHTS = {"als": 0.3, "knn": 0.5, "content": 0.15, "pop": 0.05, "prior": 2}
DEFAULT_RELATED_WEIGHTS = {"cf": 0.5, "cov": 0.3, "content": 0.15, "pop": 0.05, "prior": 6}


# ---- data ----------------------------------------------------------------------------------------------------------

def preference(p, total_chapters, now):
    """How much one actor cares about one story, from everything they did with it."""
    r = 0.0
    if p["chapters"] > 0:
        completion = min(1, p["chapters"] / max(1, total_chapters))
        r += 1 + 1.5 * math.log2(1 + p["chapters"]) + 2 * completion
    r += min(p["views"] * 0.4, 1.2)
    if p["favorite"]:
        r += 2.5
    if p["album"]:
        r += 2
    r += min(p["bookmarks"] * 0.5, 1.5)
    if r <= 0:
        return 0.0
    age_days = (now - p["last"]) / 86400
    return r * max(0.25, 0.5 ** (age_days / HALF_LIFE_DAYS))


def ts(v):
    return v.timestamp() if v else 0.0


def load_dataset(conn):
    stories = conn.execute("""SELECT id::text, title, story_type, author_name, group_id::text, synopsis, total_chapters, tags
        FROM ext_stories WHERE approval_status = 'approved' ORDER BY created_at, id""").fetchall()
    items = [{"id": s["id"], "title": s["title"], "author": s["author_name"], "tags": s["tags"] or [],
              "total_chapters": s["total_chapters"] or 0} for s in stories]
    docs = [{"tags": [t["slug"] for t in (s["tags"] or [])], "type": s["story_type"], "author": s["author_name"],
             "group": s["group_id"], "text": f"{s['title']} {s['synopsis'] or ''}"} for s in stories]
    index = {s["id"]: i for i, s in enumerate(items)}
    pairs = {}

    def pair(actor, story):
        i = index.get(story)
        if i is None:
            return None
        return pairs.setdefault(actor, {}).setdefault(i, {"chapters": 0, "views": 0, "favorite": False, "album": False,
                                                          "bookmarks": 0, "last": 0.0})

    def touch(p, t):
        p["last"] = max(p["last"], ts(t))

    since = f"NOW() - INTERVAL '{HISTORY_DAYS} days'"
    actor_sql = "COALESCE('u:' || user_id::text, 'v:' || visitor_id)"
    for r in conn.execute(f"""SELECT {actor_sql} AS actor, story_id::text, kind, count(*)::int AS n,
            count(DISTINCT chapter_id)::int AS chapters, max(created_at) AS last
            FROM events WHERE kind IN ('view', 'read') AND created_at > {since} GROUP BY 1, 2, 3"""):
        p = pair(r["actor"], r["story_id"])
        if p:
            if r["kind"] == "view":
                p["views"] += r["n"]
            else:
                p["chapters"] += max(1, r["chapters"])
            touch(p, r["last"])
    for r in conn.execute("SELECT user_id::text, story_id::text, at FROM favorites WHERE following"):
        p = pair("u:" + r["user_id"], r["story_id"])
        if p:
            p["favorite"] = True
            touch(p, r["at"])
    for r in conn.execute("SELECT user_id::text, story_id::text, max(at) AS at FROM album_stories WHERE present GROUP BY 1, 2"):
        p = pair("u:" + r["user_id"], r["story_id"])
        if p:
            p["album"] = True
            touch(p, r["at"])
    for r in conn.execute("SELECT user_id::text, story_id::text, count(*)::int AS n, max(at) AS at FROM bookmarks WHERE present GROUP BY 1, 2"):
        p = pair("u:" + r["user_id"], r["story_id"])
        if p:
            p["bookmarks"] += r["n"]
            touch(p, r["at"])

    now = time.time()
    actors, ia, ii, rr, read_sets, read_order = [], [], [], [], [], []
    actor_index = {}
    for actor, m in pairs.items():
        lst, read_set, reads = [], set(), []
        for item, p in m.items():
            v = preference(p, items[item]["total_chapters"], now)
            if v > 0:
                lst.append((item, v))
            if p["chapters"] > 0:
                read_set.add(item)
                reads.append((p["last"], item))
        if not lst:
            continue
        a = len(actors)
        actor_index[actor] = a
        actors.append(actor)
        for item, v in lst:
            ia.append(a)
            ii.append(item)
            rr.append(v)
        read_sets.append(read_set)
        read_order.append([item for _, item in sorted(reads)])

    timelines = [[] for _ in actors]
    for r in conn.execute(f"""SELECT {actor_sql} AS actor, story_id::text, created_at AS t FROM events
            WHERE kind IN ('view', 'read') AND created_at > {since} ORDER BY 1, created_at"""):
        a, item = actor_index.get(r["actor"]), index.get(r["story_id"])
        if a is not None and item is not None:
            timelines[a].append((item, ts(r["t"])))

    return {"actors": actors, "items": items, "ia": np.array(ia, dtype=int), "ii": np.array(ii, dtype=int),
            "r": np.array(rr, dtype=float), "read_sets": read_sets, "read_order": read_order, "timelines": timelines,
            "docs": docs}


# ---- model ---------------------------------------------------------------------------------------------------------

class Model:
    def __init__(self, ia, ii, r, n_actors, n_items):
        self.X, self.Y = alg.train_als(ia, ii, r, n_actors, n_items)
        self.sim, self.co, self.readers = alg.item_cosine(ia, ii, r, n_actors, n_items)
        pop = np.zeros(n_items)
        np.add.at(pop, ii, np.minimum(r, 3))
        self.popularity = pop / max(1e-9, pop.max(initial=0))
        self.by_actor = [[] for _ in range(n_actors)]
        for a, i, v in zip(ia, ii, r):
            self.by_actor[a].append((i, v))


def norm01(v, idx):
    if len(idx) == 0:
        return v
    lo, hi = v[idx].min(), v[idx].max()
    out = np.zeros_like(v)
    if hi - lo > 1e-12:
        out[idx] = (v[idx] - lo) / (hi - lo)
    return out


def actor_components(model, content, a, exclude, n_items):
    """Per-candidate signals for one actor, each scaled to 0..1, computed once and blended cheaply."""
    mine = model.by_actor[a]
    total_r = sum(v for _, v in mine) or 1
    als = model.Y @ model.X[a]
    knn = np.zeros(n_items)
    ct = np.zeros(n_items)
    src = np.full(n_items, -1)
    best = np.zeros(n_items)
    for i, v in mine:
        contrib = v * model.sim[i]
        knn += contrib
        better = contrib > best
        best[better] = contrib[better]
        src[better] = i
        c = v * content[i]
        ct += c
        src[(src == -1) & (content[i] > 0)] = i
    idx = np.array([j for j in range(n_items) if j not in exclude], dtype=int)
    return {"items": idx, "als": norm01(als, idx), "knn": norm01(knn / total_r, idx), "ct": norm01(ct / total_r, idx),
            "pop": model.popularity, "src": src, "n_read": len(mine)}


def blend_actor(c, w):
    """Personal ranking: collaborative signals weigh more the more we know about the reader; with few stories read it
    leans on content and popularity (prior = stories needed for the collaborative part to count half).
    Returns [(item, score, reason, source)] best first."""
    conf = c["n_read"] / ((c["n_read"] + w["prior"]) or 1)
    j = c["items"]
    parts = np.vstack([conf * w["als"] * c["als"][j], conf * w["knn"] * c["knn"][j],
                       (conf * w["content"] + (1 - conf) * 0.6) * c["ct"][j], (w["pop"] + (1 - conf) * 0.4) * c["pop"][j]])
    score = parts.sum(axis=0)
    top = parts.argmax(axis=0)  # ties go to the first part, as before
    reasons = ("similar_users", "because_read", "taste", "popular")
    order = np.argsort(-score, kind="stable")
    return [(int(j[o]), float(score[o]), reasons[top[o]], int(c["src"][j[o]]) if c["src"][j[o]] >= 0 else None) for o in order]


def diversify(ranked, content, n, penalty=0.15):
    """Re-rank so the row isn't ten stories of the same kind (maximal marginal relevance)."""
    pool = ranked[: n * 3]
    picked = []
    while len(picked) < n and pool:
        best, best_val = 0, -math.inf
        for idx, c in enumerate(pool):
            redundancy = max([0.0] + [content[p[0], c[0]] for p in picked])
            val = c[1] - penalty * redundancy
            if val > best_val:
                best, best_val = idx, val
        picked.append(pool.pop(best))
    return picked


def related_parts(model, content, covisit, i):
    """Candidate neighbours of story i with their raw signals (cf scaled to 0..1 per story): columns j, cf, cov, ct, pop."""
    max_cf = max(1e-9, model.sim[i].max(initial=0))
    cands = np.nonzero((model.sim[i] != 0) | (covisit[i] != 0) | (content[i] != 0))[0]
    cands = cands[cands != i]
    return {"j": cands, "cf": model.sim[i, cands] / max_cf, "cov": covisit[i, cands], "ct": content[i, cands],
            "pop": model.popularity[cands]}


def related_score(p, readers, w):
    conf = readers / ((readers + w["prior"]) or 1)
    return {"co_read": conf * w["cf"] * p["cf"], "next_read": conf * w["cov"] * p["cov"],
            "content": (conf * w["content"] + (1 - conf) * 0.85) * p["ct"], "pop": (w["pop"] + (1 - conf) * 0.15) * p["pop"]}


def total(parts):
    return sum(parts.values())


# ---- evaluation & weight learning ----------------------------------------------------------------------------------

def grid(axes):
    keys = list(axes)
    return [dict(zip(keys, vals)) for vals in itertools.product(*(axes[k] for k in keys))]


def score_ranks(ranks, targets):
    rec = nd = 0.0
    for r, t in zip(ranks, targets):
        a, b = alg.rank_metrics(r, t)
        rec += a
        nd += b
    return {"recall_at_10": round(rec / len(ranks), 3), "ndcg_at_10": round(nd / len(ranks), 3)}


def top_by(values, items, k=10):
    """Items sorted by value desc (stable), first k: enough for @10 metrics."""
    order = np.argsort(-values[items], kind="stable")[:k]
    return items[order]


def evaluate_and_tune(ds, content):
    """Leave-last-out validation: hide each reader's most recent story, train on the rest, then score the personal
    ranking (is the hidden story in their top 10?) and related stories (in the top 10 related of the story read just
    before?). Every single signal is scored and a grid of blend weights is searched; the best NDCG@10 weights win."""
    n_items = len(ds["items"])
    sample = [a for a, o in enumerate(ds["read_order"]) if len(o) >= 3][:EVAL_MAX_ACTORS]
    if len(sample) < 5:
        return None, DEFAULT_USER_WEIGHTS, DEFAULT_RELATED_WEIGHTS
    held = {a: ds["read_order"][a][-1] for a in sample}
    keep = np.array([held.get(a) != i for a, i in zip(ds["ia"], ds["ii"])], dtype=bool)
    model = Model(ds["ia"][keep], ds["ii"][keep], ds["r"][keep], len(ds["actors"]), n_items)
    # the hidden story must not leak through "read next" counts either
    covisit = alg.co_visitation([[e for e in tl if held.get(a) != e[0]] for a, tl in enumerate(ds["timelines"])], n_items)

    comps = [actor_components(model, content, a, set(ds["read_order"][a][:-1]), n_items) for a in sample]
    targets = [held[a] for a in sample]
    single = {name: score_ranks([top_by(c[key] if key != "pop" else c["pop"], c["items"]) for c in comps], targets)
              for name, key in (("als", "als"), ("knn", "knn"), ("content", "ct"), ("popularity", "pop"))}
    user_w, best_u = DEFAULT_USER_WEIGHTS, -1
    for w in grid({"als": [0, 0.2, 0.4], "knn": [0.3, 0.5, 0.8], "content": [0, 0.1, 0.25], "pop": [0, 0.05, 0.15], "prior": [0, 2, 5]}):
        s = score_ranks([[x[0] for x in blend_actor(c, w)[:10]] for c in comps], targets)
        if s["ndcg_at_10"] > best_u:
            best_u, user_w = s["ndcg_at_10"], w
    blended = score_ranks([[x[0] for x in blend_actor(c, user_w)[:10]] for c in comps], targets)

    cases = []
    for a in sample:
        order = ds["read_order"][a]
        prev = order[-2]
        cases.append((related_parts(model, content, covisit, prev), model.readers[prev], order[-1]))
    rel_targets = [c[2] for c in cases]

    def rank_rel(w):
        return [p["j"][np.argsort(-total(related_score(p, readers, w)), kind="stable")[:10]] for p, readers, _ in cases]

    def rank_by(key):
        return [p["j"][np.argsort(-p[key], kind="stable")[:10]] for p, _, _ in cases]

    rel_w, best_r = DEFAULT_RELATED_WEIGHTS, -1
    for w in grid({"cf": [0.2, 0.5, 0.8], "cov": [0, 0.2, 0.5], "content": [0, 0.15, 0.3], "pop": [0, 0.1], "prior": [2, 6]}):
        s = score_ranks(rank_rel(w), rel_targets)
        if s["ndcg_at_10"] > best_r:
            best_r, rel_w = s["ndcg_at_10"], w
    metrics = {
        "evaluated_readers": len(sample), "k": 10,
        "home": {"blend": blended, **single, "weights": user_w},
        "related": {
            "blend": score_ranks(rank_rel(rel_w), rel_targets),
            "co_read_only": score_ranks(rank_rel({"cf": 1, "cov": 0, "content": 0, "pop": 0, "prior": 0}), rel_targets),
            "next_read_only": score_ranks(rank_rel({"cf": 0, "cov": 1, "content": 0, "pop": 0, "prior": 0}), rel_targets),
            "content_only": score_ranks(rank_by("ct"), rel_targets),
            "popularity": score_ranks(rank_by("pop"), rel_targets),
            "weights": rel_w,
        },
    }
    return metrics, user_w, rel_w


# ---- outputs -------------------------------------------------------------------------------------------------------

def related_rows(ds, model, content, covisit, w):
    rows = []
    items = ds["items"]
    for i, story in enumerate(items):
        readers = model.readers[i]
        p = related_parts(model, content, covisit, i)
        scores = total(related_score(p, readers, w))
        out = []
        for k, j in enumerate(p["j"]):
            score = float(scores[k])
            if score <= 0.005:
                continue
            other = items[j]
            same_author = bool(story["author"] and other["author"] and story["author"].strip().lower() == other["author"].strip().lower())
            # ranking uses the learned weights; the label states the strongest evidence
            co = int(model.co[i, j])
            pct = co / readers if readers else 0.0
            cov, ct = float(p["cov"][k]), float(p["ct"][k])
            reason = ("co_read" if pct >= 0.1 and co >= 2 else "next_read" if cov >= 0.3 else "same_author" if same_author
                      else "co_read" if co > 0 else "content")
            other_tags = {t["slug"] for t in other["tags"]}
            shared = next((t["name"] for t in story["tags"] if t["slug"] in other_tags), None)
            out.append((score, [story["id"], other["id"], score, co, pct, cov, ct, reason, shared]))
        out.sort(key=lambda x: -x[0])
        rows.extend(r for _, r in out[:RELATED_PER_STORY])
    return rows


def user_rows(ds, model, content, w):
    rows = []
    n_items = len(ds["items"])
    X = model.X
    norms = np.linalg.norm(X, axis=1)
    norms[norms == 0] = 1
    for a, actor in enumerate(ds["actors"]):
        if not actor.startswith("u:"):
            continue
        top = diversify(blend_actor(actor_components(model, content, a, ds["read_sets"][a], n_items), w), content, RECS_PER_USER)
        # nearest readers by taste vector, to say "x% of readers like you read it"
        sims = (X @ X[a]) / (norms * norms[a])
        sims[a] = -1
        neighbours = np.argsort(-sims, kind="stable")[:20]
        tag_weight = {}
        for i, v in model.by_actor[a]:
            for t in ds["items"][i]["tags"]:
                tag_weight[t["name"]] = tag_weight.get(t["name"], 0) + v
        for item, score, _, source in top:
            pct = sum(1 for b in neighbours if item in ds["read_sets"][b]) / max(1, len(neighbours))
            source_id = ds["items"][source]["id"] if source is not None else None
            tags = sorted((t["name"] for t in ds["items"][item]["tags"] if tag_weight.get(t["name"])), key=lambda n: -tag_weight[n])
            tag = tags[0] if tags else None
            reason = "similar_users" if pct >= 0.3 else "because_read" if source_id else "taste" if tag else "popular"
            rows.append([actor[2:], ds["items"][item]["id"], score, reason, source_id if reason == "because_read" else None,
                         tag if reason == "taste" else None, pct if reason == "similar_users" else None])
    return rows


def write_results(conn, related, recs, user_factors, item_factors):
    with conn.transaction():
        conn.execute("DELETE FROM rec_item_similar")
        with conn.cursor().copy("COPY rec_item_similar (story_id, similar_id, score, co_readers, pct_readers, covisit, content, reason, reason_tag) FROM STDIN") as cp:
            for r in related:
                cp.write_row(r)
        conn.execute("DELETE FROM rec_user_scores")
        with conn.cursor().copy("COPY rec_user_scores (user_id, story_id, score, reason, reason_story_id, reason_tag, pct) FROM STDIN") as cp:
            for r in recs:
                cp.write_row(r)
        conn.execute("DELETE FROM rec_user_factors")
        with conn.cursor().copy("COPY rec_user_factors (user_id, factors) FROM STDIN") as cp:
            for r in user_factors:
                cp.write_row(r)
        conn.execute("DELETE FROM rec_item_factors")
        with conn.cursor().copy("COPY rec_item_factors (story_id, factors, popularity) FROM STDIN") as cp:
            for r in item_factors:
                cp.write_row(r)


# ---- entry point ---------------------------------------------------------------------------------------------------

def train(conn):
    """One training run. Returns the result dict, or {"skipped": True} when another run holds the lock."""
    if not conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (LOCK_KEY,)).fetchone()["ok"]:
        return {"skipped": True}
    started = time.time()
    run_id = conn.execute("INSERT INTO rec_model_runs (status) VALUES ('running') RETURNING id").fetchone()["id"]
    try:
        ds = load_dataset(conn)
        n_items = len(ds["items"])
        content = alg.content_similarity(ds["docs"]) if n_items else np.zeros((0, 0))
        metrics, user_w, rel_w = evaluate_and_tune(ds, content)
        model = Model(ds["ia"], ds["ii"], ds["r"], len(ds["actors"]), n_items)
        covisit = alg.co_visitation(ds["timelines"], n_items)
        related = related_rows(ds, model, content, covisit, rel_w)
        recs = user_rows(ds, model, content, user_w)
        user_factors = [(a[2:], model.X[i].tolist()) for i, a in enumerate(ds["actors"]) if a.startswith("u:")]
        item_factors = [(s["id"], model.Y[i].tolist(), float(model.popularity[i])) for i, s in enumerate(ds["items"])]
        # CTR of the recommendation rows over the last week, to watch the effect of changes
        ctr = {r["source"]: {**r, "ctr": round(r["clicks"] / r["impressions"], 3) if r["impressions"] else 0}
               for r in conn.execute("""SELECT source, count(*) FILTER (WHERE kind = 'impression')::int AS impressions,
                   count(*) FILTER (WHERE kind = 'click')::int AS clicks FROM events
                   WHERE kind IN ('impression', 'click') AND created_at > NOW() - INTERVAL '7 days' GROUP BY source""")}
        write_results(conn, related, recs, user_factors, item_factors)
        duration = int((time.time() - started) * 1000)
        result = {"run_id": run_id, "duration_ms": duration, "users": len(ds["actors"]), "stories": n_items,
                  "interactions": len(ds["r"]),
                  "metrics": {**({"offline": metrics} if metrics else {}), "ctr_7d": ctr, "related_pairs": len(related), "user_recs": len(recs)}}
        conn.execute("""UPDATE rec_model_runs SET status = 'ok', duration_ms = %s, users = %s, stories = %s, interactions = %s,
            metrics = %s WHERE id = %s""", (duration, result["users"], n_items, result["interactions"], json.dumps(result["metrics"]), run_id))
        return result
    except Exception as e:
        conn.execute("UPDATE rec_model_runs SET status = 'error', error = %s, duration_ms = %s WHERE id = %s",
                     (repr(e)[:2000], int((time.time() - started) * 1000), run_id))
        raise
    finally:
        conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))


def main(cfg):
    from .common import connect
    with connect(cfg.database_url) as conn:
        r = train(conn)
    if r.get("skipped"):
        log("info", "another training run is in progress, skipped")
    else:
        log("info", f"trained in {r['duration_ms']} ms: {r['users']} readers, {r['stories']} stories, {r['interactions']} interactions",
            run_id=r["run_id"], at=datetime.now(timezone.utc).isoformat())
    print(json.dumps(r, default=str))  # the last stdout line: read by the API's "train now"
