/**
 * Roblox Marketplace Data Collector
 *
 * ⚠️  Run this on BisectHosting (or any non-shared IP), NOT on Replit.
 *     Roblox blocks requests from Replit's shared IPs.
 *
 * Uses only public Roblox APIs (no account / auth required):
 *   - catalog.roblox.com/v1/search/items  → id, name, price, creator, counts
 *   - api.roblox.com/marketplace/productinfo?assetId=N  → description
 *
 * Usage (run from the repo root on BisectHosting):
 *   node tools/collect-roblox-marketplace.mjs
 *   node tools/collect-roblox-marketplace.mjs --limit 5000 --out data/marketplace.jsonl
 *   node tools/collect-roblox-marketplace.mjs --no-desc   # skip descriptions, faster
 *
 * Flags:
 *   --limit        N     Total items to collect (default 3000)
 *   --out          PATH  Output file (default data/roblox-marketplace.jsonl)
 *   --search-delay MS    Delay between search pages in ms (default 500)
 *   --desc-delay   MS    Delay between description fetches in ms (default 250)
 *   --no-desc            Skip description fetching (faster, still gets name/URL/price)
 */

import fs   from "node:fs";
import path from "node:path";

// ─── CLI args ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const argVal  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);

const LIMIT        = parseInt(argVal("--limit")        ?? "3000", 10);
const OUT          = argVal("--out")                   ?? "data/roblox-marketplace.jsonl";
const SEARCH_DELAY = parseInt(argVal("--search-delay") ?? "500",  10);
const DESC_DELAY   = parseInt(argVal("--desc-delay")   ?? "250",  10);
const SKIP_DESC    = hasFlag("--no-desc");

// ─── Endpoints ───────────────────────────────────────────────────────────────
const SEARCH_URL  = "https://catalog.roblox.com/v1/search/items";
const DESC_URL    = (id) => `https://api.roblox.com/marketplace/productinfo?assetId=${id}`;

// Roblox catalog accepts only these limit values
const VALID_SIZES = [10, 28, 30, 60, 120];
const PAGE_SIZE   = 30;

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
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 20000);
        await sleep(wait);
        continue;
      }
      throw err;
    }

    if (res.status === 429) {
      const wait = Math.min(2000 * 2 ** attempt, 60000);
      process.stdout.write(`\n  [429] Rate-limited — waiting ${(wait / 1000).toFixed(1)}s…`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

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

// ─── Step 1: Collect stubs from catalog search ─────────────────────────────
async function collectStubs(limit) {
  const stubs  = [];
  let cursor   = "";
  let page     = 0;
  const seen   = new Set();

  while (stubs.length < limit) {
    const ideal     = Math.min(PAGE_SIZE, limit - stubs.length);
    const batchSize = VALID_SIZES.find((s) => s >= ideal) ?? 120;

    const params = new URLSearchParams({
      category: "All",
      limit:    String(batchSize),
      sortType: "3",               // 3 = RecentlyUpdated — broad coverage
      ...(cursor ? { cursor } : {}),
    });

    let data;
    try {
      data = await fetchJson(`${SEARCH_URL}?${params}`);
    } catch (err) {
      console.error(`\n  [page ${page}] Search error: ${err.message}`);
      break;
    }

    const items = data.data ?? [];
    if (items.length === 0) { console.log("\n  Catalog exhausted."); break; }

    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        stubs.push(item);
      }
    }

    cursor = data.nextPageCursor ?? "";
    page++;

    const pct = Math.min(100, Math.round((stubs.length / limit) * 100));
    process.stdout.write(`\r  Browsing… ${stubs.length.toLocaleString()} stubs (${pct}%)   `);

    if (!cursor) { console.log("\n  Reached last catalog page."); break; }
    await sleep(SEARCH_DELAY);
  }

  console.log();
  return stubs.slice(0, limit);
}

// ─── Step 2: Fetch descriptions individually from public productinfo API ───
async function fetchDescription(id) {
  try {
    const data = await fetchJson(DESC_URL(id));
    return data.Description ?? "";
  } catch {
    return ""; // non-fatal — skip description for this item
  }
}

// ─── Step 3: Build final records ───────────────────────────────────────────
async function buildRecords(stubs) {
  const records = [];

  for (let i = 0; i < stubs.length; i++) {
    const s = stubs[i];

    let description = "";
    if (!SKIP_DESC && s.itemType !== 2 /* bundles lack productinfo */) {
      description = await fetchDescription(s.id);
      await sleep(DESC_DELAY);
    }

    const slug = slugify(s.name);
    records.push({
      id:            s.id,
      name:          s.name          ?? "",
      description,
      item_type:     s.itemType === 2 ? "Bundle" : "Asset",
      url:           `https://www.roblox.com/catalog/${s.id}/${slug}`,
      creator_name:  s.creatorName   ?? "",
      creator_type:  s.creatorType   ?? "",
      price_robux:   s.price         ?? null,
      lowest_price:  s.lowestPrice   ?? null,
      favorite_count: s.favoriteCount ?? 0,
      purchase_count: s.purchaseCount ?? 0,
    });

    const pct = Math.round(((i + 1) / stubs.length) * 100);
    process.stdout.write(`\r  Building records… ${(i + 1).toLocaleString()} / ${stubs.length.toLocaleString()} (${pct}%)   `);
  }

  console.log();
  return records;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nRoblox Marketplace Collector`);
  console.log(`  Target : ${LIMIT.toLocaleString()} items`);
  console.log(`  Output : ${OUT}`);
  console.log(`  Descriptions : ${SKIP_DESC ? "skipped (--no-desc)" : "enabled"}\n`);

  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });

  console.log("Step 1 — Browsing catalog…");
  const stubs = await collectStubs(LIMIT);
  console.log(`  ${stubs.length.toLocaleString()} stubs collected.\n`);

  console.log("Step 2 — Building records" + (SKIP_DESC ? " (no descriptions)…" : " + fetching descriptions…"));
  const records = await buildRecords(stubs);
  console.log(`  ${records.length.toLocaleString()} records ready.\n`);

  console.log(`Step 3 — Writing JSONL…`);
  const stream = fs.createWriteStream(OUT, { encoding: "utf8" });
  for (const r of records) stream.write(JSON.stringify(r) + "\n");
  await new Promise((ok, fail) => { stream.end(ok); stream.on("error", fail); });

  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ ${records.length.toLocaleString()} records → ${OUT} (${mb} MB)\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
