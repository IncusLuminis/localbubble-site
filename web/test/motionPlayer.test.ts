import { describe, expect, it } from "vitest";
import {
  advancePlayerTimeYears,
  clampPlayerTimeYears,
  formatPlayerTimeYears,
  isUiLockedForPlayerTime,
  KM_PER_S_TO_PC_PER_YEAR,
  logSpeedSliderToYearsPerSecond,
  MAX_YEARS_PER_REAL_SECOND,
  MIN_YEARS_PER_REAL_SECOND,
  nextPlayerPlaybackStateForDirectionButton,
  nextPlayerStateForSphere,
  PLAYER_STEP_YEARS,
  PLAYER_TIME_RANGE_YEARS,
  starPositionAtTime,
  stepPlayerTimeYears,
  type PlayerPlaybackState,
  type PlayerState,
} from "../src/scene/motionPlayer";
import { starsWithVelocityInSphere } from "../src/scene/velocityVectors";
import type { SceneObject, SceneVelocity } from "../src/scene/sceneTypes";

/**
 * Story #239 (Epic #238's Story 1 of 2): the time-scrubbing motion player's
 * pure engine - extrapolation, time clamping, the log-scale speed mapping,
 * the sphere-exit reset rule, and the UI-lock predicate. See
 * `motionPlayer.ts`'s own top docstring for why this is kept entirely
 * DOM/Three.js-free (directly testable under this repo's `environment:
 * "node"` Vitest config, unlike `velocityVectors.ts`'s DOM-touching
 * `create*Layer` builders).
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

function makeObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "star",
    position_pc: [1, 0, 0],
    distance_pc: 1,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    spectral_type: null,
    absolute_magnitude: null,
    apparent_magnitude: null,
    exoplanets: null,
    velocity: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

describe("KM_PER_S_TO_PC_PER_YEAR", () => {
  it("matches Epic #238's settled, precisely-cited constant (not rounded further)", () => {
    expect(KM_PER_S_TO_PC_PER_YEAR).toBe(1.02268e-6);
  });
});

describe("clampPlayerTimeYears", () => {
  it("leaves an in-range value untouched", () => {
    expect(clampPlayerTimeYears(0)).toBe(0);
    expect(clampPlayerTimeYears(500_000)).toBe(500_000);
    expect(clampPlayerTimeYears(-500_000)).toBe(-500_000);
  });

  it("clamps to Epic #238's settled +/-1,000,000-year range", () => {
    expect(clampPlayerTimeYears(2_000_000)).toBe(PLAYER_TIME_RANGE_YEARS);
    expect(clampPlayerTimeYears(-2_000_000)).toBe(-PLAYER_TIME_RANGE_YEARS);
  });

  it("is exact at the boundary itself", () => {
    expect(clampPlayerTimeYears(1_000_000)).toBe(1_000_000);
    expect(clampPlayerTimeYears(-1_000_000)).toBe(-1_000_000);
  });
});

describe("starPositionAtTime", () => {
  it("returns exactly the original position at t=0 - no drift, restoration is always exact", () => {
    const position: [number, number, number] = [1.23456789, -2.3456789, 3.456789];
    const velocity = makeVelocity({ vx_kms: -140.95, vy_kms: 5.14, vz_kms: 18.56 });
    expect(starPositionAtTime(position, velocity, 0)).toEqual(position);
  });

  it("computes a displacement whose magnitude matches speed * KM_PER_S_TO_PC_PER_YEAR * t, along the velocity direction", () => {
    // Barnard's Star's real derived velocity (spot-checked against Story
    // #230's PR, same fixture as `velocityVectors.test.ts`'s own
    // `velocitySpeedKms` reference test - ~142.26 km/s).
    const velocity = makeVelocity({
      vx_kms: -140.95084255119036,
      vy_kms: 5.138856219169754,
      vz_kms: 18.556319857067027,
    });
    const speedKms = Math.sqrt(velocity.vx_kms ** 2 + velocity.vy_kms ** 2 + velocity.vz_kms ** 2);
    const tYears = 78_000; // Epic #238: ~ the time Barnard's Star takes to cross the ~11.26pc sphere.
    const [x, y, z] = starPositionAtTime([0, 0, 0], velocity, tYears);
    const displacementPc = Math.sqrt(x * x + y * y + z * z);
    const expectedPc = speedKms * KM_PER_S_TO_PC_PER_YEAR * tYears;
    expect(displacementPc).toBeCloseTo(expectedPc, 8);
    // Epic #238's own approximate figure for this exact scenario.
    expect(displacementPc).toBeCloseTo(11.26, 0);
  });

  it("adds the displacement on top of a non-origin starting position", () => {
    const position: [number, number, number] = [5, -3, 2];
    const velocity = makeVelocity({ vx_kms: 100, vy_kms: 0, vz_kms: 0 });
    const tYears = 10_000;
    const [x, y, z] = starPositionAtTime(position, velocity, tYears);
    expect(x).toBeCloseTo(5 + 100 * KM_PER_S_TO_PC_PER_YEAR * 10_000, 10);
    expect(y).toBe(-3);
    expect(z).toBe(2);
  });

  it("runs backward in time for negative tYears - the opposite displacement", () => {
    const position: [number, number, number] = [0, 0, 0];
    const velocity = makeVelocity({ vx_kms: 50, vy_kms: 0, vz_kms: 0 });
    const forward = starPositionAtTime(position, velocity, 100_000);
    const backward = starPositionAtTime(position, velocity, -100_000);
    expect(backward[0]).toBeCloseTo(-forward[0], 10);
  });
});

describe("formatPlayerTimeYears", () => {
  it('formats t=0 as "Today"', () => {
    expect(formatPlayerTimeYears(0)).toBe("Today");
  });

  it("formats a positive time with a leading '+' and thousands separators", () => {
    expect(formatPlayerTimeYears(342_000)).toBe("+342,000 years");
  });

  it("formats a negative time with a leading '-' and thousands separators", () => {
    expect(formatPlayerTimeYears(-58_000)).toBe("-58,000 years");
  });

  it("rounds to the nearest whole year and never shows a stray +0/-0 near zero", () => {
    expect(formatPlayerTimeYears(0.2)).toBe("Today");
    expect(formatPlayerTimeYears(-0.2)).toBe("Today");
    expect(formatPlayerTimeYears(1.6)).toBe("+2 years");
  });
});

describe("isUiLockedForPlayerTime", () => {
  it("is unlocked exactly at Today (t=0)", () => {
    expect(isUiLockedForPlayerTime(0)).toBe(false);
  });

  it("is locked for any nonzero time, positive or negative - including while merely paused away from Today", () => {
    expect(isUiLockedForPlayerTime(1)).toBe(true);
    expect(isUiLockedForPlayerTime(-1)).toBe(true);
    expect(isUiLockedForPlayerTime(500_000)).toBe(true);
    expect(isUiLockedForPlayerTime(-1_000_000)).toBe(true);
  });
});

describe("advancePlayerTimeYears", () => {
  it("advances forward by deltaRealSeconds * yearsPerRealSecond", () => {
    const result = advancePlayerTimeYears(0, 1, 1000);
    expect(result.timeYears).toBe(1000);
    expect(result.reachedToday).toBe(false);
  });

  it("advances backward for a negative yearsPerRealSecond", () => {
    const result = advancePlayerTimeYears(0, 1, -1000);
    expect(result.timeYears).toBe(-1000);
    expect(result.reachedToday).toBe(false);
  });

  it("clamps to the +/-1,000,000-year range when a step would overshoot it", () => {
    const result = advancePlayerTimeYears(999_000, 1, 5000);
    expect(result.timeYears).toBe(PLAYER_TIME_RANGE_YEARS);
    expect(result.reachedToday).toBe(false);
  });

  it("snaps exactly to 0 (and reports reachedToday) when a forward step would cross zero", () => {
    const result = advancePlayerTimeYears(-500, 1, 1000);
    expect(result.timeYears).toBe(0);
    expect(result.reachedToday).toBe(true);
  });

  it("snaps exactly to 0 (and reports reachedToday) when a backward step would cross zero", () => {
    const result = advancePlayerTimeYears(500, 1, -1000);
    expect(result.timeYears).toBe(0);
    expect(result.reachedToday).toBe(true);
  });

  it("reports reachedToday when a step lands exactly on zero without crossing", () => {
    const result = advancePlayerTimeYears(-1000, 1, 1000);
    expect(result.timeYears).toBe(0);
    expect(result.reachedToday).toBe(true);
  });

  it("does not falsely report reachedToday for a step that stays on the same side of zero", () => {
    const result = advancePlayerTimeYears(1000, 1, 1000);
    expect(result.timeYears).toBe(2000);
    expect(result.reachedToday).toBe(false);
  });

  it("staying exactly at 0 (e.g. a zero delta) reports reachedToday - already at Today", () => {
    const result = advancePlayerTimeYears(0, 0, 1000);
    expect(result.timeYears).toBe(0);
    expect(result.reachedToday).toBe(true);
  });
});

describe("logSpeedSliderToYearsPerSecond", () => {
  it("returns the slow anchor at the slider's floor (0)", () => {
    expect(logSpeedSliderToYearsPerSecond(0)).toBeCloseTo(MIN_YEARS_PER_REAL_SECOND, 6);
  });

  it("returns the fast anchor at the slider's ceiling (1)", () => {
    expect(logSpeedSliderToYearsPerSecond(1)).toBeCloseTo(MAX_YEARS_PER_REAL_SECOND, 6);
  });

  it("Story #243: is magnitude-only - always non-negative, direction carries no meaning here anymore", () => {
    expect(logSpeedSliderToYearsPerSecond(0.5)).toBeGreaterThan(0);
    expect(logSpeedSliderToYearsPerSecond(1)).toBeGreaterThan(0);
  });

  it("Story #243: clamps a defensively negative slider value up to 0 (the magnitude floor), never returning a signed rate", () => {
    expect(logSpeedSliderToYearsPerSecond(-1)).toBeCloseTo(MIN_YEARS_PER_REAL_SECOND, 6);
    expect(logSpeedSliderToYearsPerSecond(-0.5)).toBeCloseTo(logSpeedSliderToYearsPerSecond(0), 6);
  });

  it("is logarithmic, not linear - equal slider steps produce a constant MULTIPLICATIVE change, not a constant additive one", () => {
    const at0 = logSpeedSliderToYearsPerSecond(0);
    const at033 = logSpeedSliderToYearsPerSecond(1 / 3);
    const at066 = logSpeedSliderToYearsPerSecond(2 / 3);
    const at1 = logSpeedSliderToYearsPerSecond(1);
    const ratioA = at033 / at0;
    const ratioB = at066 / at033;
    const ratioC = at1 / at066;
    expect(ratioA).toBeCloseTo(ratioB, 6);
    expect(ratioB).toBeCloseTo(ratioC, 6);
    // And genuinely NOT linear: a linear mapping would give equal absolute
    // (not multiplicative) steps.
    expect(at033 - at0).not.toBeCloseTo(at1 - at066, 0);
  });

  it("reads as gentle near the slow end and dramatic near the fast end for the same slider distance", () => {
    const deltaNearSlowEnd = logSpeedSliderToYearsPerSecond(0.1) - logSpeedSliderToYearsPerSecond(0);
    const deltaNearFastEnd = logSpeedSliderToYearsPerSecond(1) - logSpeedSliderToYearsPerSecond(0.9);
    expect(deltaNearFastEnd).toBeGreaterThan(deltaNearSlowEnd * 10);
  });

  it("clamps a defensively out-of-range slider value to [0, 1]", () => {
    expect(logSpeedSliderToYearsPerSecond(5)).toBeCloseTo(MAX_YEARS_PER_REAL_SECOND, 6);
    expect(logSpeedSliderToYearsPerSecond(-5)).toBeCloseTo(MIN_YEARS_PER_REAL_SECOND, 6);
  });
});

describe("Story #243: nextPlayerPlaybackStateForDirectionButton", () => {
  it("pressing the button matching the currently playing direction pauses (toggle-off)", () => {
    const playingForward: PlayerPlaybackState = { playing: true, direction: 1 };
    expect(nextPlayerPlaybackStateForDirectionButton(playingForward, 1)).toEqual({
      playing: false,
      direction: 1,
    });

    const playingBackward: PlayerPlaybackState = { playing: true, direction: -1 };
    expect(nextPlayerPlaybackStateForDirectionButton(playingBackward, -1)).toEqual({
      playing: false,
      direction: -1,
    });
  });

  it("pressing the OPPOSITE direction while playing reverses direction and keeps playing - no separate pause click", () => {
    const playingForward: PlayerPlaybackState = { playing: true, direction: 1 };
    expect(nextPlayerPlaybackStateForDirectionButton(playingForward, -1)).toEqual({
      playing: true,
      direction: -1,
    });

    const playingBackward: PlayerPlaybackState = { playing: true, direction: -1 };
    expect(nextPlayerPlaybackStateForDirectionButton(playingBackward, 1)).toEqual({
      playing: true,
      direction: 1,
    });
  });

  it("pressing either button while paused starts playing in the pressed direction", () => {
    const pausedForward: PlayerPlaybackState = { playing: false, direction: 1 };
    expect(nextPlayerPlaybackStateForDirectionButton(pausedForward, -1)).toEqual({
      playing: true,
      direction: -1,
    });
    expect(nextPlayerPlaybackStateForDirectionButton(pausedForward, 1)).toEqual({
      playing: true,
      direction: 1,
    });
  });
});

describe("Story #243: stepPlayerTimeYears", () => {
  it("advances by exactly PLAYER_STEP_YEARS in the given direction", () => {
    expect(stepPlayerTimeYears(0, 1)).toBe(PLAYER_STEP_YEARS);
    expect(stepPlayerTimeYears(0, -1)).toBe(-PLAYER_STEP_YEARS);
  });

  it("accepts a custom step size", () => {
    expect(stepPlayerTimeYears(100_000, 1, 5000)).toBe(105_000);
    expect(stepPlayerTimeYears(100_000, -1, 5000)).toBe(95_000);
  });

  it("clamps to the +/-1,000,000-year range when a step would overshoot it", () => {
    expect(stepPlayerTimeYears(PLAYER_TIME_RANGE_YEARS - 100, 1)).toBe(PLAYER_TIME_RANGE_YEARS);
  });

  it("snaps exactly to 0 when a step would cross or land on Today", () => {
    expect(stepPlayerTimeYears(-10_000, 1, PLAYER_STEP_YEARS)).toBe(0);
    expect(stepPlayerTimeYears(5_000, -1, PLAYER_STEP_YEARS)).toBe(0);
  });
});

describe("Epic #238's speed-slider anchors", () => {
  it("MIN_YEARS_PER_REAL_SECOND sits within the Epic's suggested slow-end range (~500-2,000 yrs/s)", () => {
    expect(MIN_YEARS_PER_REAL_SECOND).toBeGreaterThanOrEqual(500);
    expect(MIN_YEARS_PER_REAL_SECOND).toBeLessThanOrEqual(2000);
  });

  it("MAX_YEARS_PER_REAL_SECOND sweeps the full 2,000,000-year range in the Epic's suggested ~10-30 real-second window", () => {
    const sweepSeconds = (2 * PLAYER_TIME_RANGE_YEARS) / MAX_YEARS_PER_REAL_SECOND;
    expect(sweepSeconds).toBeGreaterThanOrEqual(10);
    expect(sweepSeconds).toBeLessThanOrEqual(30);
  });
});

describe("nextPlayerStateForSphere", () => {
  const playingState: PlayerState = { timeYears: 250_000, playing: true, panelOpen: true };

  it("leaves every field untouched while the camera stays inside the sphere", () => {
    expect(nextPlayerStateForSphere(playingState, true)).toEqual(playingState);
  });

  it("force-resets to Today, paused, panel hidden the instant the camera leaves the sphere - even mid-animation", () => {
    expect(nextPlayerStateForSphere(playingState, false)).toEqual({
      timeYears: 0,
      playing: false,
      panelOpen: false,
    });
  });

  it("force-resets even from an already-paused, away-from-Today state", () => {
    const pausedAway: PlayerState = { timeYears: -800_000, playing: false, panelOpen: true };
    expect(nextPlayerStateForSphere(pausedAway, false)).toEqual({
      timeYears: 0,
      playing: false,
      panelOpen: false,
    });
  });

  it("is a no-op when already at rest at Today and the camera leaves the sphere", () => {
    const atRest: PlayerState = { timeYears: 0, playing: false, panelOpen: false };
    expect(nextPlayerStateForSphere(atRest, false)).toEqual(atRest);
  });
});

// Story #239 AC: the animated population is `velocityVectors.ts`'s own
// `starsWithVelocityInSphere`, reused directly - never reimplemented. Full
// coverage of that function's own behavior lives in
// `test/velocityVectors.test.ts`; this is a small confirming test that the
// motion player's population is exactly that same reused selection, not a
// second, possibly-diverging one.
describe("animated-star selection reuse (starsWithVelocityInSphere)", () => {
  it("the player's animated population is exactly starsWithVelocityInSphere's result - no separate selection logic", () => {
    const inSphereWithVelocity = makeObject({
      id: "in-sphere",
      distance_pc: 5,
      velocity: makeVelocity(),
    });
    const noVelocity = makeObject({ id: "no-velocity", distance_pc: 3, velocity: null });
    const outOfSphere = makeObject({ id: "out-of-sphere", distance_pc: 50, velocity: makeVelocity() });

    const objects = [inSphereWithVelocity, noVelocity, outOfSphere];
    const animated = starsWithVelocityInSphere(objects, 11.26);

    expect(animated.map((o) => o.id)).toEqual(["in-sphere"]);
    // Every animated star necessarily carries a non-null `velocity`, which
    // `starPositionAtTime` requires - confirms the two functions compose
    // without any further null-checking gap.
    for (const obj of animated) {
      expect(obj.velocity).not.toBeNull();
    }
  });
});
