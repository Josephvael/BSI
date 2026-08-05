/**
 * In-memory rolling-window spike detector for filing items.
 *
 * After each successful filing, call `recordAndDetect()` with the seized items.
 * It returns any items that have crossed the spike threshold within the rolling
 * window and haven't already triggered an alert within the cooldown period.
 *
 * Configurable via environment variables:
 *   SPIKE_THRESHOLD     — filings of the same item before it's a spike (default: 3)
 *   SPIKE_WINDOW_HOURS  — rolling window size in hours (default: 1)
 *   SPIKE_COOLDOWN_HOURS — minimum hours between alerts for the same item (default: 2)
 */

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
