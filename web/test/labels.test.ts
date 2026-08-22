import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LABEL_DISTANCE_PC,
  DENSE_BATCH_MAX_VISIBLE_LABELS,
  displayName,
  effectiveMaxLabelDistancePc,
  hasProperName,
  LABEL_DISTANCE_CAMERA_SCALE_FACTOR,
  selectDenseBatchLabels,
  selectNearestLabels,
  shouldShowLabel,
  shouldShowSunLabel,
  type DenseBatchLabelRankCandidate,
  type LabelRankCandidate,
} from "../src/scene/labels";

/**
 * Branch coverage for the label clutter-avoidance rule (spec Idea.md §25).
 * Pure predicate - no `THREE`/DOM dependency.
 */

const BASE = {
  labelsEnabled: true,
  layerVisible: true,
  withinRadius: true,
  isSelected: false,
  cameraDistancePc: 100,
  maxCameraDistancePc: 500,
};

describe("shouldShowLabel", () => {
  it("shows a nearby, visible, in-radius object's label when labels are on", () => {
    expect(shouldShowLabel(BASE)).toBe(true);
  });

  it("hides all labels when the global labels toggle is off, even if selected", () => {
    expect(shouldShowLabel({ ...BASE, labelsEnabled: false, isSelected: true })).toBe(false);
  });

  it("hides a label whose category layer is toggled off", () => {
    expect(shouldShowLabel({ ...BASE, layerVisible: false })).toBe(false);
  });

  it("hides a label filtered out by the current radius", () => {
    expect(shouldShowLabel({ ...BASE, withinRadius: false })).toBe(false);
  });

  it("hides a distant, unselected object's label (clutter avoidance)", () => {
    expect(shouldShowLabel({ ...BASE, cameraDistancePc: 5000, maxCameraDistancePc: 500 })).toBe(
      false,
    );
  });

  it("always shows the selected object's label regardless of camera distance", () => {
    expect(
      shouldShowLabel({ ...BASE, isSelected: true, cameraDistancePc: 50_000, maxCameraDistancePc: 500 }),
    ).toBe(true);
  });

  it("selection cannot override an off category layer or a radius exclusion", () => {
    expect(shouldShowLabel({ ...BASE, isSelected: true, layerVisible: false })).toBe(false);
    expect(shouldShowLabel({ ...BASE, isSelected: true, withinRadius: false })).toBe(false);
  });

  it("shows a label exactly at the distance threshold (boundary is inclusive)", () => {
    expect(shouldShowLabel({ ...BASE, cameraDistancePc: 500, maxCameraDistancePc: 500 })).toBe(
      true,
    );
  });
});

/**
 * Issue #89's label-density fix: at 605 catalog objects, the distance
 * cutoff alone (`shouldShowLabel`) can still leave hundreds of objects
 * eligible at a typical zoomed-out view - `selectNearestLabels` is the
 * hard cap on simultaneously-rendered DOM labels that actually bounds
 * `CSS2DRenderer`'s cost regardless of catalog size.
 */
