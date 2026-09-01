import type { SceneVelocity } from "./sceneTypes";

/**
 * Story #239 (Epic #238's Story 1 of 2): the time-scrubbing star-motion
 * player's pure engine - linear extrapolation of the ~127 in-sphere stars'
 * positions forward/backward in time from their known heliocentric space
 * velocities (Epic #229's `velocity.{vx,vy,vz}_kms`), plus the small set of
 * other pure decisions (time clamping, log-scale speed mapping, the
 * sphere-exit reset rule, the UI-lock predicate) `main.ts` wires up to the
 * DOM/Three.js layer. Deliberately DOM/Three.js-free throughout, unlike
 * `velocityVectors.ts`'s `createVelocityVectorsLayer`/
 * `createVelocitySpeedLabelsLayer` - every function here is directly
 * unit-testable (this repo's `vite.config.ts` runs Vitest with
 * `environment: "node"`).
 *
 * The animated population itself is NOT re-derived here - `main.ts` reuses
 * `velocityVectors.ts`'s exported `starsWithVelocityInSphere` directly, per
 * both this Story's and Epic #238's explicit instruction not to reimplement
 * that selection (see `test/velocityVectors.test.ts` for its own coverage).
 *
 * Story #243 (polish on this Epic, post-merge): replaced the single
 * play/pause toggle's implicit direction (the speed slider's sign) with the
 * classic `|< < > >|` transport scheme - `PlayerDirection`,
 * `nextPlayerPlaybackStateForDirectionButton`, `PLAYER_STEP_YEARS`, and
 * `stepPlayerTimeYears`, plus `logSpeedSliderToYearsPerSecond`'s then-updated
 * (magnitude-only) shape.
 *
 * Story #266 (state-model half of the NASA "Eyes on the Solar System"-style
 * redesign - Story #267 does the matching visual redesign once this merges):
 * reverted `logSpeedSliderToYearsPerSecond` back to a SIGNED `[-1, 1]` input
 * (sign = direction, magnitude = speed) - the pre-#243 shape - since a single
 * rate value now drives both direction and speed together, per the human
 * owner's live-testing session. Removed `PLAYER_STEP_YEARS`/
 * `stepPlayerTimeYears` (the `|<`/`>|` step buttons are gone, no
 * replacement) and `nextPlayerPlaybackStateForDirectionButton`/
 * `PlayerPlaybackState` (the "same-direction-pauses/opposite-reverses"
 * coupling no longer applies now that Play/Pause is a plain, rate-independent
 * toggle). `PlayerDirection` itself survives, repurposed: it's now just the
 * SIGN of the rate value (still used by `motionTrail.ts`'s trail-window math
 * and by `nudgeRateSliderValue`'s `deltaSign` below), no longer a
 * separately-tracked piece of state.
 *
 * Story #267 (the matching visual redesign, purely additive to this file):
 * `arcDragFractionToRateSliderValue` (the new arc widget's drag-to-value
 * math) and `formatPlayerRateYearsPerSecond` (the new rate readout's
 * formatting) - the only two bits of new pure logic the visual redesign
 * needed, per this module's own DOM-free/independently-testable convention.
 * Nothing above this addition changed.
 *
 * Story #271 (follow-up to #267): `arcDragFractionToPlayerTimeYears` -
 * `arcDragFractionToRateSliderValue`'s own drag-fraction-to-value math,
 * mirrored for the absolute-time scrubber now that it's restyled as a
 * second arc (`ui/playerPanel.ts`) instead of a plain `<input type="range">`.
 * Same linear `[0,1]` remap shape, just over `[-PLAYER_TIME_RANGE_YEARS,
 * +PLAYER_TIME_RANGE_YEARS]` instead of `[-1,1]`.
 *
 * Story #273 (tuning/polish follow-up to #271): lowered
 * `MAX_YEARS_PER_REAL_SECOND` from `150_000` to `20_000` per the human
 * owner's live-testing (the old max was too fast to watch anything move) -
 * see that constant's own docstring below for the recomputed sweep-time
 * figure. Also added labeled tick marks to the time arc
 * (`ui/playerPanel.ts`'s `renderTimeArcTicks`), reusing the same
 * `arcPointAtT` geometry already used for the arc's own handle/fill path.
 */

