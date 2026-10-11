"""Recommendation algorithms (port of the backend's former algorithms.ts, numpy instead of hand-written loops).

- Implicit-feedback matrix factorization (ALS, Hu, Koren & Volinsky 2008)
- Item-based collaborative filtering (cosine with shrinkage)
- Co-visitation: which story people open right after another (YouTube "up next", Davidson 2010)
- Content similarity: TF-IDF over tags, type, author, group and synopsis words

Interactions are three parallel arrays: actor index, item index, preference r > 0.
"""
import math
import re

import numpy as np


# ---- ALS ---------------------------------------------------------------------------------------------------------

def train_als(actors, items, r, n_actors, n_items, k=16, lam=0.1, alpha=8.0, iterations=12, seed=42):
    """Implicit ALS: minimise sum c_ui (p_ui - x_u.y_i)^2 + lambda(|x|^2 + |y|^2), p = 1 for observed pairs,
    confidence c = 1 + alpha * r; unobserved pairs count as p = 0, c = 1. Returns (X actors x k, Y items x k)."""
    rnd = np.random.default_rng(seed)
    X = (rnd.random((n_actors, k)) - 0.5) * 0.1
    Y = (rnd.random((n_items, k)) - 0.5) * 0.1
    by_actor = _groups(actors, n_actors)
    by_item = _groups(items, n_items)
    conf = 1 + alpha * np.asarray(r, dtype=float)

    def step(fixed, solve_for, groups, other):
        G = fixed.T @ fixed  # Gram matrix of the fixed side, shared by every row
        for row, idx in enumerate(groups):
            if len(idx) == 0:
                solve_for[row] = 0
                continue
            V = fixed[other[idx]]
            c = conf[idx]
            A = G + (V.T * (c - 1)) @ V + lam * len(idx) * np.eye(k)
            solve_for[row] = np.linalg.solve(A, V.T @ c)

    actors, items = np.asarray(actors), np.asarray(items)
    for _ in range(iterations):
        step(Y, X, by_actor, items)
        step(X, Y, by_item, actors)
    return X, Y


def _groups(index, n):
    out = [[] for _ in range(n)]
    for pos, v in enumerate(index):
        out[v].append(pos)
    return [np.asarray(g, dtype=int) for g in out]


# ---- item-based CF -------------------------------------------------------------------------------------------------

def item_cosine(actors, items, r, n_actors, n_items, shrink=4.0):
    """Cosine between item columns, damped by co/(co + shrink) so two shared readers don't make a 1.0.
    Returns (sim dense items x items with 0 diagonal, co counts, readers per item)."""
    M = np.zeros((n_actors, n_items))
    M[actors, items] = r
    B = (M > 0).astype(float)
    dots = M.T @ M
    co = B.T @ B
    norm = np.sqrt(np.diag(dots))
    denom = np.outer(norm, norm)
    denom[denom == 0] = 1
    sim = dots / denom * (co / (co + shrink))
    np.fill_diagonal(sim, 0)
    np.fill_diagonal(co, 0)
    return sim, co, B.sum(axis=0)


# ---- co-visitation -------------------------------------------------------------------------------------------------

def co_visitation(timelines, n_items, max_gap_s=6 * 3600):
    """Counts "story B opened soon after story A" in each actor's timeline [(item, t seconds)] sorted by t (repeat opens
    of the same story collapsed). The next story counts 1, the one after 0.5. Normalised per A to [0, 1]."""
    raw = np.zeros((n_items, n_items))
    for tl in timelines:
        seq = []
        for item, t in tl:
            if not seq or seq[-1][0] != item:
                seq.append((item, t))
        for a in range(len(seq)):
            for step in (1, 2):
                if a + step >= len(seq):
                    break
                nxt = seq[a + step]
                if nxt[1] - seq[a + step - 1][1] > max_gap_s:
                    break
                if nxt[0] == seq[a][0]:
                    continue
                raw[seq[a][0], nxt[0]] += 1 if step == 1 else 0.5
    mx = raw.max(axis=1, keepdims=True)
    mx[mx == 0] = 1
    return raw / mx


# ---- content -------------------------------------------------------------------------------------------------------

STOP = set("của và là những các một được trong cho với không có người này khi đã để thì mà lại cũng như đến từ ra vào nhưng the and of to a in".split())
_SPLIT = re.compile(r"[^\w]+|_", re.UNICODE)
_TAGS = re.compile(r"<[^>]+>")


def text_features(text):
    """Vietnamese words are mostly two syllables, so syllable bigrams carry the meaning."""
    syl = [w for w in _SPLIT.split(_TAGS.sub(" ", text.lower())) if len(w) > 1 and w not in STOP]
    out = []
    for i, w in enumerate(syl):
        if len(w) > 3:
            out.append(f"w:{w}")
        if i + 1 < len(syl):
            out.append(f"b:{w}_{syl[i + 1]}")
    return out


def content_similarity(docs):
    """Pairwise cosine of TF-IDF vectors (docs: dicts tags, type, author, group, text); tags and author weigh more than
    synopsis words. Returns a dense items x items matrix with only values > 0.08 kept."""
    feats = []
    for d in docs:
        f = {}

        def add(key, w):
            f[key] = f.get(key, 0) + w
        for t in d["tags"]:
            add(f"tag:{t}", 3)
        add(f"type:{d['type']}", 1)
        if d.get("author"):
            add(f"author:{d['author'].lower().strip()}", 2.5)
        if d.get("group"):
            add(f"group:{d['group']}", 0.8)
        for t in text_features(d["text"]):
            add(t, 0.35)
        feats.append(f)
    df = {}
    for f in feats:
        for key in f:
            df[key] = df.get(key, 0) + 1
    n = len(docs)
    keys = {}
    rows, cols, vals = [], [], []
    for i, f in enumerate(feats):
        for key, tf in f.items():
            if df[key] < 2 and not key.startswith("tag:"):
                continue  # a feature only one story has links nothing
            rows.append(i)
            cols.append(keys.setdefault(key, len(keys)))
            vals.append(tf * math.log(1 + n / df[key]))
    V = np.zeros((n, max(1, len(keys))))
    V[rows, cols] = vals
    norm = np.linalg.norm(V, axis=1, keepdims=True)
    norm[norm == 0] = 1
    V /= norm
    S = V @ V.T
    np.fill_diagonal(S, 0)
    S[S <= 0.08] = 0  # type alone makes everything look a bit similar: keep only meaningful neighbours
    return S


# ---- evaluation ----------------------------------------------------------------------------------------------------

def rank_metrics(ranked, held_out, k=10):
    """Recall@K and NDCG@K for one held-out item."""
    top = list(ranked[:k])
    if held_out in top:
        return 1.0, 1 / math.log2(top.index(held_out) + 2)
    return 0.0, 0.0
