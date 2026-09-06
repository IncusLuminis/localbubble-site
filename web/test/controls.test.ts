import { describe, expect, it } from "vitest";
import { shouldShowModelTuning, shouldShowRealworldTuning } from "../src/ui/controls";
import { STAR_RENDER_STYLES } from "../src/scene/starRenderStyle";

/**
 * Issue #18 (Epic #7): `createSettingsPanel` itself builds real DOM
 * (`document.createElement`), which this repo's DOM-free
 * `environment: "node"` Vitest config can't construct - see
 * `test/fullscreenToggle.test.ts`'s docstring for the same split elsewhere
 * in this suite (and `ui/controls.ts`'s own `shouldShowRealworldTuning`
 * docstring for why this one predicate was pulled out specifically so it
 * could be tested here). This covers the acceptance criterion "toggling Star
 * Rendering between MODEL/REALWORLD swaps the visible control group" at the
 * level this test environment can actually reach; the DOM wiring around it
 * (the `.classList.toggle("visible", ...)` call and the `<select>` change
 * listener) is straightforward enough to verify live, matching this
 * codebase's existing convention for this panel's other controls (Radius,
 * Object size, Star Rendering itself - none of which have DOM-level tests
 * either).
 */
describe("shouldShowRealworldTuning", () => {
  it("is true for REALWORLD", () => {
    expect(shouldShowRealworldTuning("REALWORLD")).toBe(true);
  });

  it("is false for MODEL", () => {
    expect(shouldShowRealworldTuning("MODEL")).toBe(false);
  });

  it("agrees with STAR_RENDER_STYLES on exactly one style showing the tuning groups", () => {
    const shown = STAR_RENDER_STYLES.filter(shouldShowRealworldTuning);
    expect(shown).toEqual(["REALWORLD"]);
  });
});

/**
 * Issue #18 follow-up: the MODEL-only mirror of the suite above, covering
 * the new "Model" tuning section's (Marker opacity/Diffuse structure
 * opacity) show/hide predicate - same DOM-free rationale as
 * `shouldShowRealworldTuning`'s own docstring.
 */
describe("shouldShowModelTuning", () => {
  it("is true for MODEL", () => {
    expect(shouldShowModelTuning("MODEL")).toBe(true);
  });

  it("is false for REALWORLD", () => {
    expect(shouldShowModelTuning("REALWORLD")).toBe(false);
  });

  it("agrees with STAR_RENDER_STYLES on exactly one style showing the tuning section", () => {
    const shown = STAR_RENDER_STYLES.filter(shouldShowModelTuning);
    expect(shown).toEqual(["MODEL"]);
  });

  it("is never true for the same style shouldShowRealworldTuning is true for", () => {
    for (const style of STAR_RENDER_STYLES) {
      expect(shouldShowModelTuning(style)).toBe(!shouldShowRealworldTuning(style));
    }
  });
});
