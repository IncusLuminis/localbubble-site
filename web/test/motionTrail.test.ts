import { describe, expect, it } from "vitest";
import { KM_PER_S_TO_PC_PER_YEAR, PLAYER_TIME_RANGE_YEARS } from "../src/scene/motionPlayer";
import {
  isTrailVisible,
  starTrailPositionsPc,
  TRAIL_SEGMENT_COUNT,
  TRAIL_WINDOW_YEARS,
  trailSampleTimesYears,
  trailWindowStartYears,
} from "../src/scene/motionTrail";
import type { SceneVelocity } from "../src/scene/sceneTypes";

/**
 * Story #240 (Epic #238's Story 2 of 2): the fixed-simulated-time-window
 * motion trail's pure position/windowing logic - see `motionTrail.ts`'s own
 * top docstring for why this is kept DOM/Three.js-free and directly
 * testable, matching `motionPlayer.test.ts`'s own precedent for Story #239.
 */

function makeVelocity(overrides: Partial<SceneVelocity> = {}): SceneVelocity {
  return {
    vx_kms: 10,
    vy_kms: 0,
    vz_kms: 0,
    radial_velocity_known: true,
    source: { reference: "test fixture", url: null, catalog: null },
    ...overrides,
  };
}

describe("isTrailVisible", () => {
  it("is false exactly at Today (t=0) - AC: returning to Today fully clears all trails", () => {
    expect(isTrailVisible(0)).toBe(false);
  });

  it("is true for any nonzero time, positive or negative", () => {
    expect(isTrailVisible(1)).toBe(true);
    expect(isTrailVisible(-1)).toBe(true);
    expect(isTrailVisible(500_000)).toBe(true);
    expect(isTrailVisible(-500_000)).toBe(true);
  });
});

describe("trailWindowStartYears", () => {
  it("direction=1: is always <= currentTimeYears (the trail's oldest end never comes after its newest end, numerically)", () => {
    for (const t of [0, 1, -1, 100, -100, 60_000, -60_000, 500_000, -500_000, 1_000_000, -1_000_000]) {
      expect(trailWindowStartYears(t, 1)).toBeLessThanOrEqual(t);
    }
  });

  it("direction=-1: is always >= currentTimeYears (a backward-playing star's numerically-larger past values are chronologically OLDER, so the oldest end sits on the numerically-larger side)", () => {
    for (const t of [0, 1, -1, 100, -100, 60_000, -60_000, 500_000, -500_000, 1_000_000, -1_000_000]) {
      expect(trailWindowStartYears(t, -1)).toBeGreaterThanOrEqual(t);
    }
  });

  it("grows the window from zero length right at Today, in the forward direction", () => {
    expect(trailWindowStartYears(0, 1)).toBe(0);
    expect(trailWindowStartYears(100, 1)).toBe(0);
    expect(trailWindowStartYears(TRAIL_WINDOW_YEARS, 1)).toBe(0);
  });

  it("grows the window from zero length right at Today, in the backward direction (symmetric)", () => {
    // At t=-100, direction=-1 the window has only grown to length 100
    // (=|t|) so far, so its start is 0 (Today) - 100 years BEHIND the
    // current -100 along the actual (backward) direction of travel - not
    // the fixed-length -100 - TRAIL_WINDOW_YEARS, and NOT -200 either (that
    // would be the pre-#247 bug: extending further negative, i.e. AHEAD of
    // travel instead of behind it).
    expect(trailWindowStartYears(-100, -1)).toBe(0);
    expect(trailWindowStartYears(-TRAIL_WINDOW_YEARS, -1)).toBe(0);
  });

  it("Story #247 worked example: playing backward from Today, oldest end is Today (0), not further negative - the bug this story fixes", () => {
    // human owner's own live-testing example: t=-5000, windowYears=60000,
    // direction=-1 (playing backward). distanceFromTodayYears = min(5000,
    // 60000) = 5000. oldestEnd = -5000 - (-1)*5000 = -5000 + 5000 = 0 -
    // the star started at Today and has been moving toward more-negative t,
    // so "behind" (where it came from) is 0, not -10000 (the old buggy
    // formula's answer, which pointed AHEAD of the direction of travel).
    expect(trailWindowStartYears(-5000, -1, 60_000)).toBe(0);
  });

  it("Story #247: the already-correct forward-from-Today case is unaffected (no regression)", () => {
    // Mirror of the example above: t=5000, windowYears=60000, direction=1.
    // distanceFromTodayYears = min(5000, 60000) = 5000.
    // oldestEnd = 5000 - 1*5000 = 0 - same "grows from Today" shape as
    // before this story, unchanged by the direction-driven fix.
    expect(trailWindowStartYears(5000, 1, 60_000)).toBe(0);
  });

  it("Story #247: reversed mid-flight - a direction that disagrees with sign(currentTimeYears) is handled correctly (driven by direction, not by t's own sign)", () => {
    // Paused far from Today at t=-400,000 (arrived via backward play), then
    // the opposite (forward, direction=1) button is pressed while still at
    // that position. distanceFromTodayYears = min(400000, 60000) = 60000
    // (window already fully grown). oldestEnd = -400000 - 1*60000 =
    // -460000: further negative than the current position, correctly
    // "behind" the now-forward direction of travel (forward means heading
    // toward less-negative t, so behind is more-negative t).
    expect(trailWindowStartYears(-400_000, 1, TRAIL_WINDOW_YEARS)).toBe(-460_000);
    // Same reversal the other way: paused at t=+400,000, backward
    // (direction=-1) pressed. oldestEnd = 400000 - (-1)*60000 = 460000:
    // further positive, correctly "behind" a now-backward (decreasing t)
    // direction of travel.
    expect(trailWindowStartYears(400_000, -1, TRAIL_WINDOW_YEARS)).toBe(460_000);
  });

  it("holds at the fixed TRAIL_WINDOW_YEARS length once |t| exceeds the window", () => {
    expect(trailWindowStartYears(400_000, 1)).toBe(400_000 - TRAIL_WINDOW_YEARS);
    expect(trailWindowStartYears(-400_000, -1)).toBe(-400_000 + TRAIL_WINDOW_YEARS);
  });

  it("clamps to Epic #238's settled +/-1,000,000-year range even when currentTimeYears is near the boundary", () => {
    expect(trailWindowStartYears(PLAYER_TIME_RANGE_YEARS, 1)).toBe(
      PLAYER_TIME_RANGE_YEARS - TRAIL_WINDOW_YEARS,
    );
    // Near the far (negative) boundary, direction=-1 pushes the oldest end
    // toward more-positive values (see the "always >= currentTimeYears"
    // test above) which is safely inside the range on its own; check the
    // opposite pairing instead - direction=1 near the negative boundary,
    // where subtracting the window would otherwise land below -1,000,000.
    const nearBoundary = -PLAYER_TIME_RANGE_YEARS + 100;
    expect(trailWindowStartYears(nearBoundary, 1)).toBeGreaterThanOrEqual(-PLAYER_TIME_RANGE_YEARS);
  });
});

