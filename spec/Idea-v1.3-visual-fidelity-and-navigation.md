Local Galactic Structures 3D Visualizer — v1.3 Addendum: Visual Fidelity & Navigation

0. Relationship to v1.0/v1.2

Additive increment, no architectural changes. v1.2 (`Idea-v1.2-individual-stars.md`) grew the catalog from 20 to 834 objects (585 stars, 229 clusters/associations). Using the finished viewer at that scale (2026-08-19) surfaced six concrete gaps — one data-duplication bug, one missing scientific detail, two visual-hierarchy/legibility problems, one explicitly-deferred feature (already flagged as future work in v1.2 §4), and one missing navigation affordance. This addendum specifies all six as a single new Epic, closing out v1.2's Epic #86.

⸻

1. Goal

Make the 834-object scene visually honest and navigable at both scales it now spans — the ~800pc overview and the few-tens-of-pc solar neighborhood — without regressing the DOM/GPU-cost work done in Story #89.

⸻

2. Findings and required changes

2.1 Local Bubble is rendered twice, redundantly

The catalog holds a single `object_type: "bubble"` point (`local-bubble-centroid`, notes: "This is a single-point/centroid catalog-object representation... distinct from the separate, more detailed ellipsoid geometry in Story #62's `models/local_bubble.yaml`"). The web viewer renders BOTH: the catalog point as a generic instanced marker sphere (`web/src/scene/objects.ts`), and the structure layer as a translucent wireframe ellipsoid (`web/src/scene/structures.ts`'s `createLocalBubbleLayer`). Same real object, two independent visual representations, on screen simultaneously by default.

Confirmed via the numbers (2026-08-19): catalog point center is 35.1pc from the Sun; its rendered marker radius is `markerRadiusPc(60) = clamp(60/4, 4, 45) = 15pc` (objects.ts's visual-only compression, not a literal size) — so the Sun visibly sits *outside* the small marker sphere, while it genuinely sits *inside* the true-scale, unrotated ellipsoid ((10.2/60)²+(33.6/60)²+(0/162)² ≈ 0.34 < 1). This mismatch is what surfaced the duplication in the first place.

**Decision**: the structure layer (physically-scaled, source-fitted shape) is the authoritative visual for the Local Bubble. The catalog point still needs to exist (it's what the Inspector/search will resolve to, and what carries the citation), but must not render its own competing marker sphere when a structure layer already represents it.

Required change: generalize the existing `SUN_OBJECT_ID` exclusion pattern in `objects.ts` (which already excludes one specific catalog entry from the generic point-marker render loop because it has its own dedicated marker) to also exclude `local-bubble-centroid` for the same reason. Keep the catalog record itself untouched (schema, data, Inspector access via search/click on the structure layer if feasible) — this is a render-loop-only exclusion, not a data change.

2.2 Local Bubble ellipsoid ignores its own fitted orientation

`createLocalBubbleLayer` (`structures.ts`) explicitly does NOT apply the Alves et al. (2018) orientation Euler angles (`theta_ell_deg`, `psi_ell_deg`, `phi_ell_deg`, already present in `models/local_bubble.yaml` and threaded through to `scene.json`) — the code comment calls this out as a known, deliberate MVP shortcut ("an axis-aligned ellipsoid is still a reasonable MVP visual... adding the Euler-angle rotation is a well-scoped follow-up"). That follow-up is now in scope.

Required change: apply the fitted rotation to the ellipsoid mesh (three.js `Euler`/`Quaternion`, applied to `mesh.rotation`/`mesh.quaternion` before/alongside the existing non-uniform `scale.set(a_pc, b_pc, c_pc)`). Care point: Alves et al. (2018)'s Euler-angle convention (which rotation order, which axes) must be matched correctly, not guessed — the paper (already the model's cited `source.reference`) defines it precisely; get the convention from the paper's own Sec. 3/Table 1 description, not by trial-fitting to "looks about right". Sanity-check the result against the paper's own independently-stated fact that the long (c) axis points toward (l=216°, b=60°) (`long_axis_l_deg`/`long_axis_b_deg`, already in the model file) — after rotation, the ellipsoid's long axis direction in the scene should numerically match that galactic direction; write this as an automated test, not just a visual check.

2.3 No visual size hierarchy between point objects and extended structures

At 834-object scale, individual stars (no physical `size_pc`, falling to `MIN_MARKER_RADIUS_PC = 4pc`) render visually comparable in scale to star clusters and associations, and not clearly smaller than they should be relative to the model-layer overlays (Gould Belt ring, Radcliffe Wave spine, Local Bubble ellipsoid). Stars are point sources — their true physical size is many orders of magnitude below 1pc — so any nonzero marker radius is already a visual convention, not a measurement (spec §19 already requires this distinction to stay explicit in the data model; it also needs to stay explicit and *visually legible* in the render).

**Decision**: markers need a genuine three-tier visual hierarchy, small→large: (1) individual stars — small, near-uniform "point" markers, explicitly decoupled from `size_pc` since they don't meaningfully have one; (2) clusters/associations — mid-sized markers, may still take some cue from `size_pc` where the catalog has it; (3) extended structures (molecular clouds, HII regions, bubbles) and the Gould Belt/Radcliffe Wave/Local Bubble model overlays — clearly the largest/most prominent. Exact numbers are a rendering/UX call for the implementing Story, not prescribed here, but the acceptance criterion is comparative and testable: at a fixed zoom, `markerRadiusPc` for a `star` must be strictly smaller than for a `star_cluster`/`stellar_association` with any given `size_pc`, which in turn must not visually dominate the structure-layer overlays.

2.4 No dense, close-in solar-neighborhood detail

This is the exact idea v1.2 §4 flagged and explicitly deferred: "A systematic magnitude-completeness catalog for a smaller inner radius (e.g. the Gaia Catalogue of Nearby Stars or RECONS' 'nearest 100 stellar systems,' for the closest 50-100 pc) remains a legitimate v1.3-or-later follow-up if the v1.2 result looks too sparse close-in." It does — v1.2's poster-sourced star set is a "luminous star" (abs mag < −2.8) selection, which is heavily biased toward bright, hence usually more distant, stars; it does not aim for completeness in the immediate solar neighborhood, so nearby but intrinsically faint stars (most real stars within 20pc, e.g. red dwarfs) are largely absent.

**Decision**: add a second, disjoint resolution pass — same pipeline (`SimbadResolver`, dual provenance) as Stories #88/#90, but sourced from a genuine nearby-star census rather than the poster: RECONS' "nearest 100 stellar systems" (or an equivalent up-to-date nearby-star list, e.g. a magnitude/parallax-limited Gaia query) within roughly 20-25pc of the Sun. Candidate-selection provenance for these becomes "RECONS nearest stellar systems" (or the chosen source) instead of the Galaxy Map poster — keep the dual-provenance pattern (§5 of the v1.2 addendum) but with the correct new primary source, not the poster (this data does not come from the poster and must not cite it as if it did).

Rendering requirement: this dense set must NOT be shown at the default/overview zoom (it would reintroduce exactly the label/marker clutter problem Story #89 fixed) — gate its visibility on camera distance from the Sun, analogous to the dynamic label-distance mechanism already built for #94 (`effectiveMaxLabelDistancePc`), but applied to marker/instance visibility, not just labels. Reasonable default: only render this batch when the camera is within roughly the batch's own collection radius (e.g. ~20-25pc) of the Sun — exact threshold is an implementation call, but must be camera-distance-driven (LOD), not a static always-on toggle, per the user's explicit requirement ("но только когда масштаб станет соответствующий").

2.5 The Sun has no label

`scene/sun.ts`'s dedicated Sun marker (added for issue #64, kept distinctly styled per PR #79's fix) has no `CSS2DObject` label attached — `objects.ts`'s catalog-point label-building loop explicitly excludes the Sun's own catalog record (`SUN_OBJECT_ID`) to avoid double-rendering a generic marker for it, but nothing fills in a label for the dedicated marker in its place. Confirmed absent by reading `labels.ts`/`main.ts`: the label-building path only iterates catalog-derived instance buckets, which never include the Sun.

Required change: give the Sun's dedicated marker its own `CSS2DObject` label ("Sun"), wired into the same show/hide toggle system as other labels, but exempt from the distance-based hide-at-large-zoom and `MAX_VISIBLE_LABELS` nearest-N cap (spec §25: "remain legible while navigating" — the coordinate origin should never disappear), mirroring how the currently-selected object's label is already exempted from those same cutoffs.

2.6 No search / go-to-object

Spec §22 lists required web-visualizer capabilities (WebGL rendering, camera control, picking, labels, layer toggles, camera presets, radius control) but no search — reasonable for a 20-object MVP, a real gap at 834 objects. User wants: type a name (e.g. "Alpha Centauri"), the view centers/frames on the matching object at a sensible zoom.

Required change: a search input (new small UI component, mirroring the existing controls' style in `web/src/ui/`) matching against each object's `name` and `aliases` (already present in the schema/scene dataset — no data change needed), case-insensitive substring match at minimum. On a match: move the camera to frame that object closely (reuse/extend the existing camera-pose infrastructure in `scene/camera.ts`/`scene/cameraPresets.ts` — e.g. a variant of the existing "Sun-centered" pose logic, generalized to "object-centered" at a distance proportional to the object's own `markerRadiusPc` or a fixed close-up default), and select it (reuse `selectObject`, so the Inspector opens and its label shows, consistent with clicking it directly). Ambiguous/multiple matches and zero matches both need defined, non-crashing behavior (e.g. a dropdown of matches for ambiguous input, a visible "not found" state for zero) — exact UX is an implementation call.

⸻

3. Proposed Stories (new Epic, separate from the closed v1.2 Epic #86)

1. **Deduplicate the Local Bubble's two representations** (§2.1) — small, isolated to `objects.ts`'s point-marker exclusion list.
2. **Apply real orientation to the Local Bubble ellipsoid** (§2.2) — isolated to `structures.ts`, plus a new automated orientation-sanity test. Verify the Alves et al. (2018) Euler-angle convention carefully against the paper before implementing, don't guess it.
3. **Visual size hierarchy: stars vs. clusters vs. extended structures/model layers** (§2.3) — touches `objects.ts`'s marker-radius derivation; sequence after or carefully alongside Story 1 (both touch `objects.ts`) to avoid unnecessary merge friction.
4. **Dense nearby-star catalog with camera-distance-gated (LOD) display** (§2.4) — the largest Story: new Python-side resolution batch (mirrors #88/#90's pattern, new source, correct dual provenance) plus new web-side camera-distance-driven visibility logic. Should probably split into a data sub-Story and a rendering sub-Story if it proves too large for one PR, at the implementing Coder's discretion — mirrors how v1.2 split #87/#88 (data) from #89 (rendering).
5. **Label the Sun** (§2.5) — small, isolated to `scene/sun.ts` + `main.ts`'s label wiring.
6. **Search / go-to-object** (§2.6) — new, mostly self-contained UI feature; depends on nothing else in this list, could run in parallel with any of the above.

⸻

4. Non-goals for v1.3

* No change to the Gould Belt / Radcliffe Wave model layers' own geometry or fitting — only the Local Bubble's orientation (§2.2) is in scope, since it's the one layer with a known, already-flagged shortcut.
* No general "uncertainty visualization" (spec §20 already marks this as explicitly not required).
* No fuzzy/typo-tolerant search beyond case-insensitive substring matching — a stretch goal, not required for v1.3's acceptance.
* No attempt at true photorealistic stellar magnitudes/brightness-based marker sizing — §2.3's hierarchy is a category-tier convention (star vs. cluster vs. structure), not a per-object physical-brightness model.