/**
 * Epic #238's settled unit-conversion constant: km/s -> pc/year.
 *
 * Derivation (cited, not re-derived - Epic #238's own numbers): 1 parsec =
 * 3.0857e13 km; 1 Julian year = 3.15576e7 s. So 1 km/s in pc/year is
 * `(1 km/s) * (3.15576e7 s/yr) / (3.0857e13 km/pc)` = `3.15576e7 / 3.0857e13`
 * = `1.02268...e-6` pc/year - the "near-1:1 unit coincidence" (1 km/s is
 * almost exactly 1.02268 pc per *million* years) the Epic's own physics
 * writeup calls out as the real scale constraint behind the +/-1,000,000-year
 * range. Kept at this exact precision (not rounded further) per the Epic's
 * explicit instruction.
 */
export const KM_PER_S_TO_PC_PER_YEAR = 1.02268e-6;

/** Epic #238's settled time range: the player's `tYears` is always clamped
 * to `[-PLAYER_TIME_RANGE_YEARS, +PLAYER_TIME_RANGE_YEARS]`, in both
 * directions. */
export const PLAYER_TIME_RANGE_YEARS = 1_000_000;

/** Clamps a candidate player time (years, signed - positive is the future,
 * negative the past) to Epic #238's settled `+/-1,000,000`-year range. Story
 * #239 AC: applied wherever the player's time state is ever set - scrub
 * drag, play advancing, the "Today" jump (a no-op clamp at exactly 0) - so
 * `tYears` can never leave this range through any path. */
export function clampPlayerTimeYears(tYears: number): number {
  return Math.min(PLAYER_TIME_RANGE_YEARS, Math.max(-PLAYER_TIME_RANGE_YEARS, tYears));
}

/**
 * Linear extrapolation of a star's position at a given player time, from its
 * real, static `position_pc` (Story #64's catalog baseline) and its known
 * heliocentric space velocity (Story #230's `velocity` field). Per Epic
 * #238's settled reasoning: the Sun stays fixed at the origin (never passed
 * in or moved here), and since `velocity` is already Sun-relative, this
 * `position + velocity * t` extrapolation is the physically correct picture
 * on its own - no additional frame transform needed.
 *
 * Deliberately recomputes fully from the star's ORIGINAL `positionPc` every
 * call, never from a previously-extrapolated position - `main.ts` calls this
 * fresh every animation frame with the player's current absolute `tYears`,
 * so there is no opportunity for the repeated-matrix-composition drift Story
 * #239's AC explicitly warns against. At `tYears = 0` this returns exactly
 * `positionPc` (IEEE754 `x + y * v * 0` is exactly `x`, no floating-point
 * accumulation), so restoring the player to Today is always exact by
 * construction, not a special-cased branch.
 */
export function starPositionAtTime(
  positionPc: readonly [number, number, number],
  velocityKms: Pick<SceneVelocity, "vx_kms" | "vy_kms" | "vz_kms">,
  tYears: number,
): [number, number, number] {
  const pcPerYear = KM_PER_S_TO_PC_PER_YEAR * tYears;
  return [
    positionPc[0] + velocityKms.vx_kms * pcPerYear,
    positionPc[1] + velocityKms.vy_kms * pcPerYear,
    positionPc[2] + velocityKms.vz_kms * pcPerYear,
  ];
}

/**
 * Formats the player's current time for the readout (Story #239's AC
 * example text: `"+342,000 years"` / `"-58,000 years"` / `"Today"`).
 * Rounded to the nearest whole year before formatting/sign-checking, so a
 * `tYears` that's landed extremely close to (but not bit-exactly) zero from
 * accumulated `deltaSeconds` floating-point steps still reads as "Today"
 * rather than "+0 years"/"-0 years" - `advancePlayerTimeYears` below snaps
 * an actual zero-crossing to bit-exact `0` anyway, so this rounding is a
 * display-only safety net, not the mechanism the UI lock itself relies on
 * (`isUiLockedForPlayerTime` compares the raw, un-rounded state).
 */
