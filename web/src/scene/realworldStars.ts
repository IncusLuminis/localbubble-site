import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from "three";
import type { SceneObject } from "./sceneTypes";
import { isCatalogObjectVisible } from "./objects";
import { spectralColorFor } from "./spectralColor";
import { absoluteMagnitudeToRealworldStyle } from "./magnitudeBrightness";
import {
  getStarTwinkleAtlasTexture,
  getTunableStarTwinkleAtlasTexture,
  redrawStarTwinkleAtlas,
} from "./starTwinkle";

/**
 * Issue #11 (Epic #7, Story 2/4): REALWORLD's own star-bucket rendering - a
 * single `THREE.Points` object (one draw call for the whole catalog,
 * currently ~707 stars) using a custom `ShaderMaterial` rather than the
 * stock `THREE.PointsMaterial`, because `PointsMaterial.size` is a single
 * per-MATERIAL uniform, not per-vertex - it cannot express "this star's
 * sprite should be 6x bigger than that one's," which is the entire point of
 * this Story's magnitude-driven size table (`magnitudeBrightness.ts`'s
 * `absoluteMagnitudeToRealworldStyle`). A custom vertex shader reading a
 * per-vertex `aSize` attribute is the standard, well-established Three.js
 * pattern for per-point size variation (see e.g. the upstream
 * "webgl_custom_attributes_points" example) and keeps the whole catalog in
 * ONE draw call regardless of how many distinct size/color/variant
 * combinations exist - unlike an alternative considered (one `THREE.Points`
 * object per magnitude bucket, using stock `PointsMaterial.size` per bucket)
 * which would still work but costs 8 draw calls instead of 1 for no
 * offsetting benefit, given how straightforward the custom-attribute
 * approach turned out to be.
 *
 * This is a completely separate rendering path from `objects.ts`'s
 * `CatalogBucket`/`InstancedMesh` system (MODEL's own star bucket, and every
 * other catalog `object_type` bucket, in both styles) - deliberately NOT
 * shoehorned into `CatalogBucket`'s shape (which hard-codes `InstancedMesh`-
 * specific APIs - `setMatrixAt`, `instanceColor`, per-instance zero-scale
 * hiding - throughout `objects.ts`/`picking.ts`) because `THREE.Points`
 * doesn't have per-instance transform matrices at all; forcing the two
 * systems to share one interface would mean sprinkling
 * `instanceof Points ? ... : ...` branches through every function that walks
 * `CatalogBucket[]` today. `main.ts` instead holds this module's own
 * `RealworldStarLayer` as a second, independent piece of star-rendering
 * state, built/rebuilt/toggled alongside (not through) `catalogBuckets` -
 * see that file's `rebuildStarRenderLayer`.
 *
 * Per this Story's explicit scope, this module does NOT implement:
 *  - Zone-crossing brightness-ordered reveal/fade as the camera crosses
 *    Local-Bubble/RECONS-sphere boundaries (Story #12's job) - every star
 *    passing the existing category/radius-filter visibility rule
 *    (`objects.ts`'s `isCatalogObjectVisible`) is simply visible together,
 *    with no additional camera-distance-gated hide/reveal logic layered on
 *    top. Concretely: `updateRealworldStarVisibility` below calls
 *    `isCatalogObjectVisible` WITHOUT camera-distance/dense-batch-radius
 *    arguments (both default to `Number.POSITIVE_INFINITY`), which resolves
 *    `lod.ts`'s `passesDenseBatchLod` to always `true` for every RECONS
 *    dense-batch member regardless of the real camera position - i.e. this
 *    deliberately skips MODEL's own dense-batch camera-proximity LOD gating
 *    too (a pre-existing, distance-based show/hide mechanism, unrelated to
 *    Story #12's NEW brightness-ordered reveal), so the full ~707-star
 *    catalog (matching this Story's own "confirm reasonable performance with
 *    the full ~820-star catalog visible" verification requirement) renders
 *    at once under REALWORLD regardless of where the camera is.
 *  - Picking/click-to-inspect - see `main.ts`'s own docstring on why this
 *    layer isn't registered with `picking.ts`'s `pickSceneObject` in this
 *    Story.
 *  - The Time Controls motion player's per-frame animated-star repositioning
 *    (`main.ts`'s `objectIndexLookup`/`CatalogObjectRef`, Story #239) - that
 *    lookup is built from `catalogBuckets` alone (`buildObjectIndexLookup`),
 *    which has no entry for any star while REALWORLD is active (this layer
 *    isn't a `CatalogBucket`). Animated RECONS stars therefore stay at their
 *    present-day catalog position under REALWORLD rather than moving with
 *    `playerTimeYears` - a real, deliberately-accepted gap for this
 *    core-rendering Story, called out in the PR description.
 */