describe("selectNearestLabels", () => {
  function candidate(id: string, cameraDistancePc: number, isSelected = false): LabelRankCandidate {
    return { id, cameraDistancePc, isSelected };
  }

  it("shows everything when the candidate count is already within the cap", () => {
    const candidates = [candidate("a", 10), candidate("b", 20), candidate("c", 30)];
    expect(selectNearestLabels(candidates, 5)).toEqual(new Set(["a", "b", "c"]));
  });

  it("keeps only the nearest N candidates when over the cap", () => {
    const candidates = [
      candidate("far", 500),
      candidate("near", 10),
      candidate("mid", 100),
      candidate("mid-far", 300),
    ];
    const visible = selectNearestLabels(candidates, 2);
    expect(visible).toEqual(new Set(["near", "mid"]));
  });

  it("always includes the selected candidate even if it would rank outside the cap", () => {
    const candidates = [
      candidate("near-1", 10),
      candidate("near-2", 20),
      candidate("near-3", 30),
      candidate("selected-but-far", 9999, true),
    ];
    const visible = selectNearestLabels(candidates, 2);
    expect(visible.has("selected-but-far")).toBe(true);
    expect(visible.size).toBe(2);
    // The nearest of the non-selected candidates fills the remaining budget.
    expect(visible.has("near-1")).toBe(true);
  });

  it("returns an empty set for an empty candidate list", () => {
    expect(selectNearestLabels([], 60)).toEqual(new Set());
  });

  it("handles a cap of zero by showing only selected candidates", () => {
    const candidates = [candidate("a", 10), candidate("b", 20, true)];
    expect(selectNearestLabels(candidates, 0)).toEqual(new Set(["b"]));
  });

  it("at realistic catalog scale (605 objects), caps well below the full eligible set", () => {
    const candidates: LabelRankCandidate[] = Array.from({ length: 548 }, (_, i) =>
      candidate(`obj-${i}`, i),
    );
    const visible = selectNearestLabels(candidates, 60);
    expect(visible.size).toBe(60);
    // The 60 nearest (smallest cameraDistancePc, i.e. indices 0..59) win.
    expect(visible.has("obj-0")).toBe(true);
    expect(visible.has("obj-59")).toBe(true);
    expect(visible.has("obj-60")).toBe(false);
  });
});

/**
 * Issue #94: the default camera pose (`scene/camera.ts`) sits ~1087pc from
 * the origin, well outside the fixed 250pc threshold PR #93/issue #89 set,
 * so on first load - with no user zoom/pan and nothing selected - literally
 * every catalog object failed `shouldShowLabel`'s distance check and zero
 * labels rendered. `effectiveMaxLabelDistancePc` reconciles the two
 * defaults by scaling the threshold with the camera's current distance from
 * the origin, floored at the original 250pc so close-in zoom levels
 * (e.g. the "Sun-centered" preset) keep behaving exactly as before #94.
 */
describe("effectiveMaxLabelDistancePc", () => {
  it("never drops below the DEFAULT_MAX_LABEL_DISTANCE_PC floor when the camera is close in", () => {
    // Sun-centered preset camera distance (~93.8pc, scene/cameraPresets.ts).
    expect(effectiveMaxLabelDistancePc(93.8)).toBe(DEFAULT_MAX_LABEL_DISTANCE_PC);
    expect(effectiveMaxLabelDistancePc(0)).toBe(DEFAULT_MAX_LABEL_DISTANCE_PC);
  });

  it("scales linearly with camera distance once that exceeds the floor", () => {
    const cameraDistancePc = 1000;
    expect(effectiveMaxLabelDistancePc(cameraDistancePc)).toBeCloseTo(
      cameraDistancePc * LABEL_DISTANCE_CAMERA_SCALE_FACTOR,
      6,
    );
  });

  it("at the default 'Perspective' camera pose (~1087pc from the origin), the threshold comfortably covers near-Sun objects that a fixed 250pc threshold would have excluded entirely", () => {
    // scene/camera.ts's default position (700, -700, 450); length ~1087.4pc.
    const defaultCameraDistancePc = Math.sqrt(700 ** 2 + 700 ** 2 + 450 ** 2);
    const threshold = effectiveMaxLabelDistancePc(defaultCameraDistancePc);

    expect(threshold).toBeGreaterThan(DEFAULT_MAX_LABEL_DISTANCE_PC);

    // A star close to the Sun (10, 10, 5) - representative of the
    // catalog's near-Sun density (spec Idea-v1.2-individual-stars.md) - is
    // well within the new threshold from that default camera position,
    // where it would have been >4x the old fixed 250pc threshold away.
    const cameraPosition = { x: 700, y: -700, z: 450 };
    const nearSunObject = { x: 10, y: 10, z: 5 };
    const cameraDistanceToObject = Math.sqrt(
      (cameraPosition.x - nearSunObject.x) ** 2 +
        (cameraPosition.y - nearSunObject.y) ** 2 +
        (cameraPosition.z - nearSunObject.z) ** 2,
    );
    expect(cameraDistanceToObject).toBeGreaterThan(DEFAULT_MAX_LABEL_DISTANCE_PC);
    expect(cameraDistanceToObject).toBeLessThanOrEqual(threshold);
    expect(
      shouldShowLabel({
        labelsEnabled: true,
        layerVisible: true,
        withinRadius: true,
        isSelected: false,
        cameraDistancePc: cameraDistanceToObject,
        maxCameraDistancePc: threshold,
      }),
    ).toBe(true);
  });
});

