import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import {
  createDenseBatchBoundaryLayer,
  isDenseBatchBoundaryVisible,
} from "../src/scene/denseBatchBoundary";

/**
 * Issue #138: a visible boundary marker for the dense RECONS-batch's own
 * collection radius (`lod.ts`'s `denseBatchCollectionRadiusPc`, issue
 * #104) - a wireframe sphere shell at that radius, shown only once the
 * camera has crossed inside it. Covers the geometry construction (correct
 * radius, translucent/wireframe/non-depth-writing so it doesn't compete
 * with or occlude the stars it encloses) and the pure show/hide decision.
 */

const COLLECTION_RADIUS_PC = 11.26;

describe("createDenseBatchBoundaryLayer", () => {
  it("builds a wireframe sphere mesh at exactly the given radius", () => {
    const mesh = createDenseBatchBoundaryLayer(COLLECTION_RADIUS_PC);
    expect(mesh).not.toBeNull();
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh!.geometry).toBeInstanceOf(SphereGeometry);
    const geometry = mesh!.geometry as SphereGeometry;
    expect(geometry.parameters.radius).toBe(COLLECTION_RADIUS_PC);
  });

  it("is centered at the origin (the Sun)", () => {
    const mesh = createDenseBatchBoundaryLayer(COLLECTION_RADIUS_PC)!;
    expect(mesh.position.x).toBe(0);
    expect(mesh.position.y).toBe(0);
    expect(mesh.position.z).toBe(0);
  });

  it("is a translucent, depth-non-writing wireframe - reads as a boundary marker without occluding/competing with the stars inside it", () => {
    const mesh = createDenseBatchBoundaryLayer(COLLECTION_RADIUS_PC)!;
    const material = mesh.material as MeshBasicMaterial;
    expect(material.wireframe).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    // Matches `createLocalBubbleLayer`'s own translucent-mesh convention -
    // a depth-writing translucent mesh would incorrectly occlude/interfere
    // with picking the objects inside it instead of just outlining them.
    expect(material.depthWrite).toBe(false);
  });

  it("returns null for a radius of 0 (dense batch not loaded / no members present)", () => {
    expect(createDenseBatchBoundaryLayer(0)).toBeNull();
  });

  it("returns null for a negative or non-finite radius", () => {
    expect(createDenseBatchBoundaryLayer(-5)).toBeNull();
    expect(createDenseBatchBoundaryLayer(Number.NaN)).toBeNull();
    expect(createDenseBatchBoundaryLayer(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("isDenseBatchBoundaryVisible", () => {
  it("is visible once the camera is at or within the collection radius", () => {
    expect(isDenseBatchBoundaryVisible(5, COLLECTION_RADIUS_PC)).toBe(true);
    expect(isDenseBatchBoundaryVisible(COLLECTION_RADIUS_PC, COLLECTION_RADIUS_PC)).toBe(true);
  });

  it("is hidden once the camera is farther than the collection radius", () => {
    expect(isDenseBatchBoundaryVisible(1087, COLLECTION_RADIUS_PC)).toBe(false);
    expect(isDenseBatchBoundaryVisible(COLLECTION_RADIUS_PC + 0.001, COLLECTION_RADIUS_PC)).toBe(
      false,
    );
  });

  it("treats the boundary as inclusive, matching lod.ts's passesDenseBatchLod convention exactly", () => {
    // Same inclusive (<=) convention as `passesDenseBatchLod` - the shell
    // and the dense-batch markers/labels it encloses should cross their
    // shared boundary at exactly the same camera distance.
    expect(isDenseBatchBoundaryVisible(11.26, 11.26)).toBe(true);
  });

  it("is never visible when the collection radius is 0 (not loaded / no members present), regardless of camera distance", () => {
    expect(isDenseBatchBoundaryVisible(0, 0)).toBe(false);
    expect(isDenseBatchBoundaryVisible(1087, 0)).toBe(false);
  });

  it("is never visible for a negative collection radius", () => {
    expect(isDenseBatchBoundaryVisible(1, -5)).toBe(false);
  });
});
