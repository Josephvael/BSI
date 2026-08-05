/**
 * Roblox Marketplace Data Collector
 *
 * ⚠️  Run this on BisectHosting (or any non-shared IP), NOT on Replit.
 *     Roblox blocks requests from Replit's shared IPs.
 *
 * Collects: Item ID, Name, Link  (one JSON record per line — JSONL)
 *
 * Uses the public Roblox Catalog API (no account / auth required):
 *   catalog.roblox.com/v1/search/items
 *
 * Usage (run from the repo root on BisectHosting):
 *   node tools/collect-roblox-marketplace.mjs
 *   node tools/collect-roblox-marketplace.mjs --limit 10000 --out data/marketplace.jsonl
 *   node tools/collect-roblox-marketplace.mjs --sort bestselling
 *
 * Flags:
 *   --limit  N     Total items to collect (default 3000)
 *   --out    PATH  Output file          (default data/roblox-marketplace.jsonl)
 *   --delay  MS    Delay between pages in ms (default 500)
 *   --sort   MODE  Sort order (default: popular)
 *
 * Sort modes:
 *   popular      — Most favorited first  [default]
 *   bestselling  — Highest sales count first
 *   recent       — Most recently updated
 *   new          — Most recently created
 *   relevant     — Roblox relevance ranking
 */

import fs   from "node:fs";
import path from "node:path";

// ─── CLI args ────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const LIMIT = parseInt(argVal("--limit") ?? "3000", 10);
const OUT   = argVal("--out")   ?? "data/roblox-marketplace.jsonl";
const DELAY = parseInt(argVal("--delay") ?? "500", 10);
const SORT  = (argVal("--sort") ?? "popular").toLowerCase();

// Roblox sortType values
const SORT_TYPES = {
  relevant:    "0",
  popular:     "1",  // Most favorited
  bestselling: "2",
  recent:      "3",  // Recently updated
  new:         "4",  // Recently created
};

const sortType = SORT_TYPES[SORT];
if (!sortType) {
  console.error(`Unknown --sort value "${SORT}". Valid options: ${Object.keys(SORT_TYPES).join(", ")}`);
  process.exit(1);
}

// Roblox catalog accepts only these limit values per page
const VALID_PAGE_SIZES = [10, 28, 30, 60, 120];
const PAGE_SIZE = 120; // aim for max

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}, retries = 6) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "RobloxMarketplaceCollector/1.0 (educational data collection)" },
        ...options,
      });
    } catch (err) {
      if (attempt < retries) { await sleep(Math.min(1000 * 2 ** attempt, 20000)); continue; }
      throw err;
    }

    if (res.status === 429) {
      const wait = Math.min(2000 * 2 ** attempt, 60000);
      process.stdout.write(`\n  [429] Rate-limited — waiting ${(wait / 1000).toFixed(1)}s…`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }
  throw new Error(`Failed after ${retries} retries — ${url}`);
}

function slugify(name) {
  return (name ?? "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const SEARCH_URL = "https://catalog.roblox.com/v1/search/items";

  console.log(`\nRoblox Marketplace Collector`);
  console.log(`  Target : ${LIMIT.toLocaleString()} items`);
  console.log(`  Sort   : ${SORT} (sortType=${sortType})`);
  console.log(`  Output : ${OUT}\n`);

  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });

  const stream = fs.createWriteStream(OUT, { encoding: "utf8" });
  const seen   = new Set();
  let cursor   = "";
  let page     = 0;
  let written  = 0;

  while (written < LIMIT) {
    const ideal     = Math.min(PAGE_SIZE, LIMIT - written);
    const batchSize = VALID_PAGE_SIZES.find((s) => s >= ideal) ?? 120;

    const params = new URLSearchParams({
      category: "All",
      limit:    String(batchSize),
      sortType,
      ...(cursor ? { cursor } : {}),
    });

    let data;
    try {
      data = await fetchJson(`${SEARCH_URL}?${params}`);
    } catch (err) {
      console.error(`\n  [page ${page}] Search error: ${err.message} — stopping.`);
      break;
    }

    const items = data.data ?? [];
    if (items.length === 0) { console.log("\n  Catalog exhausted."); break; }

    for (const item of items) {
      if (seen.has(item.id) || written >= LIMIT) continue;
      seen.add(item.id);

      const name = item.name ?? "";
      const slug = slugify(name);
      const record = {
        id:   item.id,
        name,
        link: `https://www.roblox.com/catalog/${item.id}/${slug}`,
      };

      stream.write(JSON.stringify(record) + "\n");
      written++;
    }

    cursor = data.nextPageCursor ?? "";
    page++;

    const pct = Math.min(100, Math.round((written / LIMIT) * 100));
    process.stdout.write(`\r  Collecting… ${written.toLocaleString()} / ${LIMIT.toLocaleString()} (${pct}%)   `);

    if (!cursor) { console.log("\n  Reached last catalog page."); break; }
    await sleep(DELAY);
  }

  await new Promise((ok, fail) => { stream.end(ok); stream.on("error", fail); });

  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ ${written.toLocaleString()} records → ${OUT} (${mb} MB)\n`);
  console.log(`  Each record: { id, name, link }\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
