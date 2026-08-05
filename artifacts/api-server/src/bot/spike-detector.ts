/**
 * In-memory rolling-window spike detector for filing items.
 *
 * After each successful filing, call `recordAndDetect()` with the seized items.
 * It returns any items that have crossed the spike threshold within the rolling
 * window and haven't already triggered an alert within the cooldown period.
 *
 * Call `seedWindow()` once at startup (from bot ready handler) to replay recent
 * filing history into the window so spikes survive bot restarts.
 *
 * Configurable via environment variables:
 *   SPIKE_THRESHOLD     — filings of the same item before it's a spike (default: 3)
 *   SPIKE_WINDOW_HOURS  — rolling window size in hours (default: 1)
 *   SPIKE_COOLDOWN_HOURS — minimum hours between alerts for the same item (default: 2)
 */
import { logger } from "../lib/logger";

export interface SpikeResult {
  itemName: string;
  /** Number of times the item appeared in the window (at the moment of detection). */
  count: number;
  windowHours: number;
}

const SPIKE_THRESHOLD    = Number(process.env.SPIKE_THRESHOLD     ?? 3);
const SPIKE_WINDOW_MS    = Number(process.env.SPIKE_WINDOW_HOURS  ?? 1)  * 3_600_000;
const SPIKE_COOLDOWN_MS  = Number(process.env.SPIKE_COOLDOWN_HOURS ?? 2) * 3_600_000;

interface Entry {
  itemName: string;
  ts: number; // Date.now() at time of filing
}

// Items recorded in the rolling window, oldest first.
const window: Entry[] = [];
// itemName → timestamp when the cooldown expires.
const cooldowns = new Map<string, number>();

/** Prune entries older than the window. */
function prune(now: number): void {
  const cutoff = now - SPIKE_WINDOW_MS;
  while (window.length > 0 && window[0].ts < cutoff) window.shift();
}

/**
 * Seed the rolling window from historical filing data on bot startup.
 *
 * Pass entries derived from `getFilings()` so the window survives restarts
 * without making any additional Sheets API calls.  Only entries that fall
 * within the current window are inserted; entries already present (matched
 * by ts + itemName) are skipped so calling this more than once is safe.
 *
 * Cooldowns are intentionally NOT restored — if the bot restarted mid-spike
 * we want the next filing to be able to fire an alert immediately.
 */
export function seedWindow(entries: { itemName: string; ts: number }[]): void {
  const now = Date.now();
  const cutoff = now - SPIKE_WINDOW_MS;

  const fresh = entries.filter((e) => e.ts >= cutoff);
  if (fresh.length === 0) {
    logger.debug("Spike detector seed: no recent entries within window — nothing to replay");
    return;
  }

  // Build a set of already-present keys to avoid duplicates
  const existing = new Set(window.map((e) => `${e.ts}|${e.itemName}`));
  let added = 0;
  for (const entry of fresh) {
    const key = `${entry.ts}|${entry.itemName}`;
    if (!existing.has(key)) {
      window.push(entry);
      existing.add(key);
      added++;
    }
  }

  // Keep the array sorted oldest-first so prune() works correctly
  window.sort((a, b) => a.ts - b.ts);

  logger.info(
    { seededCount: added, windowHours: SPIKE_WINDOW_MS / 3_600_000 },
    "Spike detector window seeded from filing history",
  );
}

/**
 * Record `items` as freshly filed, then return any items that are spiking.
 * Call this once per completed filing, after the row is safely written to Sheets.
 */
export function recordAndDetect(items: { name: string }[]): SpikeResult[] {
  const now = Date.now();

  // Add new entries
  for (const { name } of items) {
    window.push({ itemName: name, ts: now });
  }

  // Prune entries that have left the window
  prune(now);

  // Check each unique item in the current filing
  const spikes: SpikeResult[] = [];
  const checked = new Set<string>();

  for (const { name } of items) {
    if (checked.has(name)) continue;
    checked.add(name);

    // Still within cooldown for this item?
    const cooldownExpiry = cooldowns.get(name);
    if (cooldownExpiry !== undefined && now < cooldownExpiry) continue;

    // Count occurrences in the window
    const count = window.filter((e) => e.itemName === name).length;
    if (count >= SPIKE_THRESHOLD) {
      spikes.push({ itemName: name, count, windowHours: SPIKE_WINDOW_MS / 3_600_000 });
      cooldowns.set(name, now + SPIKE_COOLDOWN_MS);
    }
  }

  return spikes;
}
