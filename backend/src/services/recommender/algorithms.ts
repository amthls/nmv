/**
 * Recommendation algorithms, all in-process and dependency free (the catalogue is small:
 * hundreds of stories, thousands of readers, so dense k x k solves are cheap).
 *
 *  - Implicit-feedback matrix factorization (ALS, Hu, Koren & Volinsky 2008)
 *  - Item-based collaborative filtering (cosine with shrinkage)
 *  - Co-visitation: which story people open right after another (YouTube "up next", Davidson 2010)
 *  - Content similarity: TF-IDF over tags, type, author, group and synopsis words
 */

export interface Interaction {
  actor: number; // index into actors
  item: number; // index into items
  r: number; // preference strength (> 0)
}

// ------------------------------------------------------------------ linear algebra

/** Solves A x = b for a symmetric positive definite A (n x n, row major) by Cholesky. */
function solveSPD(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(sum, 1e-9));
      else L[i * n + j] = sum / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
    y[i] = sum / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
    x[i] = sum / L[i * n + i];
  }
  return x;
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Small deterministic PRNG so training is reproducible run to run. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ ALS

export interface AlsModel {
  k: number;
  X: Float64Array[]; // actor factors
  Y: Float64Array[]; // item factors
}

/**
 * Implicit ALS: minimise sum c_ui (p_ui - x_u.y_i)^2 + lambda(|x|^2 + |y|^2) with p = 1 for
 * observed pairs and confidence c = 1 + alpha * r. Unobserved pairs count as p = 0, c = 1.
 */
export function trainAls(
  data: Interaction[], nActors: number, nItems: number,
  { k = 16, lambda = 0.1, alpha = 8, iterations = 12, seed = 42 } = {},
): AlsModel {
  const rand = rng(seed);
  const init = () => Float64Array.from({ length: k }, () => (rand() - 0.5) * 0.1);
  const X = Array.from({ length: nActors }, init);
  const Y = Array.from({ length: nItems }, init);

  const byActor: Interaction[][] = Array.from({ length: nActors }, () => []);
  const byItem: Interaction[][] = Array.from({ length: nItems }, () => []);
  for (const d of data) { byActor[d.actor].push(d); byItem[d.item].push(d); }

  const step = (fixed: Float64Array[], solveFor: Float64Array[], groups: Interaction[][], other: (d: Interaction) => number) => {
    // Gram matrix of the fixed side, shared by every row
    const G = new Float64Array(k * k);
    for (const v of fixed) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) G[a * k + b] += v[a] * v[b];
    for (let row = 0; row < solveFor.length; row++) {
      const list = groups[row];
      if (list.length === 0) { solveFor[row] = new Float64Array(k); continue; }
      const A = Float64Array.from(G);
      const rhs = new Float64Array(k);
      for (const d of list) {
        const v = fixed[other(d)];
        const c = 1 + alpha * d.r;
        for (let a = 0; a < k; a++) {
          rhs[a] += c * v[a];
          for (let b = 0; b < k; b++) A[a * k + b] += (c - 1) * v[a] * v[b];
        }
      }
      for (let a = 0; a < k; a++) A[a * k + a] += lambda * list.length;
      solveFor[row] = solveSPD(A, rhs, k);
    }
  };

  for (let it = 0; it < iterations; it++) {
    step(Y, X, byActor, (d) => d.item);
    step(X, Y, byItem, (d) => d.actor);
  }
  return { k, X, Y };
}

// ------------------------------------------------------------------ item-based CF

export interface ItemSim {
  sim: Map<number, number>[]; // item -> (other item -> cosine with shrinkage)
  co: Map<number, number>[]; // item -> (other item -> number of actors with both)
  readers: number[]; // actors per item
}

/** Cosine between item columns, damped by co/(co + shrink) so two shared readers don't make a 1.0. */
export function itemCosine(data: Interaction[], nActors: number, nItems: number, shrink = 4): ItemSim {
  const byActor: Interaction[][] = Array.from({ length: nActors }, () => []);
  const norm = new Float64Array(nItems);
  const readers = new Array(nItems).fill(0);
  for (const d of data) {
    byActor[d.actor].push(d);
    norm[d.item] += d.r * d.r;
    readers[d.item] += 1;
  }
  const dots: Map<number, number>[] = Array.from({ length: nItems }, () => new Map());
  const co: Map<number, number>[] = Array.from({ length: nItems }, () => new Map());
  for (const list of byActor) {
    for (let a = 0; a < list.length; a++) {
      for (let b = 0; b < list.length; b++) {
        if (a === b) continue;
        const i = list[a].item, j = list[b].item;
        dots[i].set(j, (dots[i].get(j) || 0) + list[a].r * list[b].r);
        co[i].set(j, (co[i].get(j) || 0) + 1);
      }
    }
  }
  const sim = dots.map((m, i) => {
    const out = new Map<number, number>();
    m.forEach((v, j) => {
      const n = co[i].get(j) || 0;
      out.set(j, (v / (Math.sqrt(norm[i] * norm[j]) || 1)) * (n / (n + shrink)));
    });
    return out;
  });
  return { sim, co, readers };
}

