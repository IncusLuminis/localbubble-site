import {
  DoubleSide,
  Group,
  GridHelper,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";

/**
 * The Galactic Plane reference layer (spec Idea.md §26): "a large
 * semi-transparent plane" corresponding to Z = 0, "primarily geometric
 * reference" that "must remain visually subtle".
 *
 * `PlaneGeometry` already lies in the local XY plane (all vertices at
 * local z = 0, normal along +Z) by default in Three.js - which is exactly
 * the Galactic Plane's Z = 0 definition (spec §6: +Z -> North Galactic
 * Pole) - so no rotation of the plane mesh is needed. A faint `GridHelper`
 * is added for scale/orientation cues; `GridHelper` defaults to the XZ
 * plane (Y-up convention) so it is rotated -90 deg about X to bring it
 * into the same Z = 0 plane - a rotation of a purely decorative helper
 * object, not of any scientific data (spec §3/§45's constraint is about
 * catalog object positions, not visual reference geometry).
 */
export function createGalacticPlane(radiusPc: number): Group {
  const group = new Group();
  group.name = "galactic-plane";

  const size = radiusPc * 2.5;

  const plane = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({
      color: 0x3a5a8f,
      transparent: true,
      opacity: 0.05,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(plane);

  const divisions = 16;
  const grid = new GridHelper(size, divisions, 0x3a5a8f, 0x3a5a8f);
  grid.rotation.x = -Math.PI / 2;
  const gridMaterial = grid.material as LineBasicMaterial | LineBasicMaterial[];
  for (const material of Array.isArray(gridMaterial) ? gridMaterial : [gridMaterial]) {
    material.transparent = true;
    material.opacity = 0.08;
    material.depthWrite = false;
  }
  group.add(grid);

  return group;
}
