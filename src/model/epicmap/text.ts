// Bag-of-words vectors for comparing items: tokens from the title, body and labels, weighted
// by TF-IDF so words every item shares ("build", "type: story") count for little. Pure.

/** Sparse vector, L2-normalised: term -> weight. */
export type Vec = Map<string, number>;

const STOP = new Set((
  "the and for with from into onto that this these those are was were been being has have had not but you your our its " +
  "can will should would could may might must all any each per via who what when where which while than then there here " +
  "also only just more most some such very out off over under about after before again once both few own same too new use " +
  "used using make made get set add adds added covers part need needed needs work item items issue issues task tasks story " +
  "stories epic epics todo done etc see like one two three"
).split(" "));

/** Light suffix stripping so "notifications" and "notification" meet. Not a real stemmer, on purpose. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Words to stems. `surface` collects a readable spelling for each stem, for explanations. */
export function tokenize(text: string, surface?: Map<string, string>): string[] {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " ").split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(w => { const s = stem(w); if (surface && (!surface.has(s) || w.length < surface.get(s)!.length)) surface.set(s, w); return s; });
}

// Verbs that start half of all ticket titles. They say what kind of step it is, not what it is
// about, so they don't make two tasks related (categories still see them).
const GENERIC = new Set(["build", "wire", "implement", "create", "update", "improve", "support", "handle", "test", "document",
  "design", "migrate", "instrument", "harden", "refactor", "cleanup", "fix", "investigate", "explore", "review", "setup", "write"].map(stem));
/** Labels that say what kind of item it is ("type: story", "epic"), not what it is about. */
const KIND_LABEL = /^(type|kind)\s*:|^(epic|story|task|feature|bug|enhancement)$/i;

/** Term counts for one document. Label terms are prefixed so they never collide with words. */
export function terms(title: string, body: string | undefined, labels: string[], surface?: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (t: string, w: number) => { if (!GENERIC.has(t)) out.set(t, (out.get(t) ?? 0) + w); };
  // The title says what the item is; the body mostly elaborates, so it counts for less per word.
  for (const t of tokenize(title, surface)) add(t, 2);
  for (const t of tokenize(body ?? "", surface)) add(t, 1);
  for (const l of labels) if (!KIND_LABEL.test(l)) add(`label:${l.toLowerCase()}`, 2);
  return out;
}

/** TF-IDF over a set of documents. Terms in a single document carry no comparison signal and are dropped. */
export function tfidf(docs: Map<string, number>[]): Vec[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return docs.map(d => {
    const v: Vec = new Map();
    for (const [t, tf] of d) {
      const f = df.get(t)!;
      if (f < 2) continue;
      const w = (1 + Math.log(tf)) * Math.log((n + 1) / f);
      if (w > 0) v.set(t, w);
    }
    return normalize(v);
  });
}

export function normalize(v: Vec): Vec {
  let s = 0;
  for (const w of v.values()) s += w * w;
  if (s === 0) return v;
  const k = 1 / Math.sqrt(s);
  const out: Vec = new Map();
  for (const [t, w] of v) out.set(t, w * k);
  return out;
}

export function cosine(a: Vec, b: Vec): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) { const x = big.get(t); if (x) s += w * x; }
  return s;
}

/** Normalised sum of vectors, each multiplied by its weight. */
export function centroid(vs: { v: Vec; w: number }[]): Vec {
  const out: Vec = new Map();
  for (const { v, w } of vs) for (const [t, x] of v) out.set(t, (out.get(t) ?? 0) + x * w);
  return normalize(out);
}

/** Terms two vectors share most, in readable words. Labels read "label <name>". */
export function sharedTerms(a: Vec, b: Vec, n: number, surface?: Map<string, string>): string[] {
  const both: [string, number][] = [];
  for (const [t, w] of a) { const x = b.get(t); if (x) both.push([t, Math.min(w, x)]); }
  return both.sort((p, q) => q[1] - p[1]).slice(0, n).map(([t]) => t.startsWith("label:") ? `label ${t.slice(6)}` : surface?.get(t) ?? t);
}

/**
 * A dense vector as a sparse one, so the same maths (cosine, centroid, sum) works for
 * both kinds of vector. The coordinates become the terms.
 */
export function denseToVec(v: number[]): Vec {
  const out: Vec = new Map();
  v.forEach((w, i) => { if (w) out.set(String(i), w); });
  return out;
}

/** A dense vector scaled to unit length, so a dot product is a cosine. */
export function denseNormalize(v: number[]): number[] {
  let s = 0;
  for (const w of v) s += w * w;
  if (!s) return v;
  const k = 1 / Math.sqrt(s);
  return v.map(w => w * k);
}

/** Cosine of two dense vectors. */
export function denseCosine(a: number[], b: number[]): number {
  let s = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const x = a[i]!, y = b[i]!; s += x * y; na += x * x; nb += y * y; }
  return na > 0 && nb > 0 ? s / Math.sqrt(na * nb) : 0;
}

/** A short, stable hash of some text, used as a cache key. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2, 33) ^ c;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Embedding cosines sit in a narrower, higher band than TF-IDF ones: unrelated text is
 * often 0.2 and related text 0.7, where TF-IDF runs 0 to 0.5. Stretching the band keeps
 * one set of thresholds meaningful for both kinds of vector.
 */
export function denseScore(c: number): number {
  return Math.max(0, Math.min(1, (c - 0.2) / 0.6));
}
