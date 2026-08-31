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
 * classic `|< < > >|` transport scheme - see `PlayerDirection`,
 * `nextPlayerPlaybackStateForDirectionButton`, `PLAYER_STEP_YEARS`, and
 * `stepPlayerTimeYears` below, and `logSpeedSliderToYearsPerSecond`'s
 * updated (now magnitude-only) docstring.
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
 * Epic #238's settled logarithmic speed-slider anchors, NASA "Eyes on the
 * Solar System" style - live-tuned starting point per the Epic's own
 * suggested ranges (slow end ~500-2,000 simulated years/real-second, fast
 * end able to sweep the full 2,000,000-year range in ~10-30 real seconds).
 * `MAX_YEARS_PER_REAL_SECOND` sweeps the full `[-1_000_000, 1_000_000]`
 * range in `2 * PLAYER_TIME_RANGE_YEARS / MAX_YEARS_PER_REAL_SECOND` ~ 13.3s,
 * comfortably inside that window; `MIN_YEARS_PER_REAL_SECOND` sits at the
 * suggested slow-end anchor. Both were also verified live in the running
 * viewer (see the PR description) rather than accepted on paper alone.
 */
export const MIN_YEARS_PER_REAL_SECOND = 1_000;
export const MAX_YEARS_PER_REAL_SECOND = 150_000;

/**
 * Maps a speed-slider control value (`[0, 1]`, MAGNITUDE only - see Story
 * #243) to an unsigned years-per-real-second playback RATE, logarithmic
 * between `MIN_YEARS_PER_REAL_SECOND` (`sliderValue` at or near 0) and
 * `MAX_YEARS_PER_REAL_SECOND` (`sliderValue = 1`).
 *
 * Logarithmic (not linear) interpolation is the entire point of this
 * function (Epic #238's explicit "NASA Eyes-on-Solar-System style" log-speed
 * requirement): equal slider DISTANCE near the slow end changes the rate by
 * a much smaller absolute (and even smaller relative-doesn't-apply;
 * relative/multiplicative) amount than the same slider distance near the
 * fast end - small movements read as "gentle" near slow, "a lot" near fast,
 * per Story #239's own live-verification AC.
 *
 * Story #243 changed this from a SIGNED `[-1, 1]` input (sign = direction)
 * to an unsigned `[0, 1]` magnitude: with the new |</></>| transport buttons,
 * direction is owned exclusively by which of `<`/`>` is currently active
 * (see `nextPlayerPlaybackStateForDirectionButton` below) - having the slider
 * ALSO carry a sign would be a second, potentially-disagreeing source of
 * truth for direction, which Story #243's AC explicitly calls out to avoid.
 * Callers (`main.ts`'s `applyPlayerAnimation`) multiply this unsigned rate by
 * the separately-tracked `PlayerDirection` (`1` or `-1`) to get the signed
 * rate `advancePlayerTimeYears` actually wants.
 *
 * `sliderValue` is clamped to `[0, 1]` defensively (a scrub event or
 * malformed input could otherwise hand this a wildly out-of-range value);
 * every normal caller (the panel's own `<input type="range" min="0"
 * max="1">`) never produces one outside that range in the first place.
 */
export function logSpeedSliderToYearsPerSecond(sliderValue: number): number {
  const magnitude = Math.max(0, Math.min(1, sliderValue));
  const logMin = Math.log(MIN_YEARS_PER_REAL_SECOND);
  const logMax = Math.log(MAX_YEARS_PER_REAL_SECOND);
  const logValue = logMin + magnitude * (logMax - logMin);
  return Math.exp(logValue);
}

/**
 * Story #243: which way the player currently plays (or would resume playing
 * in, if paused) - the ONE source of truth for playback direction, now that
 * `logSpeedSliderToYearsPerSecond` above is magnitude-only. `1` is forward
 * (matching the classic transport-bar `>` glyph), `-1` is backward (`<`).
 */
export type PlayerDirection = 1 | -1;

/**
 * Story #243: the fixed, discrete time step (years) the `|<`/`>|` step
 * buttons apply - a single nudge, not continuous playback. `20,000` sits
 * near the middle of the issue's own suggested 10,000-50,000-year starting
 * range: at the default forward speed-slider position it's a small fraction
 * of a second of continuous play, so it reads as a distinct, fine-grained
 * nudge rather than a big jump, while still being large enough (over 1% of
 * the trail's own 60,000-year `TRAIL_WINDOW_YEARS`, `motionTrail.ts`) to
 * visibly move the animated stars in a single press. Live-tuned in the
 * running viewer - see the PR description.
 */
export const PLAYER_STEP_YEARS = 20_000;

/**
 * One press of a step (`|<`/`>|`) button: advances `currentTimeYears` by a
 * single fixed `stepYears` in `direction`, reusing `advancePlayerTimeYears`
 * (with `deltaRealSeconds = 1`, `yearsPerRealSecond = direction * stepYears`)
 * rather than reimplementing its clamp-to-range/snap-exactly-to-zero-on-
 * crossing behavior a second time - a step that would cross or land on
 * Today snaps bit-exactly to `0`, exactly like a continuous-play frame that
 * does the same (Story #239's own settled "always land exactly on Today"
 * rule applies here too, not just during continuous play). The caller
 * (`main.ts`) is responsible for pausing first, per Story #243's AC ("press
 * a step button while playing pauses first, then steps") - this function
 * itself makes no decision about `playing` state, only about the resulting
 * `timeYears`.
 */
export function stepPlayerTimeYears(
  currentTimeYears: number,
  direction: PlayerDirection,
  stepYears: number = PLAYER_STEP_YEARS,
): number {
  return advancePlayerTimeYears(currentTimeYears, 1, direction * stepYears).timeYears;
}

/**
 * Story #243: the player's own playing/direction pair - `main.ts` is the
 * single source of truth for this, mirroring `PlayerState` above but kept as
 * its own smaller interface (this Story deliberately doesn't touch
 * `timeYears`/`panelOpen`, so folding this into `PlayerState` would make
 * `nextPlayerPlaybackStateForDirectionButton` below look like it decides
 * about fields it never touches).
 */
export interface PlayerPlaybackState {
  playing: boolean;
  direction: PlayerDirection;
}

/**
 * Story #243's core interaction rule for the `<`/`>` continuous-play
 * buttons, as a single pure decision: pressing the button matching the
 * CURRENTLY playing direction pauses (standard toggle-off); pressing the
 * OPPOSITE direction's button - whether currently playing the other way, or
 * already paused - (re)starts playing in the pressed direction, reversing
 * without requiring a separate pause click first. Also covers "paused, press
 * either button" (not currently playing, so `current.direction ===
 * pressedDirection` is false regardless of the paused-at direction) - that
 * case simply starts playing in the pressed direction too, per the same
 * "else" branch.
 */
export function nextPlayerPlaybackStateForDirectionButton(
  current: PlayerPlaybackState,
  pressedDirection: PlayerDirection,
): PlayerPlaybackState {
  if (current.playing && current.direction === pressedDirection) {
    return { playing: false, direction: current.direction };
  }
  return { playing: true, direction: pressedDirection };
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
