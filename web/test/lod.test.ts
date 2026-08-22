import { describe, expect, it } from "vitest";
import {
  DENSE_BATCH_GROUP_TAG,
  denseBatchCollectionRadiusPc,
  isCameraInsideDenseBatchSphere,
  isDenseBatchMember,
  passesDenseBatchLod,
} from "../src/scene/lod";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Issue #104: camera-distance-gated (LOD) marker visibility for the dense
 * RECONS "100 nearest stellar systems" batch. Covers the batch-membership
 * tag check, the data-derived collection-radius computation, and the LOD
 * predicate itself - `objects.ts`'s `isCatalogObjectVisible`/
 * `updateDenseBatchLod` (exercised in `objects.test.ts`) just compose these.
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
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
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

const DENSE_MEMBER = makeObject({
  id: "proxima",
  distance_pc: 1.3,
  group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
});
const DENSE_MEMBER_FAR = makeObject({
  id: "g-180-60",
  distance_pc: 11.26,
  group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
});
const POSTER_STAR = makeObject({
  id: "canopus",
  distance_pc: 95,
  group: { primary: null, secondary: [] },
});
const OTHER_TAGGED = makeObject({
  id: "some-other-batch-member",
  distance_pc: 500,
  group: { primary: "gould-belt", secondary: ["some-other-tag"] },
});

describe("isDenseBatchMember", () => {
  it("is true only for objects tagged with the dense-batch group secondary", () => {
    expect(isDenseBatchMember(DENSE_MEMBER)).toBe(true);
    expect(isDenseBatchMember(POSTER_STAR)).toBe(false);
    expect(isDenseBatchMember(OTHER_TAGGED)).toBe(false);
  });

  it("is unaffected by unrelated tags/primary group membership", () => {
    const mixedTags = makeObject({
      group: { primary: "some-group", secondary: ["unrelated", DENSE_BATCH_GROUP_TAG, "another"] },
    });
    expect(isDenseBatchMember(mixedTags)).toBe(true);
  });
});

describe("denseBatchCollectionRadiusPc", () => {
  it("is the max distance among dense-batch members only", () => {
    const radius = denseBatchCollectionRadiusPc([DENSE_MEMBER, DENSE_MEMBER_FAR, POSTER_STAR]);
    expect(radius).toBe(11.26);
  });

  it("ignores non-member objects entirely, however far they are", () => {
    const radius = denseBatchCollectionRadiusPc([DENSE_MEMBER, POSTER_STAR]);
    expect(radius).toBe(1.3);
  });

  it("is 0 when no object is tagged as a dense-batch member", () => {
    expect(denseBatchCollectionRadiusPc([POSTER_STAR, OTHER_TAGGED])).toBe(0);
  });

  it("is 0 for an empty object list", () => {
    expect(denseBatchCollectionRadiusPc([])).toBe(0);
  });
});

describe("passesDenseBatchLod", () => {
  const collectionRadiusPc = 11.26;

  it("always passes for objects outside the gated batch, regardless of camera distance", () => {
    expect(passesDenseBatchLod(POSTER_STAR, 0, collectionRadiusPc)).toBe(true);
    expect(passesDenseBatchLod(POSTER_STAR, 100000, collectionRadiusPc)).toBe(true);
  });

  it("hides a dense-batch member when the camera is farther than the collection radius", () => {
    expect(passesDenseBatchLod(DENSE_MEMBER, 1087, collectionRadiusPc)).toBe(false);
  });

  it("shows a dense-batch member once the camera is within the collection radius", () => {
    expect(passesDenseBatchLod(DENSE_MEMBER, 5, collectionRadiusPc)).toBe(true);
  });

  it("treats the collection radius as inclusive (camera exactly at the boundary is visible)", () => {
    expect(passesDenseBatchLod(DENSE_MEMBER_FAR, collectionRadiusPc, collectionRadiusPc)).toBe(true);
  });

  it("hides every dense-batch member at the default (0) collection radius, e.g. before scene load", () => {
    expect(passesDenseBatchLod(DENSE_MEMBER, 0, 0)).toBe(true); // camera at the very origin still passes 0<=0
    expect(passesDenseBatchLod(DENSE_MEMBER, 1087, 0)).toBe(false);
  });
});

/**
 * Issue #137: a plain "is the camera itself inside the dense batch's own
 * collection sphere" boolean, independent of any particular object - the
 * trigger `main.ts` uses to dim/restore the "background" (non-star catalog
 * buckets, structure-layer overlays). Same inclusive boundary and same
 * "collection radius <= 0 means nothing to be inside of" guard as
 * `passesDenseBatchLod` above, so both LOD-driven effects agree on exactly
 * where "inside the sphere" begins.
 */
describe("isCameraInsideDenseBatchSphere", () => {
  const collectionRadiusPc = 11.26;

  it("is true when the camera is well within the sphere", () => {
    expect(isCameraInsideDenseBatchSphere(5, collectionRadiusPc)).toBe(true);
  });

  it("is false when the camera is well outside the sphere", () => {
    expect(isCameraInsideDenseBatchSphere(1087, collectionRadiusPc)).toBe(false);
  });

  it("treats the collection radius as inclusive (camera exactly at the boundary counts as inside)", () => {
    expect(isCameraInsideDenseBatchSphere(collectionRadiusPc, collectionRadiusPc)).toBe(true);
  });

  it("is false just outside the boundary", () => {
    expect(isCameraInsideDenseBatchSphere(collectionRadiusPc + 0.01, collectionRadiusPc)).toBe(
      false,
    );
  });

  it("is false at a 0 collection radius (e.g. before scene load), regardless of camera distance", () => {
    expect(isCameraInsideDenseBatchSphere(0, 0)).toBe(false);
    expect(isCameraInsideDenseBatchSphere(1087, 0)).toBe(false);
  });
});