describe("trailSampleTimesYears", () => {
  it("returns an empty array exactly at Today", () => {
    expect(trailSampleTimesYears(0, 1)).toEqual([]);
    expect(trailSampleTimesYears(0, -1)).toEqual([]);
  });

  it("returns segmentCount + 1 evenly spaced samples from the window start to currentTimeYears (direction=1)", () => {
    const times = trailSampleTimesYears(400_000, 1, TRAIL_WINDOW_YEARS, TRAIL_SEGMENT_COUNT);
    expect(times).toHaveLength(TRAIL_SEGMENT_COUNT + 1);
    expect(times[0]).toBeCloseTo(400_000 - TRAIL_WINDOW_YEARS, 6);
    expect(times[times.length - 1]).toBe(400_000);
    // Monotonically increasing (oldest to newest).
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("returns segmentCount + 1 evenly spaced samples from the window start to currentTimeYears (direction=-1, Story #247)", () => {
    const times = trailSampleTimesYears(-400_000, -1, TRAIL_WINDOW_YEARS, TRAIL_SEGMENT_COUNT);
    expect(times).toHaveLength(TRAIL_SEGMENT_COUNT + 1);
    expect(times[0]).toBeCloseTo(-400_000 + TRAIL_WINDOW_YEARS, 6);
    expect(times[times.length - 1]).toBe(-400_000);
    // Monotonically DECREASING (oldest to newest) - a backward-playing
    // star's oldest sample sits at the numerically-larger end.
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeLessThan(times[i - 1]);
    }
  });

  it("the last sample is always exactly currentTimeYears, so the trail's front vertex always matches the marker with no gap", () => {
    for (const direction of [1, -1] as const) {
      for (const t of [1, -1, 42, -42, 500_000, -500_000]) {
        const times = trailSampleTimesYears(t, direction);
        expect(times[times.length - 1]).toBe(t);
      }
    }
  });

  it("uses a custom window/segment count when passed explicitly", () => {
    const times = trailSampleTimesYears(1000, 1, 100, 2);
    expect(times).toEqual([900, 950, 1000]);
  });
});

describe("starTrailPositionsPc", () => {
  it("returns an empty array at Today, matching trailSampleTimesYears", () => {
    const velocity = makeVelocity();
    expect(starTrailPositionsPc([0, 0, 0], velocity, 0, 1)).toEqual([]);
    expect(starTrailPositionsPc([0, 0, 0], velocity, 0, -1)).toEqual([]);
  });

  it("the last position is always exactly the star's current animated position (via the same starPositionAtTime the marker uses)", () => {
    const position: [number, number, number] = [2, -1, 4];
    const velocity = makeVelocity({ vx_kms: 100, vy_kms: -50, vz_kms: 25 });
    const tYears = 300_000;
    const positions = starTrailPositionsPc(position, velocity, tYears, 1);
    const pcPerYear = KM_PER_S_TO_PC_PER_YEAR * tYears;
    const expectedCurrent: [number, number, number] = [
      position[0] + velocity.vx_kms * pcPerYear,
      position[1] + velocity.vy_kms * pcPerYear,
      position[2] + velocity.vz_kms * pcPerYear,
    ];
    const last = positions[positions.length - 1];
    expect(last[0]).toBeCloseTo(expectedCurrent[0], 10);
    expect(last[1]).toBeCloseTo(expectedCurrent[1], 10);
    expect(last[2]).toBeCloseTo(expectedCurrent[2], 10);
  });

  it("recomputes fully from the star's real position/velocity for ANY currentTimeYears - correct on a discontinuous scrub jump, not dependent on having visited intermediate frames", () => {
    const position: [number, number, number] = [0, 0, 0];
    const velocity = makeVelocity({ vx_kms: 50, vy_kms: 0, vz_kms: 0 });
    // Simulate "scrubbing directly" to a distant time with no prior frames
    // ever having been rendered at any intermediate time.
    const scrubbed = starTrailPositionsPc(position, velocity, 700_000, 1);
    // Independently recomputed the same way starPositionAtTime would - the
    // trail must match this exactly, proving it never depends on a
    // frame-by-frame history buffer.
    const pcPerYear = KM_PER_S_TO_PC_PER_YEAR * 700_000;
    expect(scrubbed[scrubbed.length - 1][0]).toBeCloseTo(velocity.vx_kms * pcPerYear, 10);
  });

  it("direction reversal: the window continuously re-centers on the current time, so it correctly re-orients as playback direction flips", () => {
    const position: [number, number, number] = [0, 0, 0];
    const velocity = makeVelocity({ vx_kms: 30, vy_kms: 0, vz_kms: 0 });
    // Held at max trail length (playing forward, far from both Today and
    // the window-growth region).
    const forward = starTrailPositionsPc(position, velocity, 400_000, 1);
    // Reversed a bit (time now decreasing, direction now -1).
    const reversed = starTrailPositionsPc(position, velocity, 390_000, -1);
    // The newest (current-position) end has shifted down by the 10,000-year
    // step, same as before.
    expect(reversed[reversed.length - 1][0]).toBeLessThan(forward[forward.length - 1][0]);
    // The oldest end, however, now sits AHEAD of (greater than) the current
    // position - Story #247: with direction=-1 the trail's oldest end is
    // driven by the current direction, not by re-centering symmetrically
    // around currentTimeYears, so it re-orients to point behind the new
    // (backward) direction of travel rather than simply sliding down.
    expect(reversed[0][0]).toBeGreaterThan(reversed[reversed.length - 1][0]);
  });

  it("Story #247 worked example (end-to-end through starTrailPositionsPc): playing backward from Today, the trail's oldest position is exactly the star's Today position", () => {
    const position: [number, number, number] = [5, 0, 0];
    const velocity = makeVelocity({ vx_kms: 20, vy_kms: 0, vz_kms: 0 });
    const positions = starTrailPositionsPc(position, velocity, -5000, -1, 60_000);
    // oldestEnd = 0 (Today) per the worked example - so the trail's first
    // (oldest) sample must equal the star's un-extrapolated Today position.
    expect(positions[0][0]).toBeCloseTo(position[0], 10);
    expect(positions[0][1]).toBeCloseTo(position[1], 10);
    expect(positions[0][2]).toBeCloseTo(position[2], 10);
  });
});