export function formatPlayerTimeYears(tYears: number): string {
  const rounded = Math.round(tYears);
  if (rounded === 0) {
    return "Today";
  }
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US")} years`;
}

/**
 * Story #273: compact tick-label formatting for the time arc's new scale
 * marks (`ui/playerPanel.ts`) - e.g. `"-1M"`, `"-500K"`, `"Today"`,
 * `"+500K"`, `"+1M"`. Deliberately NOT `formatPlayerTimeYears`'s own
 * `"-1,000,000 years"` shape - too long/dense for a handful of small labels
 * stacked along a compact arc widget. Mirrors `formatPlayerRateYearsPerSecond`'s
 * own `K`-suffix abbreviation convention, extended with an `M`-suffix for
 * whole millions (the tick values `ui/playerPanel.ts` actually uses are
 * always whole hundred-thousands or whole millions, so the `M` branch only
 * ever fires on an exact multiple - an in-between value like 750,000 would
 * fall through to the `K` branch as `"+750K"`, still reasonable).
 */
export function formatPlayerTimeTickLabel(tYears: number): string {
  const rounded = Math.round(tYears);
  if (rounded === 0) {
    return "Today";
  }
  const sign = rounded > 0 ? "+" : "-";
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1_000_000 && magnitude % 1_000_000 === 0) {
    return `${sign}${magnitude / 1_000_000}M`;
  }
  if (magnitude >= 1_000) {
    return `${sign}${Math.round(magnitude / 1000)}K`;
  }
  return `${sign}${magnitude}`;
}

/**
 * Story #239's UI-lock predicate (Epic #238: "locked/disabled whenever the
 * player's current time is NOT exactly Today (t=0) - this includes while
 * paused away from Today, not just while actively playing"). Deliberately
 * trivial (a single `!== 0` check) but kept as its own named, exported, unit-
 * tested function rather than inlined at each of `main.ts`'s several call
 * sites (category checkboxes, search, radius slider, star-click selection) -
 * a single source of truth for "is time away from Today right now" that
 * every one of those call sites, and the panel's own lock/unlock transition
 * detection, agree on.
 */
export function isUiLockedForPlayerTime(tYears: number): boolean {
  return tYears !== 0;
}

/** One step of the player's play-forward/back state machine: advances
 * `currentTimeYears` by `deltaRealSeconds * yearsPerRealSecond` (negative
 * `yearsPerRealSecond` runs the animation in reverse), clamped to Epic
 * #238's settled range.
 *
 * `reachedToday` is `true` in exactly two cases: (1) the raw, un-clamped
 * step would cross zero (current time and the clamped next time have
 * opposite signs, or the next time lands exactly on zero) - in that case the
 * returned `timeYears` SNAPS to bit-exact `0` rather than the raw stepped
 * value, so playing through Today always lands exactly on it rather than
 * potentially skipping over by one frame's worth of years (Story #239 AC:
 * "Play reaching it" is one of the three ways the player must return to an
 * exact Today); or (2) `currentTimeYears` was already exactly `0` (a
 * `yearsPerRealSecond` of `0`, or a zero `deltaRealSeconds`, staying put at
 * Today). `main.ts` uses `reachedToday` to auto-pause the player the instant
 * it arrives at Today, mirroring the "Today" button's own pause-on-arrival
 * behavior - see that call site for why a still-`playing` player sitting
 * exactly on Today would otherwise immediately step away again next frame.
 */
export interface PlayerAdvanceResult {
  timeYears: number;
  reachedToday: boolean;
}