// ------------------------------------------------------------------ co-visitation

/**
 * Counts "story B opened soon after story A" in each actor's timeline (repeat opens of the same
 * story collapsed). The next story counts 1, the one after 0.5. Normalised per A to [0, 1].
 */
export function coVisitation(
  timelines: { item: number; t: number }[][], nItems: number, maxGapMs = 6 * 3600_000,
): Map<number, number>[] {
  const raw: Map<number, number>[] = Array.from({ length: nItems }, () => new Map());
  for (const tl of timelines) {
    const seq: { item: number; t: number }[] = [];
    for (const e of tl) if (!seq.length || seq[seq.length - 1].item !== e.item) seq.push(e);
    for (let a = 0; a < seq.length; a++) {
      for (let step = 1; step <= 2 && a + step < seq.length; step++) {
        const next = seq[a + step];
        if (next.t - seq[a + step - 1].t > maxGapMs) break;
        if (next.item === seq[a].item) continue;
        const m = raw[seq[a].item];
        m.set(next.item, (m.get(next.item) || 0) + (step === 1 ? 1 : 0.5));
      }
    }
  }
  return raw.map((m) => {
    const max = Math.max(0, ...Array.from(m.values()));
    const out = new Map<number, number>();
    if (max > 0) m.forEach((v, j) => out.set(j, v / max));
    return out;
  });
}

// ------------------------------------------------------------------ content

export interface ContentDoc {
  tags: string[];
  type: string;
  author: string | null;
  group: string | null;
  text: string; // synopsis (plain text) + title
}

const STOP = new Set(['của', 'và', 'là', 'những', 'các', 'một', 'được', 'trong', 'cho', 'với', 'không', 'có', 'người', 'này', 'khi', 'đã', 'để', 'thì', 'mà', 'lại', 'cũng', 'như', 'đến', 'từ', 'ra', 'vào', 'nhưng', 'the', 'and', 'of', 'to', 'a', 'in']);

/** Word features: Vietnamese words are mostly two syllables, so syllable bigrams carry the meaning. */
function textFeatures(text: string): string[] {
  const syl = text.toLowerCase().replace(/<[^>]+>/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));
  const out: string[] = [];
  for (let i = 0; i < syl.length; i++) {
    if (syl[i].length > 3) out.push(`w:${syl[i]}`);
    if (i + 1 < syl.length) out.push(`b:${syl[i]}_${syl[i + 1]}`);
  }
  return out;
}

/** Pairwise cosine of TF-IDF vectors; tags and author weigh more than synopsis words. */
export function contentSimilarity(docs: ContentDoc[]): Map<number, number>[] {
  const feats = docs.map((d) => {
    const f = new Map<string, number>();
    const add = (key: string, w: number) => f.set(key, (f.get(key) || 0) + w);
    d.tags.forEach((t) => add(`tag:${t}`, 3));
    add(`type:${d.type}`, 1);
    if (d.author) add(`author:${d.author.toLowerCase().trim()}`, 2.5);
    if (d.group) add(`group:${d.group}`, 0.8);
    textFeatures(d.text).forEach((t) => add(t, 0.35));
    return f;
  });
  const df = new Map<string, number>();
  feats.forEach((f) => f.forEach((_, key) => df.set(key, (df.get(key) || 0) + 1)));
  const N = docs.length;
  const vecs = feats.map((f) => {
    const v = new Map<string, number>();
    let norm = 0;
    f.forEach((tf, key) => {
      const n = df.get(key) || 1;
      if (n < 2 && !key.startsWith('tag:')) return; // a feature only one story has links nothing
      const w = tf * Math.log(1 + N / n);
      v.set(key, w);
      norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    v.forEach((w, key) => v.set(key, w / norm));
    return v;
  });
  // inverted index so we only compare stories sharing at least one feature
  const index = new Map<string, number[]>();
  vecs.forEach((v, i) => v.forEach((_, key) => {
    const list = index.get(key);
    if (list) list.push(i); else index.set(key, [i]);
  }));
  return vecs.map((v, i) => {
    const acc = new Map<number, number>();
    v.forEach((w, key) => {
      for (const j of index.get(key) || []) {
        if (j !== i) acc.set(j, (acc.get(j) || 0) + w * (vecs[j].get(key) || 0));
      }
    });
    // type alone makes everything look a bit similar: keep only meaningful neighbours
    const out = new Map<number, number>();
    acc.forEach((s, j) => { if (s > 0.08) out.set(j, s); });
    return out;
  });
}

// ------------------------------------------------------------------ evaluation

/** Recall@K and NDCG@K for one held-out item. */
export function rankMetrics(ranked: number[], heldOut: number, K = 10) {
  const pos = ranked.slice(0, K).indexOf(heldOut);
  return { recall: pos >= 0 ? 1 : 0, ndcg: pos >= 0 ? 1 / Math.log2(pos + 2) : 0 };
}