/** Base sprite pixel size (CSS pixels, before the per-star
 * `RealworldStarStyle.sizeMultiplier` and the "Object size" slider both
 * multiply it further) - the diameter a `sizeMultiplier: 1.0` star (the
 * REALWORLD size table's own baseline tier, `0 <= mag < 6`) renders at.
 * Chosen, alongside the multiplier table itself
 * (`magnitudeBrightness.ts`'s `REALWORLD_STYLE_BY_MAGNITUDE`), via live
 * iteration in the running viewer: large enough that even the faintest tier
 * (0.4x, 4px) still reads as a small but clearly visible twinkle rather than
 * a near-invisible speck, while the brightest "brilliant" tier (6.0x, 60px)
 * reads as a dramatic, unmistakable "needle" without swallowing half the
 * viewport. */
export const REALWORLD_BASE_SPRITE_PX = 10;

/** Vertex shader: standard MVP transform, plus a per-vertex `aSize` ->
 * `gl_PointSize` (CSS pixels, before the browser's own devicePixelRatio -
 * `uPixelRatio` corrects for that explicitly since `gl_PointSize` is
 * specified in actual framebuffer pixels, not CSS pixels).
 *
 * Deliberately NO `sizeAttenuation` term (no `/ -mvPosition.z` scaling by
 * camera distance, unlike `starMarkerScale.ts`'s `starMarkerRadiusPc`
 * MODEL-only shrink-curve) - see this module's own docstring and the PR
 * description for the full reasoning: REALWORLD's whole premise is that a
 * star's SIZE encodes its intrinsic brightness tier, not "how close is the
 * camera right now," so that encoding must stay legible at every zoom level,
 * exactly the human owner's own complaint about MODEL's markers not reading
 * as dramatically different enough. A mild/clamped attenuation was
 * considered and rejected: any camera-distance dependence at all would mean
 * the SAME star reads as a different apparent brightness tier depending on
 * where the user happens to be looking from, undermining the one property
 * (fixed, comparable, catalog-wide brightness encoding) this whole Story
 * exists to deliver. */
const VERTEX_SHADER = `
attribute vec3 aColor;
attribute float aSize;
attribute float aVariant;
varying vec3 vColor;
varying float vVariant;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uNormalBoost;
uniform float uBrilliantBoost;
uniform float uMinSizePx;
uniform float uAttenStartPc;
uniform float uAttenStrength;

void main() {
  vColor = aColor;
  vVariant = aVariant;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // PROTOTYPE: found live - boosting only the "brilliant" top tier and
  // flooring only the very faintest left the broad MIDDLE population (the
  // catalog's ordinary mag 0-6 stars scattered through the Local Bubble,
  // 1.0x multiplier = 10px base) looking like plain dots sandwiched between
  // now-dramatic bright giants and now-floored faint dwarfs. uNormalBoost
  // gives that middle population its own independent size control instead
  // of only ever inheriting whatever the brilliant-tier slider happens to
  // be set to.
  float boost = mix(uNormalBoost, uBrilliantBoost, step(0.5, aVariant));
  float size = aSize * uPixelRatio * uSizeScale * boost;
  // PROTOTYPE: soft, capped falloff by each star's real distance from the
  // SUN (this catalog's own heliocentric-cartesian origin - position is
  // already in that frame, no camera/view transform needed) - NOT camera
  // distance. A first version used camera distance and had a real bug: a
  // star physically near the Sun (e.g. Betelgeuse, 153pc) would ALSO taper
  // whenever the camera simply zoomed out far away to frame a wider view,
  // even though the star's true distance from the Local Bubble never
  // changed - exactly backwards from the intent ("outside-the-Bubble giants
  // shouldn't read as titanic," not "anything far from wherever the camera
  // happens to be shouldn't"). Sun-relative distance is fixed regardless of
  // camera position, so a star's size now reflects a stable, physically
  // meaningful property. Deliberately never reaches zero - Story #12's
  // zone-crossing reveal/fade owns hiding stars, this only tames size.
  float sunDist = length(position.xyz);
  float atten = sunDist > uAttenStartPc ? pow(uAttenStartPc / sunDist, uAttenStrength) : 1.0;
  size *= atten;
  // PROTOTYPE: aSize is 0 for a category/radius-filtered-out star (the
  // HIDDEN_SPRITE_PX convention) - the floor must not resurrect those, only
  // lift genuinely-visible-but-tiny sprites (faint M dwarfs) up to a legible
  // minimum.
  gl_PointSize = aSize > 0.0 ? max(size, uMinSizePx * uPixelRatio) : 0.0;
}
`;