/**
 * Issue #105 (spec §2.5): the Sun's dedicated marker (`scene/sun.ts`) gets
 * its own label, wired into the same global labels toggle as catalog
 * labels but permanently exempt from the distance-based hide-at-large-zoom
 * threshold (`shouldShowLabel`) and the `MAX_VISIBLE_LABELS` nearest-N cap
 * (`selectNearestLabels`) - "the coordinate origin should never
 * disappear." `shouldShowSunLabel`'s signature takes no distance/rank
 * inputs at all, so there is nothing for these tests to vary except the
 * global toggle itself.
 */
describe("shouldShowSunLabel", () => {
  it("is visible whenever the global labels toggle is on", () => {
    expect(shouldShowSunLabel(true)).toBe(true);
  });

  it("is hidden only when the global labels toggle is off", () => {
    expect(shouldShowSunLabel(false)).toBe(false);
  });

  it("stays visible under camera-distance/rank conditions that would hide any ordinary catalog label", () => {
    // An extreme distance, far beyond any realistic threshold, and a rank
    // that would lose to `MAX_VISIBLE_LABELS` competition for a regular,
    // unselected catalog object under `shouldShowLabel`/
    // `selectNearestLabels` - the Sun's label ignores both, because its
    // visibility function never receives them.
    const extremeCameraDistancePc = 1_000_000;
    const tinyThreshold = 1;

    const ordinaryObjectWouldBeHidden = !shouldShowLabel({
      labelsEnabled: true,
      layerVisible: true,
      withinRadius: true,
      isSelected: false,
      cameraDistancePc: extremeCameraDistancePc,
      maxCameraDistancePc: tinyThreshold,
    });
    expect(ordinaryObjectWouldBeHidden).toBe(true);

    // Same "labels are on" condition, but the Sun's own policy is
    // unaffected by the distance/rank scenario above.
    expect(shouldShowSunLabel(true)).toBe(true);
  });
});

/**
 * Issue #122: SIMBAD's "NAME " prefix (see `hasProperName` above) is
 * load-bearing classification signal, but was also leaking into the two
 * on-screen DISPLAY sites (the 3D label and the Inspector's "Name" row) as
 * a raw, unstripped internal-catalog artifact. `displayName` strips exactly
 * that leading prefix, and nothing else - `hasProperName`/`searchObjects`
 * must keep reading the raw, unstripped `name`/`aliases`.
 */
describe("displayName", () => {
  it("strips a leading 'NAME ' prefix (Proxima Centauri)", () => {
    expect(displayName("NAME Proxima Centauri")).toBe("Proxima Centauri");
  });

  it("leaves a name with no 'NAME ' prefix completely unaffected", () => {
    expect(displayName("* alf Cen A")).toBe("* alf Cen A");
    expect(displayName("Wolf  359")).toBe("Wolf  359");
    expect(displayName("HD  95735")).toBe("HD  95735");
  });

  it("does not touch the unrelated 'NAME-IAU ' convention (no space after NAME)", () => {
    expect(displayName("NAME-IAU Ramus")).toBe("NAME-IAU Ramus");
  });

  it("only strips a leading occurrence, not one embedded mid-string", () => {
    expect(displayName("V* NAME something")).toBe("V* NAME something");
  });

  it("returns an empty string unchanged", () => {
    expect(displayName("")).toBe("");
  });
});

