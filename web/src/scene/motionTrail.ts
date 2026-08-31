import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
} from "three";
import { clampPlayerTimeYears, starPositionAtTime } from "./motionPlayer";
import type { SceneObject, SceneVelocity } from "./sceneTypes";

/**
 * Story #240 (Epic #238's Story 2 of 2): a fixed-simulated-time-window
 * motion trail behind each of Story #239's ~127 animated stars, so
 * speed/direction reads at a glance during playback. Reuses
 * `motionPlayer.ts`'s `starPositionAtTime`/`clampPlayerTimeYears` directly
 * (never reimplemented) and is driven from `main.ts`'s existing
 * `applyPlayerAnimation` per-frame hook - no second RAF hook, per this
 * Story's explicit instruction.
 *
 * Split the same way `velocityVectors.ts` is: the pure position/windowing
 * math below (`trailWindowStartYears`/`trailSampleTimesYears`/
 * `starTrailPositionsPc`/`isTrailVisible`) is directly unit-testable under
 * this repo's `environment: "node"` Vitest config; `createMotionTrailsLayer`/
 * `updateStarTrail` below that touch Three.js are not.
 */

/**
 * The trail's fixed simulated-time window (years) - Epic #238's/this
 * Story's "same window N for every star regardless of its own speed"
 * requirement (explicitly NOT scaled per-star). `60,000` is 3% of the full
 * 2,000,000-year (`+/-1,000,000`) range - the issue's own suggested "low
 * single-digit percent" starting point. Checked against this Story's actual
 * dataset (`public/data/scene.json`, same 127-star population Epic #238's
 * own writeup cites): the median in-sphere mover (~40 km/s) crosses the
 * ~11.26pc sphere in ~270,000 simulated years, so a 60,000-year trail reads
 * as a clearly-visible but modest fraction (~22%) of that crossing - a
 * short "recent path", not most of it. The fastest movers (Kapteyn's Star
 * ~293 km/s, ~38,000-year crossing; Barnard's Star ~142 km/s, ~78,000-year
 * crossing) get trails comparable to or a bit longer than their own
 * crossing time, which is the CORRECT and expected consequence of a
 * fixed-time (not fixed-distance) window per this Story's AC - their trails
 * simply span more physical distance, exactly what makes speed differences
 * readable. Live-verified in the running viewer at "Fit to nearest-stars
 * sphere" zoom (see the PR description); adjust here if it ever reads too
 * long/short.
 */
export const TRAIL_WINDOW_YEARS = 60_000;

/**
 * Number of line segments per trail (so `TRAIL_SEGMENT_COUNT + 1` sampled
 * positions/vertices) - smooth enough to read as a curved recent path
 * (velocity is extrapolated linearly per star, but many stars' trails will
 * still show a visibly straight line at this scale; segments matter mainly
 * for a clean, even opacity gradient) while staying cheap: `127 stars *
 * (TRAIL_SEGMENT_COUNT + 1)` position evaluations per frame is trivial
 * (~3,175 at this value), and per-star `Line` objects (not a shared
 * InstancedMesh/batched buffer) match `velocityVectors.ts`'s own precedent
 * of not forcing ~127 objects into an instanced system, per this Story's AC.
 */
export const TRAIL_SEGMENT_COUNT = 24;

/** Opacity at the trail's oldest (tail) vertex - fully transparent, so the
 * trail visibly fades to nothing rather than ending in a hard cut. */
const MIN_TRAIL_OPACITY = 0;

/** Opacity at the trail's newest (front) vertex, exactly at the star's
 * current animated marker position - near-solid, deliberately just below
 * `velocityVectors.ts`'s `FULL_VECTOR_OPACITY` (0.9) so a trail never reads
 * as "more solid" than that module's own full 3D vectors would (the two are
 * never visible at the same time per Epic #238's "visually incompatible"
 * rule, but this keeps the two effects' visual weight consistent on
 * principle). */
const MAX_TRAIL_OPACITY = 0.85;

/** A warm gold/amber, chosen to read as a light streak distinct from every
 * other color already in this app's palette: `velocityVectors.ts`'s green
 * (0x39ff6a)/coral (0xff5c3d), `structures.ts`'s orange Gould Belt/cyan
 * Radcliffe Wave/violet Local Bubble, `denseBatchBoundary.ts`'s blue-grey -
 * and from the OBAFGKM star marker colors themselves (`spectralColor.ts`,
 * all blue/white/yellow/orange/red), so a trail never reads as "just
 * another star color" any more than a velocity arrow does. */
const TRAIL_COLOR = 0xffcc66;

