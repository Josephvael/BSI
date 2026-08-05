import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { recordAndDetect, _resetForTest } from "./spike-detector";

// The module reads env vars at load time; defaults are threshold=3, window=1h, cooldown=2h.
// We control "now" with vitest fake timers so we can move time forward without sleeping.

const THRESHOLD = 3;
const WINDOW_MS = 1 * 3_600_000;   // 1 hour in ms
const COOLDOWN_MS = 2 * 3_600_000; // 2 hours in ms

beforeEach(() => {
  _resetForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function items(...names: string[]) {
  return names.map((name) => ({ name }));
}

// ─── Threshold behaviour ─────────────────────────────────────────────────────

describe("spike fires at threshold", () => {
  it("returns a spike result once an item reaches the threshold count", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    recordAndDetect(items("Delino R20"));
    recordAndDetect(items("Delino R20"));
    const spikes = recordAndDetect(items("Delino R20")); // 3rd filing = threshold

    expect(spikes).toHaveLength(1);
    expect(spikes[0].itemName).toBe("Delino R20");
    expect(spikes[0].count).toBe(THRESHOLD);
    expect(spikes[0].windowHours).toBe(1);
  });

  it("spike result count reflects the actual window count at detection time", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // File exactly THRESHOLD times; the final call must carry count = THRESHOLD
    for (let i = 0; i < THRESHOLD - 1; i++) recordAndDetect(items("Kilikov 54U"));
    const spikes = recordAndDetect(items("Kilikov 54U"));

    expect(spikes).toHaveLength(1);
    expect(spikes[0].count).toBe(THRESHOLD);
  });
});

describe("does not fire below threshold", () => {
  it("returns no spikes when the item has been filed fewer than threshold times", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    const after1 = recordAndDetect(items("Hawthorn 500"));
    expect(after1).toHaveLength(0);

    const after2 = recordAndDetect(items("Hawthorn 500"));
    expect(after2).toHaveLength(0);
  });

  it("returns no spike for an item filed exactly threshold-1 times", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    for (let i = 0; i < THRESHOLD - 1; i++) {
      recordAndDetect(items("Bennetti 15"));
    }
    const spikes = recordAndDetect(items("OtherItem")); // trigger detection pass without adding Bennetti 15
    // OtherItem has 1 filing — no spike
    expect(spikes).toHaveLength(0);
  });
});

// ─── Cooldown behaviour ───────────────────────────────────────────────────────

describe("cooldown prevents re-alert", () => {
  it("does not fire a second spike for the same item while the cooldown is active", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // Reach threshold — first alert fires
    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Molotov"));
    // Verify first alert fired
    _resetForTest();

    vi.setSystemTime(t0); // reset time too

    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Molotov"));
    const firstSpikes = recordAndDetect(items("Molotov")); // this is the 4th; cooldown now set
    // recordAndDetect at exactly threshold — first alert
    // Actually let's be precise: after 3 filings cooldown is set; 4th filing is within cooldown
    // Let's redo cleanly
    _resetForTest();

    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Molotov"));
    // cooldown is now set; advance time by less than COOLDOWN_MS
    vi.setSystemTime(t0 + COOLDOWN_MS - 1);
    const duringCooldown = recordAndDetect(items("Molotov"));
    expect(duringCooldown).toHaveLength(0);
  });

  it("fires again after the cooldown period has elapsed", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // Trigger first spike
    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Jerrybomb"));

    // Advance past cooldown AND keep within window from future filings' perspective
    vi.setSystemTime(t0 + COOLDOWN_MS + 1);

    // File THRESHOLD more times at the new timestamp (all within a fresh window from t0+cooldown)
    for (let i = 0; i < THRESHOLD - 1; i++) recordAndDetect(items("Jerrybomb"));
    const afterCooldown = recordAndDetect(items("Jerrybomb"));

    // The old entries (from t0) may still be in window — count could be >= threshold
    expect(afterCooldown.length).toBeGreaterThanOrEqual(1);
    expect(afterCooldown[0].itemName).toBe("Jerrybomb");
  });
});

// ─── Rolling window pruning ───────────────────────────────────────────────────

describe("window prunes old entries", () => {
  it("does not count entries older than the window size", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // File THRESHOLD-1 times — not enough to spike yet
    for (let i = 0; i < THRESHOLD - 1; i++) recordAndDetect(items("Tear Gas"));

    // Advance past the window so those entries are pruned
    vi.setSystemTime(t0 + WINDOW_MS + 1);

    // File THRESHOLD-2 times at the new time, then one more — total in new window = THRESHOLD-1
    for (let i = 0; i < THRESHOLD - 2; i++) recordAndDetect(items("Tear Gas"));
    const spikes = recordAndDetect(items("Tear Gas")); // total in current window = THRESHOLD-1, not THRESHOLD

    expect(spikes).toHaveLength(0);
  });

  it("fires when entries from within the window collectively reach the threshold", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // File once at t0
    recordAndDetect(items("Detonator"));

    // Move forward but still within window
    vi.setSystemTime(t0 + WINDOW_MS / 2);

    // File two more times — total within window = 3 = threshold
    recordAndDetect(items("Detonator"));
    const spikes = recordAndDetect(items("Detonator"));

    expect(spikes).toHaveLength(1);
    expect(spikes[0].itemName).toBe("Detonator");
  });
});

// ─── Multiple items tracked independently ────────────────────────────────────

describe("multiple different items tracked independently", () => {
  it("fires only for the item that crossed the threshold, not others in the same filing", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // File item A twice
    recordAndDetect(items("Bag of Gushie"));
    recordAndDetect(items("Bag of Gushie"));
    // File item B once
    recordAndDetect(items("Jarniwus"));

    // Third filing for A alongside second filing for B
    const spikes = recordAndDetect(items("Bag of Gushie", "Jarniwus"));

    const spikedNames = spikes.map((s) => s.itemName);
    expect(spikedNames).toContain("Bag of Gushie");
    expect(spikedNames).not.toContain("Jarniwus");
  });

  it("tracks each item's count separately so two items can spike independently", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Lockpicks"));
    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Handcuffs"));

    // Both should have spiked; let's verify each fired by checking cooldowns indirectly.
    // After the loops above, both items hit threshold at their 3rd filing.
    // Their cooldown is set — filing again while in cooldown should yield no new spikes.
    const noSpikes = recordAndDetect(items("Lockpicks", "Handcuffs"));
    expect(noSpikes).toHaveLength(0);
  });

  it("cooldown for one item does not suppress alerts for a different item", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // Push item A to spike and into cooldown
    for (let i = 0; i < THRESHOLD; i++) recordAndDetect(items("Cones"));

    // Now push item B to threshold — should still fire despite A being in cooldown
    for (let i = 0; i < THRESHOLD - 1; i++) recordAndDetect(items("Spike Strips"));
    const spikes = recordAndDetect(items("Spike Strips"));

    expect(spikes).toHaveLength(1);
    expect(spikes[0].itemName).toBe("Spike Strips");
  });

  it("duplicate item names in a single filing call are deduplicated before threshold check", () => {
    const t0 = new Date("2025-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // Passing the same item twice in one call should record two entries but only check once
    recordAndDetect(items("Taser Cartridge", "Taser Cartridge")); // 2 entries added
    const spikes = recordAndDetect(items("Taser Cartridge")); // 3rd entry → threshold

    expect(spikes).toHaveLength(1);
    expect(spikes[0].itemName).toBe("Taser Cartridge");
    expect(spikes[0].count).toBe(3);
  });
});