export function advancePlayerTimeYears(
  currentTimeYears: number,
  deltaRealSeconds: number,
  yearsPerRealSecond: number,
): PlayerAdvanceResult {
  const rawNext = currentTimeYears + deltaRealSeconds * yearsPerRealSecond;
  const clampedNext = clampPlayerTimeYears(rawNext);

  const crossedOrReachedZero =
    clampedNext === 0 ||
    (currentTimeYears < 0 && clampedNext > 0) ||
    (currentTimeYears > 0 && clampedNext < 0);

  if (crossedOrReachedZero) {
    return { timeYears: 0, reachedToday: true };
  }
  return { timeYears: clampedNext, reachedToday: false };
}

/**
 * Epic #238's original logarithmic speed-slider anchors, NASA "Eyes on the
 * Solar System" style - live-tuned starting point per the Epic's own
 * suggested ranges (slow end ~500-2,000 simulated years/real-second, fast
 * end able to sweep the full 2,000,000-year range in ~10-30 real seconds).
 * `MIN_YEARS_PER_REAL_SECOND` sits at that suggested slow-end anchor and is
 * unchanged.
 *
 * Story #273 lowered `MAX_YEARS_PER_REAL_SECOND` from its original
 * `150_000` down to `20_000`: the human owner's own live-testing found the
 * original value too fast to be useful - at that rate stars fly out of
 * visual range almost instantly, so higher speeds aren't actually meaningful
 * for watching motion. At the new cap, `MAX_YEARS_PER_REAL_SECOND` sweeps
 * the full `[-1_000_000, 1_000_000]` range in `2 * PLAYER_TIME_RANGE_YEARS /
 * MAX_YEARS_PER_REAL_SECOND` = 100 real seconds - plainly slower than (and
 * deliberately outside) the Epic's original ~10-30s guidance, since this
 * Story's own live-tuned "motion stays watchable" priority supersedes that
 * original figure. Verified live in the running viewer (see the PR
 * description) rather than accepted on paper alone.
 */
export const MIN_YEARS_PER_REAL_SECOND = 1_000;
export const MAX_YEARS_PER_REAL_SECOND = 20_000;

/**
 * Maps a rate-slider control value (`[-1, 1]`, SIGNED - Story #266, restoring
 * the pre-#243 shape) to a signed years-per-real-second playback RATE,
 * logarithmic between `MIN_YEARS_PER_REAL_SECOND` and
 * `MAX_YEARS_PER_REAL_SECOND` in MAGNITUDE, with the sign of `sliderValue`
 * carried straight through to the sign of the result. Mirrors NASA "Eyes on
 * the Solar System"'s own time-control widget (the confirmed design
 * reference): center of the control is near-zero/slow, left of center is
 * backward with growing magnitude, right of center is forward with growing
 * magnitude - direction and speed both come from this one value.
 *
 * Logarithmic (not linear) interpolation of the MAGNITUDE is the entire
 * point of this function (Epic #238's explicit "NASA Eyes-on-Solar-System
 * style" log-speed requirement): equal slider DISTANCE near the slow end
 * changes the rate by a much smaller absolute amount than the same slider
 * distance near the fast end - small movements read as "gentle" near slow,
 * "a lot" near fast, per Story #239's own live-verification AC.
 *
 * A `sliderValue` of exactly `0` is NOT a true zero rate: its magnitude (0)
 * still maps to `MIN_YEARS_PER_REAL_SECOND`, just with an (arbitrary, here
 * positive/forward) sign - "stopped" is owned entirely by the separate
 * `playing` boolean (`main.ts`), never by the rate value itself. This
 * matches the original pre-#243 behavior exactly (Story #266 AC).
 *
 * `sliderValue` is clamped to `[-1, 1]` defensively (a scrub event or
 * malformed input could otherwise hand this a wildly out-of-range value);
 * every normal caller (the panel's own `<input type="range" min="-1"
 * max="1">`) never produces one outside that range in the first place.
 */