/**
 * The trail's window start (years) given the player's current absolute
 * simulated time - the OLDEST end of the trail, chronologically before
 * `currentTimeYears` (the trail's NEWEST end, always exactly the star's
 * current animated position - see `starTrailPositionsPc` below). Always
 * `<= currentTimeYears` for any sign of `currentTimeYears` (subtracts a
 * non-negative distance), so a trail is never chronologically backwards.
 *
 * Distance-from-Today-capped (`Math.min(Math.abs(currentTimeYears),
 * windowYears)`) rather than a flat `currentTimeYears - windowYears`: this
 * is what makes the trail visibly GROW from zero length right as playback
 * leaves Today in EITHER direction (AC: "play forward, trail grows to its
 * fixed max length then holds") rather than appearing at (near) full length
 * on the very first frame after Today - and, by the same formula run in
 * reverse, makes it visibly SHRINK back toward zero length as playback
 * approaches Today again (from either side), which combines with
 * `isTrailVisible`'s hard cutoff at exactly `0` to make "return to Today
 * fully clears all trails" read as a smooth retraction rather than an
 * abrupt disappearance. Once `|currentTimeYears| >= windowYears` the cap is
 * inactive and the window is the plain fixed-length `[currentTimeYears -
 * windowYears, currentTimeYears]` (the "holds" half of that same AC).
 *
 * Clamped through `clampPlayerTimeYears` (Epic #238's settled
 * `+/-1,000,000`-year range) defensively - `currentTimeYears -
 * distanceFromTodayYears` can land slightly outside that range for a
 * `currentTimeYears` near either boundary, since `distanceFromTodayYears`
 * is capped at `windowYears`, not at how close `currentTimeYears` already
 * is to the boundary itself.
 */
export function trailWindowStartYears(
  currentTimeYears: number,
  windowYears: number = TRAIL_WINDOW_YEARS,
): number {
  const distanceFromTodayYears = Math.min(Math.abs(currentTimeYears), windowYears);
  return clampPlayerTimeYears(currentTimeYears - distanceFromTodayYears);
}

/**
 * `segmentCount + 1` sample times (years), evenly spaced from the trail's
 * oldest end (`trailWindowStartYears`, index 0) to its newest end
 * (`currentTimeYears` itself, the last index - exactly the star's current
 * animated position, so the trail's front vertex always coincides with the
 * marker with no gap/seam). Returns an empty array at exactly `currentTimeYears
 * === 0` (Today) - `isTrailVisible` below is the single source of truth for
 * that "no trail at Today" rule, but this also protects
 * `starTrailPositionsPc`'s caller from building a zero-length/degenerate
 * geometry update for a trail that should be fully hidden anyway.
 */
export function trailSampleTimesYears(
  currentTimeYears: number,
  windowYears: number = TRAIL_WINDOW_YEARS,
  segmentCount: number = TRAIL_SEGMENT_COUNT,
): number[] {
  if (currentTimeYears === 0) {
    return [];
  }
  const startYears = trailWindowStartYears(currentTimeYears, windowYears);
  const times: number[] = [];
  for (let i = 0; i <= segmentCount; i++) {
    const fraction = i / segmentCount;
    times.push(startYears + (currentTimeYears - startYears) * fraction);
  }
  return times;
}

/**
 * One star's trail positions (pc), oldest first / newest (current marker
 * position) last - `trailSampleTimesYears`'s sample times run through the
 * SAME `starPositionAtTime` the marker animation itself uses (never a
 * separate/duplicated extrapolation), so the trail is always the star's
 * ACTUAL path, correct on a discontinuous scrub jump exactly like the
 * marker is: both are recomputed fresh from `positionPc`/`velocityKms`
 * every call, with no history buffer that could go stale or reflect
 * positions never actually animated through frame-by-frame (this Story's
 * AC).
 */
export function starTrailPositionsPc(
  positionPc: readonly [number, number, number],
  velocityKms: Pick<SceneVelocity, "vx_kms" | "vy_kms" | "vz_kms">,
  currentTimeYears: number,
  windowYears: number = TRAIL_WINDOW_YEARS,
  segmentCount: number = TRAIL_SEGMENT_COUNT,
): Array<[number, number, number]> {
  return trailSampleTimesYears(currentTimeYears, windowYears, segmentCount).map((tYears) =>
    starPositionAtTime(positionPc, velocityKms, tYears),
  );
}