/** Fragment shader: samples the shared `starTwinkle.ts` atlas texture, one
 * half selected per-vertex by `aVariant` (0 = "normal", 1 = "brilliant" -
 * must stay in sync with `starTwinkle.ts`'s
 * `STAR_TWINKLE_NORMAL_U_RANGE`/`STAR_TWINKLE_BRILLIANT_U_RANGE`, both
 * literally `[0, 0.5]`/`[0.5, 1]`), tints it by the star's own per-vertex
 * OBAFGKM color (`vColor`, from `spectralColor.ts` - completely unmodified,
 * per this Story's explicit constraint), and discards near-fully-transparent
 * texels so the sprite's soft edge doesn't write near-zero-alpha fragments
 * into the depth/blend buffers for no visible benefit. `AdditiveBlending`
 * (set on the material, not here) is what gives overlapping/nearby bright
 * sprites their glow-like look, matching a real star field's photographic
 * bloom rather than flat alpha-blended discs. */
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uMap;
uniform float uIntensity;
uniform float uColorBloomCompensation;
varying vec3 vColor;
varying float vVariant;

void main() {
  vec2 uv = gl_PointCoord;
  uv.x = uv.x * 0.5 + (vVariant > 0.5 ? 0.5 : 0.0);
  vec4 texel = texture2D(uMap, uv);
  if (texel.a < 0.02) {
    discard;
  }
  // PROTOTYPE: the bloom pass thresholds on standard perceptual luminance
  // (green-weighted ~0.71, red ~0.21, blue ~0.07) - found live that this
  // makes a saturated red/orange M or K supergiant (e.g. Betelgeuse,
  // Arcturus) bloom far less than a blue/white O/B/A star of the SAME
  // brightness tier and SAME sprite pixel size, even though both are
  // equally luminous astrophysically. This corrects for the star's OWN
  // spectral color's luma bias (not its brightness tier - that's still
  // entirely encoded by aSize/gl_PointSize, untouched here), so a red
  // supergiant reads as genuinely blazing instead of a flat matte dot.
  vec3 base = vColor * texel.rgb * texel.a * uIntensity;
  float colorLuma = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  float compensation = colorLuma > 0.001 ? min(1.0 / colorLuma, 4.0) : 1.0;
  vec3 compensated = base * mix(1.0, compensation, uColorBloomCompensation);
  gl_FragColor = vec4(compensated, texel.a);
}
`;

/** One REALWORLD star layer's built `Points` object plus the bookkeeping
 * `main.ts`'s visibility/size-scale/framing chokepoints need -
 * `objects[i]`/`baseSizesPx[i]` correspond to vertex `i` of `geometry`,
 * mirroring `objects.ts`'s `CatalogBucket.objects[i]`/`radiiPc[i]`
 * convention for the analogous MODEL concept. */
export interface RealworldStarLayer {
  points: Points;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  objects: SceneObject[];
  /** Each star's fully-resolved sprite pixel size (`REALWORLD_BASE_SPRITE_PX
   * * sizeMultiplier`) BEFORE the "Object size" slider (`uSizeScale`
   * uniform) and BEFORE any visibility hiding - the value `aSize` is reset to
   * whenever `updateRealworldStarVisibility` finds a star visible again. */
  baseSizesPx: Float32Array;
}

/** Effective sprite pixel size used for a category-toggled-off/radius-
 * filtered-out star - exactly zero, mirroring `objects.ts`'s
 * `HIDDEN_INSTANCE_SCALE` zero-scale convention for the analogous MODEL
 * concept: a zero-size point still exists in the buffer (vertex count/order
 * never changes, so index-based lookups stay stable) but is invisible. */
const HIDDEN_SPRITE_PX = 0;

/** Builds the REALWORLD star layer for every `SceneObject` in `starObjects`
 * (expected to already be filtered to `object_type === "star"` by the
 * caller, mirroring `objects.ts`'s `buildStarCatalogBucket` taking a
 * pre-filtered `starObjects` array). Returns `null` for an empty input,
 * matching that function's own empty-input guard.
 *
 * Every star starts fully visible at its baked-in base size - `main.ts` is
 * expected to call `updateRealworldStarVisibility` immediately after
 * building (exactly as `buildStarCatalogBucket`'s own callers already call
 * `applyCatalogVisibility()` right after rebuilding the MODEL bucket), so
 * this function itself doesn't need to know the current category/radius
 * filter state. */
export function buildRealworldStarLayer(starObjects: SceneObject[]): RealworldStarLayer | null {
  if (starObjects.length === 0) {
    return null;
  }

  const count = starObjects.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const variants = new Float32Array(count);
  const baseSizesPx = new Float32Array(count);

  const scratchColor = new Color();
  starObjects.forEach((obj, i) => {
    const [x, y, z] = obj.position_pc;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    scratchColor.setHex(spectralColorFor(obj.spectral_type));
    colors[i * 3] = scratchColor.r;
    colors[i * 3 + 1] = scratchColor.g;
    colors[i * 3 + 2] = scratchColor.b;

    const style = absoluteMagnitudeToRealworldStyle(obj.absolute_magnitude);
    const baseSizePx = REALWORLD_BASE_SPRITE_PX * style.sizeMultiplier;
    baseSizesPx[i] = baseSizePx;
    sizes[i] = baseSizePx;
    variants[i] = style.spriteVariant === "brilliant" ? 1 : 0;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aVariant", new BufferAttribute(variants, 1));

  const pixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const material = new ShaderMaterial({
    uniforms: {
      uMap: { value: getStarTwinkleAtlasTexture() },
      uPixelRatio: { value: pixelRatio },
      uSizeScale: { value: 1 },
      // Issue #18: these six start at the shader's own neutral defaults
      // (matching pre-#16 appearance) - `main.ts`'s `rebuildStarRenderLayer`
      // immediately overwrites them via `applyRealworldStarTuning` with the
      // user's current Settings-panel values (`DEFAULT_REALWORLD_STAR_TUNING`
      // on a fresh page load), so a bare `buildRealworldStarLayer` call (e.g.
      // in tests) is the only place these neutral values are ever observed.
      uNormalBoost: { value: 1 }, // size boost for the non-brilliant (everything but the top ~9%) tier
      uBrilliantBoost: { value: 1 }, // extra size/spike-length for the brightest tier only
      uMinSizePx: { value: 0 }, // legibility floor so faint stars' spikes stay visible
      uIntensity: { value: 1 }, // light intensity for all stars
      uAttenStartPc: { value: 1e9 }, // distance (pc) beyond which size starts tapering; huge default = off
      uAttenStrength: { value: 0 }, // 0 = no falloff (original design), higher = more aggressive taper
      uColorBloomCompensation: { value: 0 }, // 0 = off (raw spectral color), 1 = fully luma-corrected so red/orange stars bloom as much as blue/white ones of the same tier
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.name = "realworld-stars";
  // The catalog spans huge, direction-varied real distances (nearby RECONS
  // stars through ~800pc poster-sourced giants) - rather than compute (and
  // keep correct across every visibility-driven `aSize` update) a bounding
  // sphere for frustum culling, this single low-vertex-count draw call is
  // simply never culled, matching `diffuseStructures.ts`'s own
  // `buildMistyCloudGroup` sprites (no explicit culling logic either).
  points.frustumCulled = false;

  return { points, geometry, material, objects: starObjects, baseSizesPx };
}

/**
 * Applies the current category-toggle/radius-filter visibility rule to every
 * star in `layer` - the REALWORLD analogue of `objects.ts`'s
 * `updateCatalogVisibility`, using the exact same `isCatalogObjectVisible`
 * predicate so the two styles can never disagree about which stars should be
 * on screen. Deliberately called WITHOUT `isCatalogObjectVisible`'s optional
 * camera-distance/dense-batch-radius arguments - see this module's own
 * docstring for why that's the correct, deliberate choice for this Story
 * (no distance-based reveal/hide logic yet), not an oversight. */
export function updateRealworldStarVisibility(
  layer: RealworldStarLayer,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): void {
  const sizeAttribute = layer.geometry.getAttribute("aSize") as BufferAttribute;
  layer.objects.forEach((obj, i) => {
    const visible = isCatalogObjectVisible(obj, categoryVisibility, radiusPc);
    sizeAttribute.setX(i, visible ? layer.baseSizesPx[i] : HIDDEN_SPRITE_PX);
  });
  sizeAttribute.needsUpdate = true;
}

/** The "Object size" slider's REALWORLD equivalent of `objects.ts`'s
 * `updateCatalogSizeScale`. Deliberately NOT implemented the same way (that
 * function scales the bucket `InstancedMesh`'s own `Object3D.scale`, which
 * for an instanced mesh scales vertex POSITIONS too, not just apparent
 * radius - each instance's translation is baked into its own instance
 * matrix, which the container's scale then multiplies along with the
 * unit-sphere geometry's radius) - doing the same to a `Points` object would
 * scale every star's real `position_pc` outward/inward by the slider value,
 * visibly displacing stars from their true catalog coordinates, while doing
 * NOTHING to `gl_PointSize` (computed entirely in the vertex shader from the
 * `aSize` attribute, never influenced by the model matrix). Using a
 * dedicated `uSizeScale` uniform instead resizes sprites without ever
 * touching a single star's real position - arguably a more correct behavior
 * than MODEL's own scale trick, but the point of doing it differently here
 * is necessity (`Points` sizing works nothing like `InstancedMesh` sizing),
 * not a claim that MODEL's approach needs fixing (out of scope; MODEL stays
 * untouched). */
export function updateRealworldStarSizeScale(layer: RealworldStarLayer, sizeScale: number): void {
  layer.material.uniforms.uSizeScale.value = sizeScale;
}

/** The REALWORLD-layer analogue of `diffuseStructures.ts`'s
 * `visibleDiffuseStructureObjects` - `main.ts`'s "Fit all" camera preset
 * unions this in alongside `visibleCatalogObjects(catalogBuckets, ...)` and
 * `visibleDiffuseStructureObjects(...)` so framing still accounts for every
 * REALWORLD star, exactly the same reasoning `visibleDiffuseStructureObjects`'s
 * own docstring gives for the diffuse-structure layer. */
export function visibleRealworldStarObjects(
  layer: RealworldStarLayer,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): SceneObject[] {
  return layer.objects.filter((obj) => isCatalogObjectVisible(obj, categoryVisibility, radiusPc));
}

/** Releases `layer`'s own GPU resources (geometry buffers, shader program)
 * when `main.ts` toggles AWAY from REALWORLD (back to MODEL) - deliberately
 * does NOT touch `starTwinkle.ts`'s shared, module-level cached atlas
 * texture (`getStarTwinkleAtlasTexture`'s own singleton, reused by every
 * future REALWORLD layer for the lifetime of the page), mirroring
 * `objects.ts`'s own `materialCache`/`UNIT_SPHERE_GEOMETRY` module-level
 * singletons that are likewise never disposed by any single bucket's own
 * teardown. */
export function disposeRealworldStarLayer(layer: RealworldStarLayer): void {
  layer.geometry.dispose();
  layer.material.dispose();
}

/** Issue #18 (Epic #7): every REALWORLD Settings-panel control from #16's
 * tuning prototype that isn't already covered by `uSizeScale`/
 * `updateRealworldStarSizeScale` above (a different axis - a manual,
 * zoom-independent multiplier shared with MODEL) - bundled as one object so
 * `main.ts` can hold "the user's current REALWORLD tuning" as a single piece
 * of state and re-apply it wholesale via `applyRealworldStarTuning` below,
 * both per-slider and to a freshly (re)built layer, rather than needing a
 * separate re-init call per field. */
export interface RealworldStarTuning {
  colorBloomCompensation: number;
  normalBoost: number;
  brilliantBoost: number;
  minSizePx: number;
  intensity: number;
  attenStartPc: number;
  attenStrength: number;
  spikeLength: number;
  brilliantSpikeLength: number;
  spikeWidth: number;
}

/** The final tuned values from issue #16's live tuning HUD (human owner
 * decision, recorded on issue #18) - what every fresh REALWORLD session now
 * starts from, replacing both the shader's own neutral hardcoded uniform
 * defaults (`buildRealworldStarLayer`'s `uniforms` block above) and the
 * debug HUD's separate copy of the same numbers. */
export const DEFAULT_REALWORLD_STAR_TUNING: RealworldStarTuning = {
  colorBloomCompensation: 0.7,
  normalBoost: 1,
  brilliantBoost: 1,
  minSizePx: 9,
  intensity: 1,
  attenStartPc: 2000,
  attenStrength: 0,
  spikeLength: 1.8,
  brilliantSpikeLength: 2.6,
  spikeWidth: 1,
};

/** Applies every REALWORLD tuning value at once to `layer` - the seven plain
 * shader uniforms directly, plus the spike length/width trio which (per
 * `starTwinkle.ts`'s own docstring) are baked into a canvas texture rather
 * than a uniform, so they go through a redraw + `uMap` reassignment instead.
 * Always redraws/reassigns `uMap` unconditionally (rather than only on a
 * spike-specific change) - simpler than tracking which field changed, and a
 * ~256x128 canvas redraw is cheap enough that #16's own prototype already
 * did this on every slider drag with no issue.
 *
 * Two callers, per issue #18: each individual Settings-panel slider's
 * `onChange` (with the full current tuning snapshot, not just the one field
 * that changed - see `main.ts`'s `realworldStarTuning`), and `main.ts`'s
 * `rebuildStarRenderLayer`, right after building a fresh REALWORLD layer - a
 * brand-new `ShaderMaterial`'s uniforms start at the shader's own hardcoded
 * defaults, not the user's current Settings values, so without this second
 * call site every REALWORLD<->MODEL toggle would silently reset the user's
 * tuning back to those defaults. */
export function applyRealworldStarTuning(layer: RealworldStarLayer, tuning: RealworldStarTuning): void {
  const uniforms = layer.material.uniforms;
  uniforms.uColorBloomCompensation.value = tuning.colorBloomCompensation;
  uniforms.uNormalBoost.value = tuning.normalBoost;
  uniforms.uBrilliantBoost.value = tuning.brilliantBoost;
  uniforms.uMinSizePx.value = tuning.minSizePx;
  uniforms.uIntensity.value = tuning.intensity;
  uniforms.uAttenStartPc.value = tuning.attenStartPc;
  uniforms.uAttenStrength.value = tuning.attenStrength;

  const texture = getTunableStarTwinkleAtlasTexture();
  if (texture) {
    redrawStarTwinkleAtlas(tuning.spikeLength, tuning.spikeWidth, tuning.brilliantSpikeLength);
    uniforms.uMap.value = texture;
  }
}