export function logSpeedSliderToYearsPerSecond(sliderValue: number): number {
  const clamped = Math.max(-1, Math.min(1, sliderValue));
  const sign = clamped < 0 ? -1 : 1;
  const magnitude = Math.abs(clamped);
  const logMin = Math.log(MIN_YEARS_PER_REAL_SECOND);
  const logMax = Math.log(MAX_YEARS_PER_REAL_SECOND);
  const logValue = logMin + magnitude * (logMax - logMin);
  return sign * Math.exp(logValue);
}

/**
 * The sign of the player's current rate/direction - `1` is forward, `-1` is
 * backward. Through Story #243 this was a separately-tracked piece of state
 * (the active `<`/`>` transport button); Story #266 removed that separate
 * tracking (direction is now just the sign of the single signed rate value,
 * owned entirely by `main.ts`'s `playerRateSliderValue`), but kept this type
 * alias since callers still need to talk about "which way" as its own
 * concept - `nudgeRateSliderValue`'s `deltaSign` below, and
 * `motionTrail.ts`'s trail-window math (unchanged by this Story), both still
 * take a `PlayerDirection`.
 */
export type PlayerDirection = 1 | -1;

/**
 * Story #267 (the visual-redesign follow-up to #266's state-model work):
 * maps a horizontal drag-position FRACTION across the new rate arc's own
 * hit-area (`0` = its left/backward end, `1` = its right/forward end, `0.5`
 * = dead center) to the signed `[-1, 1]` rate slider value the arc re-skins
 * (unchanged from #266's `<input type="range" min="-1" max="1">`
 * semantics). `ui/playerPanel.ts` computes `fraction` from a pointer event's
 * `clientX` relative to the arc's own bounding box (mouse AND touch both
 * resolve to a single `PointerEvent` stream, so one code path handles both)
 * and calls this pure function for the actual value math, mirroring
 * `nudgeRateSliderValue`'s own "pure math in here, DOM wiring in
 * `main.ts`/`playerPanel.ts`" split so the mapping itself stays independently
 * unit-tested.
 *
 * `fraction` is clamped to `[0, 1]` first (a drag gesture can end up outside
 * the arc's own bounding box mid-drag) before a LINEAR `[0,1] -> [-1,1]`
 * remap - deliberately linear across the drag surface's width, not curved to
 * match the arc's visual bow, per the issue's own explicit priority: "a
 * smooth drag interaction... over pixel-perfect curvature."
 */
export function arcDragFractionToRateSliderValue(fraction: number): number {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  return clampedFraction * 2 - 1;
}

/**
 * Story #271: the absolute-time scrubber's own drag-fraction-to-value math,
 * now that it's a second arc (`ui/playerPanel.ts`) beneath the rate arc
 * rather than a plain `<input type="range">`. Identical shape to
 * `arcDragFractionToRateSliderValue` above - `fraction` clamped to `[0,1]`
 * then a LINEAR remap - just scaled to
 * `[-PLAYER_TIME_RANGE_YEARS, +PLAYER_TIME_RANGE_YEARS]` instead of `[-1,1]`,
 * matching the un-clamped-value contract `onScrub` already had (`main.ts`
 * clamps via `clampPlayerTimeYears`, same as the old scrubber's own values
 * always were in range already since its native `min`/`max` enforced it -
 * this function's own linear remap can never produce an out-of-range result
 * either, but callers still route through `onScrub`/`clampPlayerTimeYears`
 * for a single source of truth on the clamp).
 */
export function arcDragFractionToPlayerTimeYears(fraction: number): number {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  return (clampedFraction * 2 - 1) * PLAYER_TIME_RANGE_YEARS;
}

/**
 * Story #267: the abbreviation threshold `formatPlayerRateYearsPerSecond`
 * (below) switches on - below this many years/real-second, the readout shows
 * the exact whole-number value; at or above it, whole thousands abbreviated
 * with a `K` suffix. `MIN_YEARS_PER_REAL_SECOND` (1,000) sits just under this
 * threshold and stays unabbreviated; `MAX_YEARS_PER_REAL_SECOND` (20,000
 * since Story #273, originally 150,000) still sits comfortably inside the
 * abbreviated range, reading as "20K yr/s" at the new cap - live-tuned in the
 * running viewer for readability, per the issue's own "your call on exact
 * thresholds" guidance.
 */
