import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";

/**
 * The Sun marker at the coordinate origin (spec Idea.md §6, §30/"Sun
 * rendered at the origin" per issue #64's acceptance criteria). The Sun is
 * always exactly (0, 0, 0) by definition of the heliocentric frame (spec
 * §6) - this is the one position in the whole app that is legitimately a
 * literal constant rather than data read from `scene.json`, since it is
 * the coordinate system's own origin, not a measured scientific value.
 *
 * Rendered distinctly from catalog objects: a small bright core plus a
 * faint translucent halo, restrained rather than a lens-flare/glow effect
 * (spec §30's "not photorealistic").
 */
export function createSunMarker(): Group {
  const group = new Group();
  group.name = "sun";

  const core = new Mesh(
    new SphereGeometry(3, 24, 16),
    new MeshBasicMaterial({ color: 0xfff3c4 }),
  );
  group.add(core);

  const halo = new Mesh(
    new SphereGeometry(6, 24, 16),
    new MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  group.add(halo);

  group.position.set(0, 0, 0);
  return group;
}
