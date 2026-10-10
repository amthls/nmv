// Latency baseline: hit the main reader paths through the gateway and print p50/p95/max per path.
//   node scripts/bench.mjs [base=http://localhost:3000] [requests=100]
// Run before and after each migration stage (Plan/microservices.md) and compare.
// Paced at ~15 req/s so one client stays under the gateway's per-IP limits (this measures latency, not
// capacity). Uses one story/chapter from the public API, so it needs a seeded database. Read-only.
const [base = 'http://localhost:3000', total = '100'] = process.argv.slice(2);
const N = Number(total);
const headers = { 'User-Agent': 'nmv-bench' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const json = async (p) => (await fetch(base + p, { headers })).json();
const story = (await json('/api/v1/stories/trending')).data?.[0];
if (!story) throw new Error('no trending story: seed the database first');
const detail = (await json(`/api/v1/stories/${story.slug}`)).data;
const chapter = detail?.first_chapter;

const paths = [
  '/api/v1/stories/trending',
  `/api/v1/stories/${story.slug}`,
  `/truyen/${story.slug}`,
  chapter && `/api/v1/stories/${story.slug}/chapters/${chapter.slug}`,
  chapter && `/truyen/${story.slug}/${chapter.slug}`,
].filter(Boolean);

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];
for (const path of paths) {
  const times = [];
  let errors = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    const r = await fetch(base + path, { headers }).catch(() => null);
    if (!r || r.status >= 400) errors++;
    await r?.arrayBuffer();
    const ms = performance.now() - t;
    times.push(ms);
    await wait(Math.max(0, 66 - ms));
  }
  times.sort((a, b) => a - b);
  console.log(`${path.padEnd(60)} p50 ${pct(times, 50).toFixed(0).padStart(5)} ms  p95 ${pct(times, 95).toFixed(0).padStart(5)} ms  max ${times.at(-1).toFixed(0).padStart(5)} ms  errors ${errors}/${N}`);
  await wait(5000); // let the per-IP burst bucket refill before the next path
}