/**
 * Issue #114's proper-name heuristic: SIMBAD's own "NAME " prefix
 * convention, checked against `name` first and then `aliases` - verified
 * against the *actual* RECONS-batch catalog records (`data/normalized/
 * initial_catalog_records.json` / exported `scene.json`), not invented
 * shapes. Real examples used below:
 *   - `name_proxima_centauri`: `name` is literally "NAME Proxima
 *     Centauri" - caught by the primary-name check.
 *   - `alf_cen_a`/`alf_cen_b`: `name` is the bare Bayer designation
 *     "* alf Cen A"/"* alf Cen B", with the recognizable common name only
 *     present as an alias - "NAME Rigil Kentaurus"/"NAME Toliman" - caught
 *     by the alias fallback.
 *   - `wolf_359`/`hd_95735`/`ross_128`: neither `name` nor any alias
 *     carries a "NAME " entry - correctly treated as bare designations
 *     even though some read as quasi-names colloquially.
 */
describe("hasProperName", () => {
  it("recognizes a primary name using SIMBAD's 'NAME ' convention (Proxima Centauri)", () => {
    expect(
      hasProperName({
        name: "NAME Proxima Centauri",
        aliases: ["GJ 551", "HIP 70890", "NAME Proxima Cen", "NAME Proxima"],
      }),
    ).toBe(true);
  });

  it("recognizes a proper name that only appears as an alias, not the primary name (Alpha Centauri A)", () => {
    expect(
      hasProperName({
        name: "* alf Cen A",
        aliases: ["GJ 559 A", "HIP 71683", "HD 128620", "NAME Rigel Kentaurus", "NAME Rigil Kentaurus"],
      }),
    ).toBe(true);
  });

  it("recognizes Alpha Centauri B's proper name alias (Toliman)", () => {
    expect(
      hasProperName({
        name: "* alf Cen B",
        aliases: ["GJ 559 B", "HIP 71681", "HD 128621", "NAME Toliman"],
      }),
    ).toBe(true);
  });

  it("treats a bare catalog designation with no 'NAME ' anywhere as unnamed (Wolf 359)", () => {
    expect(
      hasProperName({
        name: "Wolf  359",
        aliases: ["GJ 406", "PLX 2553", "LHS    36", "LTT 12923"],
      }),
    ).toBe(false);
  });

  it("treats an HD-designation-only record as unnamed (HD 95735 / Lalande 21185, no NAME alias present here)", () => {
    expect(
      hasProperName({
        name: "HD  95735",
        aliases: ["GJ 411", "HIP 54035", "LHS    37", "LTT 12960"],
      }),
    ).toBe(false);
  });

  it("treats Ross 128 (catalog designation) as unnamed", () => {
    expect(
      hasProperName({
        name: "Ross  128",
        aliases: ["GJ 447", "HIP 57548", "LHS   315"],
      }),
    ).toBe(false);
  });

  it("does not false-positive on a 'NAME-IAU' prefixed alias (distinct convention, no space after NAME)", () => {
    // Real record `102_her`: aliases include "NAME-IAU Ramus" - SIMBAD's
    // IAU-approved-name convention, a different prefix than the plain
    // "NAME " proper-name convention this heuristic targets.
    expect(
      hasProperName({
        name: "* 102 Her",
        aliases: ["HIP 88886", "HD 166182", "NAME-IAU Ramus"],
      }),
    ).toBe(false);
  });

  it("requires the 'NAME ' prefix at the start of the string, not merely present somewhere", () => {
    expect(hasProperName({ name: "GJ 551", aliases: ["V* NAME something"] })).toBe(false);
  });
});

/**
 * Issue #114: within the dense RECONS "100 nearest stellar systems" LOD
 * batch (#104), the general 60-object cap is far too generous for the tiny
 * screen area involved once the camera is close enough for the batch to be
 * visible - `selectDenseBatchLabels` applies a much smaller cap
 * (`DENSE_BATCH_MAX_VISIBLE_LABELS`) and prioritizes proper-named objects
 * (Alpha Centauri, Proxima, Barnard's Star, ...) over bare catalog
 * designations, not just nearest-to-camera.
 *
 * Issue #151 raised the cap from #114's original 7 to 20 (still well below
 * the general 60-object cap, and below the real batch's own 22 proper-named
 * stars - see `DENSE_BATCH_MAX_VISIBLE_LABELS`'s docstring) so more of the
 * ~122 nearby stars get labeled without reverting to #114's original
 * clutter problem. The tests below use the `DENSE_BATCH_MAX_VISIBLE_LABELS`
 * constant rather than a hardcoded number so they track whichever value is
 * currently configured.
 */
