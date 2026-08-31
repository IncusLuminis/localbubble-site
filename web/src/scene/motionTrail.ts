import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { clampPlayerTimeYears, starPositionAtTime } from "./motionPlayer";
import type { PlayerDirection } from "./motionPlayer";
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
 *
 * Story #243 Part 3 (polish, post-merge): the original plain `THREE.Line`
 * rendering read as too faint/thin against the starfield (human owner's own
 * live-testing complaint - see the PR description). Root cause: plain
 * `THREE.Line`/`LineBasicMaterial` renders through `gl.LINES`, which every
 * major browser's ANGLE/WebGL backend caps at a hard 1-CSS-pixel width
 * regardless of `material.linewidth` (a decade-old, still-unfixed WebGL
 * limitation, NOT a three.js bug - three.js's own `Line2`/`LineMaterial`
 * fat-line solution exists specifically to work around it). Rather than pull
 * in `Line2`/`LineGeometry`/`LineMaterial` (which would need a `resolution`
 * uniform kept in sync with the renderer's pixel size across ~127 per-star
 * materials, AND doesn't support the original's per-vertex alpha fade -
 * `LineMaterial` only exposes a single scalar `opacity` uniform, not a
 * `vColor` alpha channel), `createMotionTrailsLayer`/`updateStarTrail` below
 * now build each trail as a small camera-facing RIBBON MESH (a
 * `MeshBasicMaterial` triangle strip, billboarded per vertex toward the
 * camera every frame) - real triangle geometry with a genuinely
 * configurable width, no `gl.LINES` 1px ceiling involved at all, and it
 * keeps the original's per-vertex RGBA fade working exactly as before (a
 * `vec4` vertex-color attribute IS supported for ordinary meshes). This
 * also matches this app's own established "small purpose-built geometry
 * over library shortcuts" convention (`structures.ts`,
 * `denseBatchBoundary.ts`, `sunMarker` all build their own small meshes
 * rather than reaching for a three.js examples/ helper) more closely than
 * pulling in the `lines/` example module would.
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
 * Number of ribbon segments per trail (so `TRAIL_SEGMENT_COUNT + 1` sampled
 * cross-sections, each `2` mesh vertices wide - Story #243 Part 3) - smooth
 * enough to read as a curved recent path (velocity is extrapolated linearly
 * per star, but many stars' trails will still show a visibly straight line
 * at this scale; segments matter mainly for a clean, even opacity gradient)
 * while staying cheap: `127 stars * (TRAIL_SEGMENT_COUNT + 1)` position
 * evaluations per frame is trivial (~3,175 at this value), and per-star
 * `Mesh` objects (not a shared InstancedMesh/batched buffer) match
 * `velocityVectors.ts`'s own precedent of not forcing ~127 objects into an
 * instanced system, per this Story's AC.
 */
export const TRAIL_SEGMENT_COUNT = 24;

/**
 * Story #243 Part 3: the ribbon's angular half-width (radians), applied as
 * `halfWidthPc = TRAIL_ANGULAR_HALF_WIDTH_RAD * distanceFromCameraPc` at
 * each vertex (`updateStarTrail` below) - scaling with camera distance
 * (rather than a single fixed pc width) keeps the trail reading as a
 * consistent, clearly-visible ribbon at both the app's close-up and
 * zoomed-out camera presets, the same way `Line2`'s screen-space width
 * would, without needing a `resolution` uniform. `0.004` rad (~0.23 degrees
 * of half-angle, ~0.46 degrees full width) was live-tuned in the running
 * viewer: an initial `0.01` read as clearly visible but too heavy at
 * typical dense-batch-sphere zoom (fast movers' multi-parsec-long trails
 * came out as thick, label-width bars that started to visually compete with
 * the star markers and crowd the view when several were on screen at once);
 * this value keeps the same "definitely no longer a 1px hairline" win while
 * reading as a genuinely thin ribbon/streak - see the PR description for
 * the before/after screenshots this was checked against.
 */
export const TRAIL_ANGULAR_HALF_WIDTH_RAD = 0.004;

/**
 * Opacity at the trail's oldest (tail) vertex - Story #243 Part 3: raised
 * from `0` (fully transparent) to a visible floor, per the issue's own
 * "a higher opacity floor... may help regardless of line width" suggestion -
 * the human owner's complaint was that trails "get lost" against the
 * starfield, and a tail that fades all the way to nothing was part of that
 * (the oldest, most sparsely-sampled stretch of a fast-moving star's trail
 * could read as barely-there even before it visually reached the true tail
 * cutoff). Still well below `MAX_TRAIL_OPACITY` so the fade gradient (and
 * the "which end is the current position" cue it gives) is clearly
 * preserved - only the FLOOR moved, not the fade itself. */
const MIN_TRAIL_OPACITY = 0.25;

/** Opacity at the trail's newest (front) vertex, exactly at the star's
 * current animated marker position - near-solid, deliberately just below
 * `velocityVectors.ts`'s `FULL_VECTOR_OPACITY` (0.9) so a trail never reads
 * as "more solid" than that module's own full 3D vectors would (the two are
 * never visible at the same time per Epic #238's "visually incompatible"
 * rule, but this keeps the two effects' visual weight consistent on
 * principle). */
const MAX_TRAIL_OPACITY = 0.85;

/**
 * Story #243 Part 3: a brighter, more saturated amber than the original
 * `0xffcc66` gold - the same warm hue (still reads as a distinct "light
 * streak" color, not confusable with `velocityVectors.ts`'s green
 * (0x39ff6a)/coral (0xff5c3d), `structures.ts`'s orange Gould Belt/cyan
 * Radcliffe Wave/violet Local Bubble, `denseBatchBoundary.ts`'s blue-grey,
 * or the OBAFGKM star marker colors themselves), just pushed toward a
 * hotter, higher-contrast amber so it doesn't wash out against the
 * starfield's own whites/blues at typical brightness - live-verified
 * against a starfield screenshot alongside the width/opacity changes above
 * (see the PR description).
 */
const TRAIL_COLOR = 0xffb833;

/**
 * The trail's window start (years) given the player's current absolute
 * simulated time - the OLDEST end of the trail (in real-animation-time
 * terms: the end the star passed through LONGER ago, chronologically before
 * `currentTimeYears`, the trail's NEWEST end - always exactly the star's
 * current animated position, see `starTrailPositionsPc` below).
 *
 * Story #247 (fixing a real bug from #243/#246's live-testing): this must be
 * driven by the CURRENT PLAYBACK DIRECTION (`direction`, `main.ts`'s
 * `playerDirection` - `1 | -1`), not by `sign(currentTimeYears)`. Those two
 * only coincide in the single simplest case (started exactly at Today and
 * has been playing in the direction that keeps them matching the whole
 * time); in general - e.g. playing BACKWARD from Today, so `direction ===
 * -1` while `currentTimeYears` is negative - they diverge, and the old
 * formula (`currentTimeYears - distanceFromTodayYears`, no `direction` term)
 * silently assumed `direction === sign(currentTimeYears)` and got the
 * trail's orientation backwards: at `currentTimeYears = -5000, windowYears =
 * 60000` it computed `-10000` (extending further negative - AHEAD of a
 * backward-moving star, toward where it's HEADING) instead of the correct
 * `0` (Today - BEHIND it, where it started and has been moving away from).
 * The general, direction-driven formula:
 * ```
 * distanceFromTodayYears = min(|currentTimeYears|, windowYears)
 * oldestEnd = currentTimeYears - direction * distanceFromTodayYears
 * ```
 * Consequently the OLD "always `<= currentTimeYears`" invariant only holds
 * for `direction === 1`; for `direction === -1` the oldest end is instead
 * always `>= currentTimeYears` (numerically "ahead" of the current position
 * along the number line, since a backward-playing star's numerically-larger
 * past values are chronologically OLDER in real-animation-time) - see this
 * function's own test suite for both cases spelled out against concrete
 * reference points, including the human owner's own worked backward-from-
 * Today example above. The already-correct forward-from-Today case is
 * unaffected: at `direction === 1`, `oldestEnd = currentTimeYears -
 * distanceFromTodayYears`, identical to the pre-fix formula.
 *
 * Distance-from-Today-capped (`Math.min(Math.abs(currentTimeYears),
 * windowYears)`) rather than a flat `currentTimeYears - direction *
 * windowYears`: this is what makes the trail visibly GROW from zero length
 * right as playback leaves Today in EITHER direction (AC: "play forward,
 * trail grows to its fixed max length then holds") rather than appearing at
 * (near) full length on the very first frame after Today - and, by the same
 * formula run in reverse, makes it visibly SHRINK back toward zero length as
 * playback approaches Today again (from either side), which combines with
 * `isTrailVisible`'s hard cutoff at exactly `0` to make "return to Today
 * fully clears all trails" read as a smooth retraction rather than an
 * abrupt disappearance. Once `|currentTimeYears| >= windowYears` the cap is
 * inactive and the window is the plain fixed-length window anchored at
 * `currentTimeYears`, offset by `direction * windowYears` (the "holds" half
 * of that same AC).
 *
 * Clamped through `clampPlayerTimeYears` (Epic #238's settled
 * `+/-1,000,000`-year range) defensively - `currentTimeYears - direction *
 * distanceFromTodayYears` can land slightly outside that range for a
 * `currentTimeYears` near either boundary, since `distanceFromTodayYears`
 * is capped at `windowYears`, not at how close `currentTimeYears` already
 * is to the boundary itself.
 */
export function trailWindowStartYears(
  currentTimeYears: number,
  direction: PlayerDirection,
  windowYears: number = TRAIL_WINDOW_YEARS,
): number {
  const distanceFromTodayYears = Math.min(Math.abs(currentTimeYears), windowYears);
  return clampPlayerTimeYears(currentTimeYears - direction * distanceFromTodayYears);
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
  direction: PlayerDirection,
  windowYears: number = TRAIL_WINDOW_YEARS,
  segmentCount: number = TRAIL_SEGMENT_COUNT,
): number[] {
  if (currentTimeYears === 0) {
    return [];
  }
  const startYears = trailWindowStartYears(currentTimeYears, direction, windowYears);
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
  direction: PlayerDirection,
  windowYears: number = TRAIL_WINDOW_YEARS,
  segmentCount: number = TRAIL_SEGMENT_COUNT,
): Array<[number, number, number]> {
  return trailSampleTimesYears(currentTimeYears, direction, windowYears, segmentCount).map((tYears) =>
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
 * ribbon `Mesh` added to the scene graph (Story #243 Part 3 - previously a
 * plain `Line`), and its position buffer attribute - `updateStarTrail`
 * below writes fresh, camera-billboarded positions into `positionAttr`
 * every frame; the color attribute (the fade gradient) and the index buffer
 * (the ribbon's triangle pattern) are both written once at construction and
 * never change. */
export interface StarTrail {
  objectId: string;
  mesh: Mesh;
  positionAttr: Float32BufferAttribute;
  /** Number of sampled cross-sections along the trail
   * (`TRAIL_SEGMENT_COUNT + 1`) - NOT the mesh's actual vertex count (`2x`
   * this: one pair of left/right ribbon-edge vertices per cross-section) -
   * `updateStarTrail` iterates this many `positionsPc` entries. */
  sampleCount: number;
}

/**
 * Builds the full motion-trails layer: one ribbon `Mesh` per Story #239's
 * `starsWithVelocityInSphere` result (passed in as `animatedStars`, reused
 * directly - never reimplemented), each with `TRAIL_SEGMENT_COUNT + 1`
 * sampled cross-sections (`2` mesh vertices each, the ribbon's left/right
 * edges) and a baked-once RGBA vertex-color fade gradient (`MIN_TRAIL_OPACITY`
 * at the oldest end to `MAX_TRAIL_OPACITY` at the newest/current-position
 * end, the same value duplicated across both edge vertices at a given
 * cross-section). The index buffer (two triangles per segment, the ribbon's
 * quad strip) is also static and identical for every trail - built once
 * from `TRAIL_SEGMENT_COUNT` alone and shared read-only across every
 * geometry, since only each trail's POSITIONS differ. Positions start at
 * the origin (all zero); `main.ts`'s `applyPlayerAnimation` writes real,
 * camera-billboarded positions via `updateStarTrail` every frame before
 * anything is ever visible (the group starts `visible = false`, matching
 * `velocityVectors.ts`'s own `createVelocityVectorsLayer` convention), so
 * no stale/zero geometry is ever shown.
 *
 * `mesh.frustumCulled = false` on each trail: the geometry's bounding
 * sphere is never recomputed after construction (cheap to skip for ~127
 * short trails updated every frame; recomputing it every frame for every
 * trail would be needless per-frame CPU work for a purely visual effect),
 * so leaving frustum culling on could incorrectly cull a trail against its
 * stale (all-zero, at construction time) bounding sphere. `side: DoubleSide`:
 * the ribbon is billboarded toward the camera every frame
 * (`updateStarTrail` below), so it should normally always face the camera,
 * but rendering both faces is cheap insurance against a one-frame flicker
 * from a fast camera pan/orbit catching a ribbon from behind before the
 * next update.
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
  const sampleCount = TRAIL_SEGMENT_COUNT + 1;
  const vertexCount = sampleCount * 2;
  const trailColor = new Color(TRAIL_COLOR);

  // Every trail shares this exact triangle-strip-as-triangles index
  // pattern - built once and reused (read-only) across every mesh's
  // geometry, rather than rebuilt per star.
  const indices = new Uint16Array(TRAIL_SEGMENT_COUNT * 6);
  for (let i = 0; i < TRAIL_SEGMENT_COUNT; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices[i * 6] = a;
    indices[i * 6 + 1] = b;
    indices[i * 6 + 2] = c;
    indices[i * 6 + 3] = b;
    indices[i * 6 + 4] = d;
    indices[i * 6 + 5] = c;
  }

  for (const obj of animatedStars) {
    if (!obj.velocity) {
      continue;
    }

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    for (let i = 0; i < sampleCount; i++) {
      const fraction = i / (sampleCount - 1);
      const opacity = MIN_TRAIL_OPACITY + (MAX_TRAIL_OPACITY - MIN_TRAIL_OPACITY) * fraction;
      // Both ribbon-edge vertices at this cross-section get the same
      // color/opacity - the fade runs along the trail's LENGTH, not across
      // its width.
      for (let edge = 0; edge < 2; edge++) {
        const v = i * 2 + edge;
        colors[v * 4] = trailColor.r;
        colors[v * 4 + 1] = trailColor.g;
        colors[v * 4 + 2] = trailColor.b;
        colors[v * 4 + 3] = opacity;
      }
    }

    const geometry = new BufferGeometry();
    const positionAttr = new Float32BufferAttribute(positions, 3);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
    geometry.setIndex(new Uint16BufferAttribute(indices, 1));

    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = `motion-trail-${obj.id}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);

    trails.set(obj.id, { objectId: obj.id, mesh, positionAttr, sampleCount });
  }

  return { group, trails };
}

/** Reused scratch vectors for `updateStarTrail`'s per-vertex billboard math
 * below - module-scoped rather than allocated fresh per call/per vertex,
 * since `main.ts`'s animation loop calls this ~127 times every frame and
 * per-frame GC churn from throwaway `Vector3`s would be wasteful for a
 * purely visual effect. Safe to share across every trail and frame: each is
 * fully overwritten before being read on every use, never carries state
 * between calls. */
const scratchTangent = new Vector3();
const scratchToCamera = new Vector3();
const scratchRight = new Vector3();

/**
 * Writes `positionsPc` (oldest first, newest/current-marker-position last -
 * `starTrailPositionsPc`'s own ordering) into `trail`'s ribbon position
 * buffer and flags it for a GPU re-upload.
 *
 * Story #243 Part 3: each sampled position becomes TWO mesh vertices (the
 * ribbon's left/right edges), offset from the sampled point along a
 * per-vertex camera-billboarded `right` vector (`tangent x toCamera`, so
 * the ribbon stays camera-facing under any viewing angle rather than a
 * single flat plane that could go edge-on and vanish), scaled by
 * `TRAIL_ANGULAR_HALF_WIDTH_RAD * distanceFromCameraPc` - distance-scaled so
 * the ribbon reads as a consistently visible width whether the camera is
 * zoomed in close or pulled far out, the same visual goal `Line2`'s
 * screen-space width serves. `tangent` at each sample is the (normalized)
 * direction from its previous to its next neighbor (a plain forward/
 * backward difference at the two endpoints); a near-zero tangent, or a
 * `toCamera` direction nearly parallel to it (the ribbon viewed almost
 * end-on), both fall back to an arbitrary perpendicular rather than
 * producing a degenerate (zero-length/NaN) `right` vector for that vertex.
 *
 * A `positionsPc` shorter than `trail.sampleCount` (only possible at
 * exactly Today, where `starTrailPositionsPc` returns an empty array -
 * `main.ts` skips calling this at all in that case, hiding the trail
 * instead, but this guards defensively) leaves the remaining buffer entries
 * untouched rather than throwing.
 */
export function updateStarTrail(
  trail: StarTrail,
  positionsPc: ReadonlyArray<readonly [number, number, number]>,
  cameraPositionPc: Vector3,
): void {
  const array = trail.positionAttr.array as Float32Array;
  const count = Math.min(positionsPc.length, trail.sampleCount);

  for (let i = 0; i < count; i++) {
    const p = positionsPc[i];
    const prev = positionsPc[Math.max(0, i - 1)];
    const next = positionsPc[Math.min(positionsPc.length - 1, i + 1)];

    scratchTangent.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (scratchTangent.lengthSq() < 1e-12) {
      scratchTangent.set(1, 0, 0);
    } else {
      scratchTangent.normalize();
    }

    const dx = cameraPositionPc.x - p[0];
    const dy = cameraPositionPc.y - p[1];
    const dz = cameraPositionPc.z - p[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    scratchToCamera.set(dx / distance, dy / distance, dz / distance);

    scratchRight.crossVectors(scratchTangent, scratchToCamera);
    if (scratchRight.lengthSq() < 1e-12) {
      // The ribbon's tangent and the view direction are (near-)parallel at
      // this vertex - fall back to an arbitrary perpendicular to the
      // tangent so the ribbon edge stays stable rather than collapsing to
      // zero width for a frame.
      scratchRight.set(-scratchTangent.y, scratchTangent.x, 0);
      if (scratchRight.lengthSq() < 1e-12) {
        scratchRight.set(0, -scratchTangent.z, scratchTangent.y);
      }
    }
    scratchRight.normalize();

    const halfWidth = TRAIL_ANGULAR_HALF_WIDTH_RAD * distance;
    const leftIndex = i * 2;
    const rightIndex = i * 2 + 1;
    array[leftIndex * 3] = p[0] - scratchRight.x * halfWidth;
    array[leftIndex * 3 + 1] = p[1] - scratchRight.y * halfWidth;
    array[leftIndex * 3 + 2] = p[2] - scratchRight.z * halfWidth;
    array[rightIndex * 3] = p[0] + scratchRight.x * halfWidth;
    array[rightIndex * 3 + 1] = p[1] + scratchRight.y * halfWidth;
    array[rightIndex * 3 + 2] = p[2] + scratchRight.z * halfWidth;
  }
  trail.positionAttr.needsUpdate = true;
}
