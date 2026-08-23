import { describe, expect, it } from "vitest";
import { skyViewTargets } from "../src/ui/skyView";

/**
 * Issue #187: `skyViewTargets` is the one pure decision this module makes -
 * the ordered list of Sesame-resolvable names to try for a star (its own
 * `name` first, then `aliases` as fallbacks). Everything else in
 * `ui/skyView.ts` (loading the CDN script, creating/reusing the Aladin
 * instance, calling `gotoObject`) is DOM/network orchestration and isn't
 * unit-tested here, same constraint noted in `ui/orbitDiagram.ts` /
 * `ui/infoDialog.ts` (`vitest.config.ts` runs with `environment: "node"`).
 */
describe("skyViewTargets", () => {
  it("tries the star's own name first", () => {
    expect(skyViewTargets({ name: "NAME Proxima Centauri", aliases: [] })).toEqual([
      "NAME Proxima Centauri",
    ]);
  });

  it("falls back to each alias in catalog order after the primary name", () => {
    expect(
      skyViewTargets({
        name: "* 82 Eri",
        aliases: ["HD 20794", "HIP 15510", "GJ 139"],
      }),
    ).toEqual(["* 82 Eri", "HD 20794", "HIP 15510", "GJ 139"]);
  });

  it("returns just the name when there are no aliases on record", () => {
    expect(skyViewTargets({ name: "Sirius", aliases: [] })).toEqual(["Sirius"]);
  });
});