describe("selectDenseBatchLabels", () => {
  it("is tuned to 20 (#151): meaningfully more than #114's original 7, while staying below the real batch's own 22 proper-named stars and far below the general 60-object cap", () => {
    expect(DENSE_BATCH_MAX_VISIBLE_LABELS).toBe(20);
    expect(DENSE_BATCH_MAX_VISIBLE_LABELS).toBeGreaterThan(7);
    expect(DENSE_BATCH_MAX_VISIBLE_LABELS).toBeLessThan(60);
  });

  function denseCandidate(
    id: string,
    cameraDistancePc: number,
    hasProperNameValue: boolean,
    isSelected = false,
  ): DenseBatchLabelRankCandidate {
    return { id, cameraDistancePc, isSelected, hasProperName: hasProperNameValue };
  }

  it("shows everything when the candidate count is already within the cap", () => {
    const candidates = [denseCandidate("a", 1, true), denseCandidate("b", 2, false)];
    expect(selectDenseBatchLabels(candidates, 5)).toEqual(new Set(["a", "b"]));
  });

  it("prioritizes proper-named objects over bare designations, even when the designation-only object is nearer", () => {
    const candidates = [
      denseCandidate("named-far", 5, true),
      denseCandidate("bare-near-1", 1, false),
      denseCandidate("bare-near-2", 2, false),
    ];
    const visible = selectDenseBatchLabels(candidates, 1);
    expect(visible).toEqual(new Set(["named-far"]));
  });

  it("breaks ties within the same proper-name tier by nearest camera distance", () => {
    const candidates = [
      denseCandidate("named-far", 10, true),
      denseCandidate("named-near", 3, true),
      denseCandidate("bare-near", 1, false),
    ];
    const visible = selectDenseBatchLabels(candidates, 2);
    expect(visible).toEqual(new Set(["named-near", "named-far"]));
  });

  it("always includes the selected candidate even if unnamed and far, without competing for name-priority budget", () => {
    const candidates = [
      denseCandidate("named-1", 1, true),
      denseCandidate("named-2", 2, true),
      denseCandidate("selected-bare-far", 9999, false, true),
    ];
    const visible = selectDenseBatchLabels(candidates, 2);
    expect(visible.has("selected-bare-far")).toBe(true);
    expect(visible.size).toBe(2);
    expect(visible.has("named-1")).toBe(true);
  });

  it("caps well below the general MAX_VISIBLE_LABELS at realistic dense-batch scale (122 candidates), staying within the real 22-named-star pool at the #151 cap of 20", () => {
    // Mirrors the real RECONS batch: 22 proper-named entries, 100 bare
    // designations (the actual real catalog split - see `hasProperName`'s
    // docstring and `DENSE_BATCH_MAX_VISIBLE_LABELS`'s docstring for how
    // this count was verified against `scene.json`).
    const named: DenseBatchLabelRankCandidate[] = Array.from({ length: 22 }, (_, i) =>
      denseCandidate(`named-${i}`, i + 1, true),
    );
    const bare: DenseBatchLabelRankCandidate[] = Array.from({ length: 100 }, (_, i) =>
      denseCandidate(`bare-${i}`, i + 1, false),
    );
    const visible = selectDenseBatchLabels([...named, ...bare], DENSE_BATCH_MAX_VISIBLE_LABELS);
    expect(visible.size).toBe(DENSE_BATCH_MAX_VISIBLE_LABELS);
    expect(visible.size).toBeLessThan(60);
    // All winners are drawn from the named pool (there are more named
    // entries than the cap, so no bare designation should win a slot).
    for (const id of visible) {
      expect(id.startsWith("named-")).toBe(true);
    }
  });

  it("reliably includes the Alpha Centauri system (Proxima, A, B) - the batch's own three nearest, real-data-shaped members - at the #151 cap of 20", () => {
    // Real distances/ids from the RECONS batch (scene.json): Proxima
    // ~1.30pc, Alpha Cen A ~1.35pc, Alpha Cen B ~1.35pc - the batch's own
    // three nearest members, so proper-name-priority and nearest-distance
    // agree on ranking them first regardless of tie-break order.
    const alphaCenSystem: DenseBatchLabelRankCandidate[] = [
      denseCandidate("name_proxima_centauri", 1.3, true),
      denseCandidate("alf_cen_a", 1.35, true),
      denseCandidate("alf_cen_b", 1.35, true),
    ];
    // The RECONS batch's remaining 19 real proper-named entries (real ids/
    // distances from scene.json), so the named pool here matches the real
    // batch's full 22 - large enough that, at the #151 cap of 20, the two
    // nearest named entries below the top 20 get squeezed out by nothing
    // (there's no unnamed competitor that ranks ahead of a named one), and
    // no bare designation should win a slot either.
    const otherNamed: DenseBatchLabelRankCandidate[] = [
      denseCandidate("name_barnard_s_star", 1.83, true),
      denseCandidate("alf_cma", 2.64, true),
      denseCandidate("alf_cma_b", 2.67, true),
      denseCandidate("eps_eri", 3.22, true),
      denseCandidate("hd_217987", 3.29, true),
      denseCandidate("alf_cmi", 3.51, true),
      denseCandidate("bd_05_1668", 3.79, true),
      denseCandidate("name_teegarden_s_star", 3.83, true),
      denseCandidate("hd_33793", 3.93, true),
      denseCandidate("v_ax_mic", 3.97, true),
      denseCandidate("wolf_28", 4.31, true),
      denseCandidate("bd_44_2051b", 4.91, true),
      denseCandidate("omi02_eri", 5.01, true),
      denseCandidate("alf_aql", 5.13, true),
      denseCandidate("eggr_180", 5.52, true),
      denseCandidate("g_175_34", 5.52, true),
      denseCandidate("sig_dra", 5.76, true),
      denseCandidate("eta_cas", 5.92, true),
      denseCandidate("eggr_45", 6.44, true),
    ];
    // A representative slice of the batch's bare-designation majority, at
    // realistic distances - none of these should win a slot given 22 named
    // entries already exceed the 20-slot cap.
    const bare: DenseBatchLabelRankCandidate[] = [
      denseCandidate("wolf_359", 2.41, false),
      denseCandidate("hd_95735", 2.55, false),
      denseCandidate("g_272_61b", 2.67, false),
      denseCandidate("g_272_61a", 2.72, false),
      denseCandidate("cd_23_14742", 2.98, false),
      denseCandidate("ross_248", 3.16, false),
      denseCandidate("ross_128", 3.37, false),
    ];

    const visible = selectDenseBatchLabels(
      [...alphaCenSystem, ...otherNamed, ...bare],
      DENSE_BATCH_MAX_VISIBLE_LABELS,
    );

    expect(visible.has("name_proxima_centauri")).toBe(true);
    expect(visible.has("alf_cen_a")).toBe(true);
    expect(visible.has("alf_cen_b")).toBe(true);
    expect(visible.size).toBe(DENSE_BATCH_MAX_VISIBLE_LABELS);
    expect(visible.size).toBeLessThan(60);
    // At 22 real named entries vs. a 20-slot cap, no bare designation
    // should win a slot - the two farthest named entries (eta_cas,
    // eggr_45) are the ones squeezed out instead.
    for (const id of bare.map((c) => c.id)) {
      expect(visible.has(id)).toBe(false);
    }
  });

  it("returns an empty set for an empty candidate list (outside the dense LOD volume, nothing to rank)", () => {
    expect(selectDenseBatchLabels([], DENSE_BATCH_MAX_VISIBLE_LABELS)).toEqual(new Set());
  });

  it("handles a cap of zero by showing only selected candidates", () => {
    const candidates = [denseCandidate("a", 1, true), denseCandidate("b", 2, false, true)];
    expect(selectDenseBatchLabels(candidates, 0)).toEqual(new Set(["b"]));
  });
});