export const RATE_READOUT_ABBREVIATION_THRESHOLD_YEARS_PER_SECOND = 10_000;

/**
 * Story #267's rate readout (target layout item 4) - e.g. `"1,000 yr/s"` at
 * the slow end, `"50K yr/s"` near the fast end. Takes the SIGNED
 * years-per-real-second rate (`logSpeedSliderToYearsPerSecond`'s own return
 * shape) but renders UNSIGNED (`Math.abs` first): the arc's own handle
 * position and the time readout's `+`/`-` sign already carry direction, so
 * repeating it here would be redundant. Mirrors `formatPlayerTimeYears`'s own
 * `toLocaleString("en-US")` comma-grouping convention for the unabbreviated
 * case.
 */
export function formatPlayerRateYearsPerSecond(yearsPerRealSecond: number): string {
  const magnitude = Math.abs(yearsPerRealSecond);
  if (magnitude >= RATE_READOUT_ABBREVIATION_THRESHOLD_YEARS_PER_SECOND) {
    const thousands = Math.round(magnitude / 1000);
    return `${thousands.toLocaleString("en-US")}K yr/s`;
  }
  return `${Math.round(magnitude).toLocaleString("en-US")} yr/s`;
}

/**
 * Story #266: the increment `nudgeRateSliderValue` below moves the signed
 * rate slider value by on a single `<<`/`>>` press. `0.1` sits comfortably
 * mid-range of the issue's own suggested "not so small it takes many presses
 * to matter, not so large it jumps too abruptly" guidance for a `[-1, 1]`
 * control - ten presses sweep the full range end to end, each one a clearly
 * visible speed/direction change given `logSpeedSliderToYearsPerSecond`'s
 * logarithmic mapping. Live-tuned in the running viewer - see the PR
 * description.
 */
export const RATE_NUDGE_STEP = 0.1;

/**
 * One press of a `<<`/`>>` nudge button: moves the signed rate slider value
 * by `deltaSign * step`, clamped to `[-1, 1]` - `main.ts`'s
 * `handlePlayerRateNudge` applies the result directly to
 * `playerRateSliderValue`, touching no other player state (Story #266 AC:
 * nudging must never change `playing`). Pure and trivial by design, mirroring
 * `clampPlayerTimeYears`'s own single-clamp shape, so it's independently
 * unit-testable rather than inlined at `main.ts`'s two nudge-button call
 * sites.
 */
export function nudgeRateSliderValue(
  current: number,
  deltaSign: -1 | 1,
  step: number = RATE_NUDGE_STEP,
): number {
  return Math.max(-1, Math.min(1, current + deltaSign * step));
}

/**
 * Story #239 AC #8 (mirroring #231 AC #3's own `nextVelocityVectorsToggleOn`
 * pattern exactly): the player's next state given whether the camera is
 * currently inside the RECONS dense-batch sphere. Pure, so this specific
 * "leaving the sphere force-resets the whole player" business rule -
 * snapping the time back to Today/t=0 FIRST, then pausing and hiding the
 * panel, rather than leaving stars mid-animation - is independently unit
 * testable, mirroring `velocityVectors.ts`'s own `nextVelocityVectorsToggleOn`
 * precedent for the exact same "exit force-resets" shape of rule.
 *
 * While inside the sphere, every field of `state` passes through untouched -
 * this function makes no decisions at all about how time/play/panel-open
 * state evolves while the camera stays inside; that's `advancePlayerTimeYears`/
 * the panel's own event handlers' job. This function's only job is the
 * exit-triggered reset.
 */
export interface PlayerState {
  timeYears: number;
  playing: boolean;
  panelOpen: boolean;
}

export function nextPlayerStateForSphere(state: PlayerState, insideSphereNow: boolean): PlayerState {
  if (insideSphereNow) {
    return state;
  }
  return { timeYears: 0, playing: false, panelOpen: false };
}