/**
 * Whether trails should render at all: exactly Story #239's own
 * `isUiLockedForPlayerTime` predicate (`tYears !== 0`), but kept as its own
 * named, exported function here rather than importing that one directly -
 * the two happen to share a formula but are conceptually independent
 * decisions (one gates the OTHER app controls, this one gates trail
 * visibility) that could diverge in the future without this Story's own
 * "clear fully at Today" AC silently riding on an unrelated module's
 * predicate. This is the single source of truth `main.ts` checks both for
 * the whole trails `Group` and per-star as a defensive belt-and-suspenders
 * (the per-star geometry update itself already returns an empty array at
 * `tYears === 0`, per `trailSampleTimesYears` above).
 */
export function isTrailVisible(currentTimeYears: number): boolean {
  return currentTimeYears !== 0;
}

/** One animated star's trail: the `SceneObject.id` it belongs to, the
 * `Line` added to the scene graph, and its position/color buffer attributes
 * - `updateStarTrail` below writes fresh positions into `positionAttr` every
 * frame; `colorAttr` (the fade gradient) is written once at construction
 * and never changes. */
export interface StarTrail {
  objectId: string;
  line: Line;
  positionAttr: Float32BufferAttribute;
}

/**
 * Builds the full motion-trails layer: one `Line` per Story #239's
 * `starsWithVelocityInSphere` result (passed in as `animatedStars`, reused
 * directly - never reimplemented), each with `TRAIL_SEGMENT_COUNT + 1`
 * vertices and a baked-once RGBA vertex-color fade gradient (transparent at
 * the oldest end to `MAX_TRAIL_OPACITY` at the newest/current-position end)
 * - a plain fading-vertex-colors `Line` per the issue's own suggested
 * approach over a custom shader. Positions start at the origin (all zero);
 * `main.ts`'s `applyPlayerAnimation` writes real positions via
 * `updateStarTrail` every frame before anything is ever visible (the group
 * starts `visible = false`, matching `velocityVectors.ts`'s own
 * `createVelocityVectorsLayer` convention), so no stale/zero geometry is
 * ever shown.
 *
 * `line.frustumCulled = false` on each trail: the geometry's bounding
 * sphere is never recomputed after construction (cheap to skip for ~127
 * short trails updated every frame; recomputing it every frame for every
 * trail would be needless per-frame CPU work for a purely visual effect),
 * so leaving frustum culling on could incorrectly cull a trail against its
 * stale (all-zero, at construction time) bounding sphere.
 *
 * Always returns a real (possibly empty) group, same "never null"
 * convention as `createVelocityVectorsLayer`/`createVelocitySpeedLabelsLayer`.
 */
export function createMotionTrailsLayer(
  animatedStars: readonly SceneObject[],
): { group: Group; trails: Map<string, StarTrail> } {
  const group = new Group();
  group.name = "motion-trails";
  group.visible = false;

  const trails = new Map<string, StarTrail>();
  const vertexCount = TRAIL_SEGMENT_COUNT + 1;
  const trailColor = new Color(TRAIL_COLOR);

  for (const obj of animatedStars) {
    if (!obj.velocity) {
      continue;
    }

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i++) {
      const fraction = i / (vertexCount - 1);
      const opacity = MIN_TRAIL_OPACITY + (MAX_TRAIL_OPACITY - MIN_TRAIL_OPACITY) * fraction;
      colors[i * 4] = trailColor.r;
      colors[i * 4 + 1] = trailColor.g;
      colors[i * 4 + 2] = trailColor.b;
      colors[i * 4 + 3] = opacity;
    }

    const geometry = new BufferGeometry();
    const positionAttr = new Float32BufferAttribute(positions, 3);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));

    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    const line = new Line(geometry, material);
    line.name = `motion-trail-${obj.id}`;
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);

    trails.set(obj.id, { objectId: obj.id, line, positionAttr });
  }

  return { group, trails };
}

/**
 * Writes `positionsPc` (oldest first, newest/current-marker-position last -
 * `starTrailPositionsPc`'s own ordering) into `trail`'s position buffer and
 * flags it for a GPU re-upload. A `positionsPc` shorter than the buffer
 * (only possible at exactly Today, where `starTrailPositionsPc` returns an
 * empty array - `main.ts` skips calling this at all in that case, hiding
 * the trail instead, but this guards defensively) leaves the remaining
 * buffer entries untouched rather than throwing.
 */
export function updateStarTrail(
  trail: StarTrail,
  positionsPc: ReadonlyArray<readonly [number, number, number]>,
): void {
  const array = trail.positionAttr.array as Float32Array;
  const count = Math.min(positionsPc.length, trail.positionAttr.count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = positionsPc[i];
    array[i * 3] = x;
    array[i * 3 + 1] = y;
    array[i * 3 + 2] = z;
  }
  trail.positionAttr.needsUpdate = true;
}
