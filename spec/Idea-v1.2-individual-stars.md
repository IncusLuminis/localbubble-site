Local Galactic Structures 3D Visualizer — v1.2 Addendum: Individual Stars

0. Relationship to the v1.0 spec (Idea.md)

This is an additive increment, not a replacement. Every architectural principle in Idea.md still applies without change:

* the raw → normalized → derived data pipeline (§13);
* the `AstronomicalObject` schema (§7) — already includes `object_type: "star"` in its known-type reference set (§8), unused until now;
* the astropy-only coordinate transform (§6);
* the data acquisition layer and its SIMBAD/Gaia/VizieR/literature adapters (§12), already built (Story #58);
* the renderer-independent scene export (§21) and the web viewer (§22-31), already built (Stories #63-65).

Nothing here requires new architecture. Per the request that produced this document: "поскольку визуализация уже есть, речь идёт о линейном увеличении количества объектов" — this is a linear growth in catalog size, handled by the existing pipeline, plus one focused scaling Story on the web viewer's rendering side (§7 below).

⸻

1. Goal

Add individual stars to the catalog — not just clusters, associations, and clouds — with a density that increases toward the Sun, matching how the real stellar neighborhood actually looks: more resolvable named stars nearby, thinning out toward the 800 pc edge.

⸻

2. Source and method — candidate identification only, never position extraction

Reference: Galaxy Map's "Gaia star density map" / "The solar neighbourhood and environs within 800 parsecs" poster (galaxymap.org, Twitter @galaxy_map; the same image linked from Wikipedia's Gould Belt article, File:Galaxymap.com, map of the solar neighbourhood 800 parsecs (2020).jpg). The poster's own acknowledgments cite Gaia (ESA/DPAC) and SIMBAD (CDS Strasbourg) as its underlying data sources — i.e. it is itself a visualization of the same kind of data our pipeline already resolves against directly.

This project's existing rule (Idea.md §10) governs how this source may be used:

> Do not infer positions from screenshots, diagrams, or infographics. Reference maps may be used only to identify candidate objects that are later resolved against scientific sources.

Concretely for this Story:

* The poster is read only to build a **candidate name list** — the text of every green "luminous star" label (Idea.md's source poster defines this as absolute magnitude < −2.8) and, optionally, every white star-cluster label not already in our catalog.
* No pixel coordinate, no on-image distance bracket (`[+57]`-style labels giving height above/below the Galactic plane), and no visually-estimated position is ever written into `AstronomicalObject`. Those bracketed numbers are a useful cross-check after independent resolution (see §5), never a source value.
* Every candidate name is then resolved independently against SIMBAD/Gaia (Story #58's existing adapters) for its real RA/Dec/parallax-derived distance, exactly like every object in the current 20-object catalog (Story #59). If a candidate can't be confidently resolved, it's dropped or flagged — not guessed.

Label formats observed on the poster (all standard, all SIMBAD-resolvable): Bayer designations (`β¹ Sco`, `γ Lup`, `ε Cen`), proper names (`Canopus`, `Spica`, `Acrux`, `Mimosa`), and Henry Draper catalog numbers for fainter entries (`HD 51799`, `HD 102839`). No ambiguous or invented identifiers were observed in spot-checked regions.

⸻

3. Object schema — no changes needed

`object_type: "star"` is already a first-class member of the known-type reference set (Idea.md §8) and was already schema-valid in Story #57 — it has simply never been populated. `AstronomicalObject`, `Coordinates`, `Distance`, `Cartesian`, `Source`, `Group`, `Visual` (Idea.md §7) all apply to a star exactly as they do to a cluster or cloud. No migration, no new fields.

⸻

4. Density-toward-Sun policy — decided

**v1.2 takes the poster's full labeled-star set as-is, nothing more.** Confirmed with the human owner (2026-08-18): no supplemental systematic nearby-star catalog for v1.2. Spot-checking the poster shows label density is already naturally higher near the map's center (closer to the Sun) than near its 800 pc edge — this is an inherent property of which stars are luminous/resolvable/worth labeling at that distance, not something that needs to be separately engineered. Simply resolving every labeled star already produces the density gradient this request asks for.

A systematic magnitude-completeness catalog for a smaller inner radius (e.g. the Gaia Catalogue of Nearby Stars or RECONS' "nearest 100 stellar systems," for the closest 50-100 pc) remains a legitimate v1.3-or-later follow-up if the v1.2 result looks too sparse close-in once real numbers are in — explicitly out of scope for v1.2 itself, not a silently-dropped idea.

⸻

5. Dual provenance (mirrors Story #62's precedent)

Story #62 (Local Bubble) already established the pattern of keeping two separate, clearly labeled provenance trails when a value's *existence/selection* and its *measured value* come from different places (`source.reference` vs `source.secondary_reference`). Apply the same split here:

* **Candidate-selection provenance**: "identified as a candidate via Galaxy Map (galaxymap.org), 'Gaia star density map — the solar neighbourhood and environs within 800 parsecs', 2020" — recorded once, e.g. in each object's `notes` field or a shared `secondary_reference`-equivalent, never presented as if it were the measurement itself.
* **Scientific-value provenance**: the actual SIMBAD/Gaia record each star resolves to, in `source.reference`/`source.catalog`, exactly like every other object in the catalog today.

⸻

6. Resolution approach

Reuse Story #58's `SimbadResolver` as the primary path — every label format observed (Bayer designation, proper name, HD number) is exactly what SIMBAD's name resolution is built for. Use `GaiaResolver` as a cross-check/fallback for parallax precision on stars where SIMBAD's own distance field is weak or absent, same as the batch-resolution pattern already used successfully in Story #59 (three parallel research batches, each citing real sources, honestly reporting anything unresolved rather than fabricating it — follow that same standard here).

Given the likely count (see §8), plan for the same parallel-batch pattern used in Story #59: split the candidate list into several disjoint batches (e.g. by sky region/octant, mirroring the poster's own I/II/III/IV quadrant labels), each batch producing its own intermediate JSON of resolved records, merged into one PR the same way Story #59's three batches were merged.

⸻

7. Required companion work: web viewer scaling

This is not optional polish — it must ship as part of v1.2, not be deferred, because the current renderer is explicitly built for the old 20-object scale:

* `web/src/scene/objects.ts` currently creates one plain `THREE.Mesh`/`SphereGeometry` per catalog object with a code comment explicitly noting this was a deliberate choice *because* the catalog was only 17-20 objects, and that `InstancedMesh` would be the scaling path once that stopped being true (Idea.md §44 already anticipated this). A jump to hundreds of stars is exactly the trigger condition that comment describes — batch stars into one (or a handful of, per object_type/color) `InstancedMesh` instances instead of one `Mesh` per star.
* `web/src/scene/labels.ts` uses `CSS2DRenderer` (real DOM elements, one per label) — this is the actual bottleneck at this new scale, well before WebGL geometry becomes one (DOM-based label rendering typically starts showing frame-rate impact somewhere in the range of a few hundred simultaneously *visible* labels, independent of total catalog size). The existing radius-filter and camera-distance label cutoff (`DEFAULT_MAX_LABEL_DISTANCE_PC`) already helps, but should be re-tuned/re-verified against the real new object count rather than assumed to still be adequate — and a stricter default (e.g. "only show labels for the N nearest/brightest currently-visible stars" or "labels off by default above some object count") may be needed.

⸻

8. Scale estimate: ~590 candidate stars

Measured, not guessed (2026-08-18): the green "luminous star" label color was isolated across the full ~10000×14088 px source via a simple RGB heuristic (G channel dominant over both R and B), connected-component-grouped to merge each label's individual glyphs into one blob per word, and filtered to a plausible single-label pixel-area range. Result: **591 candidate label components** (47 sub-threshold fragments discarded as noise, 1 oversized blob likely a small merge of two adjacent labels). The method was validated by overlaying its detections on a known ~1800×1800 px region and visually confirming every green label was boxed with no false positives from the cyan cluster-age dots, yellow region names, or white cluster names (all excluded by the color heuristic as intended).

**Use ~590 as the planning number** for Story #88's batch sizing (§6) and Story #89's `InstancedMesh`/label-scaling work (§7) - both are real, not just "eventually." This is a candidate-label count, not a final catalog count: Story #87's actual manual/careful read may merge a few (e.g. a binary system labeled once), split a few (the "1 oversized blob" case above), or drop a handful that turn out unresolvable in SIMBAD - expect the final number to land within roughly 10-15% of 590, not a different order of magnitude. If Story #87 finds a result far outside that range, treat it as a signal to double-check the extraction methodology rather than accept it silently.

⸻

9. Proposed Stories (new Epic, separate from the closed v1.0 Epic #56)

1. **Identify candidate star list from the Galaxy Map poster.** Careful, verifiable region-by-region read of every green (and optionally white-cluster) label across the full-resolution image; output a plain candidate-name list with each name's approximate map region, explicitly NOT a coordinate list. Cross-check against the existing 20-object catalog to avoid re-adding what's already there (e.g. Pleiades, Hyades already exist; several poster-labeled clusters like IC 2391/IC 2602 do not).
2. **Resolve candidates into the catalog** (parallel batches, mirroring Story #59): live SIMBAD/Gaia resolution per candidate, dual-provenance `source` fields per §5, honest reporting of anything unresolved, merged into `data/normalized/initial_catalog_records.json` alongside the existing 20 objects, id-uniqueness enforced (already guaranteed by Story #71's `save_catalog` check).
3. **Web viewer scaling**: `InstancedMesh` for catalog-object spheres, and a revised label-density strategy, sized against the real object count Story 2 produces. Include a regression check against the current 57-test web suite plus new tests for the instanced-rendering path.
4. Optionally: fold the poster's additional star clusters (IC 2391, IC 2602, Platais 8/9, Alessi 3/13, Collinder 135, UBC 7, etc., all already SIMBAD-resolvable) into Story 2's scope, or split into its own small Story — cheap to include since it reuses the exact same resolution pipeline as individual stars, just a different `object_type`.

⸻

10. Explicit non-goals for v1.2

* Not every star in Gaia DR3, or even every star visible to the naked eye — scope stays bounded to what the reference poster actually labels (its own "luminous star, abs mag < −2.8" cutoff), not an open-ended deep catalog.
* No new stellar physical properties (spectral type, temperature, etc.) beyond what `AstronomicalObject`'s existing schema already models — that would be a schema-extension proposal for a future spec version, not part of this one.
* No change to the Gould Belt / Radcliffe Wave / Local Bubble model layers — this addendum is catalog-only.
