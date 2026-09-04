# Migration history

This repository (`IncusLuminis/localbubble-site`) was extracted from the
`local-galactic-structures/` subdirectory of the private
`IncusLuminis/visualization-studio-tools` monorepo on 2026-09-04, as part of
shipping the 1.0 release to [localbubble.space](https://localbubble.space).

**Git commit history was preserved in full** (via `git filter-repo`, with
paths flattened so `local-galactic-structures/web/` became `web/`, etc.) -
every commit, author, date, and message from the project's development is
still here in `git log`.

**GitHub Issues, Pull Requests, and the project board were NOT migrated** -
GitHub doesn't support bulk-transferring issues while preserving their
numbering and sub-issue (Epic → Story) links, and the effort/risk of doing
so per-issue wasn't worth it for what is now closed, historical record. That
detailed history - the full reasoning behind every design decision, every
Coder/Validator review, every "why we chose X over Y" - remains readable at
**https://github.com/IncusLuminis/visualization-studio-tools/issues**
(search/filter by the `galactic-structure` label). This repository's own
issue tracker starts fresh from here for future work.

## Summary of the journey (by Epic, roughly chronological)

- **Initial catalog & scientific pipeline** (spec `Idea.md`, phases 1-4): object
  schema, catalog storage, RA/Dec/distance → Galactic XYZ transforms, a live
  SIMBAD/Gaia/VizieR + literature data-acquisition layer, and the original
  ≥20-object seed catalog (molecular clouds, star clusters, OB associations,
  Vela SNR, Local Bubble). The three large-scale structure models - Gould
  Belt, Radcliffe Wave, Local Bubble - built against their respective papers
  (Perrot & Grenier 2003; Konietzka et al. 2024; Alves et al. 2018).
- **v1.2** (`spec/Idea-v1.2-individual-stars.md`): ~585 individually named
  stars and ~229 additional star clusters/associations, identified from a
  reference poster (candidate names only, never positions) and resolved for
  real against SIMBAD/Gaia.
- **v1.3** (`spec/Idea-v1.3-visual-fidelity-and-navigation.md`): ~122
  individual stars from RECONS's "100 Nearest Star Systems" census, camera-
  distance LOD-gated so the dense nearby batch doesn't clutter the default
  view; camera presets, radius filter, PNG export, inspector.
  RECONS: https://www.astro.gsu.edu/RECONS/TOP100.posted.htm
- **Motion player / Time Controls**: a full "Eyes on the Solar System"-style
  scrubbable time control, showing real measured proper motion + radial
  velocity as animated star trajectories and velocity vectors, with a
  matching motion-trail visualization.
- **Scale-relative sizing** (star markers, velocity vectors, motion trails):
  converted a set of visual constants originally tuned only for the
  ~11.26 pc RECONS sphere into a shared, continuous view-scale function so
  markers/vectors/trails read at a consistent, natural visual weight from
  the RECONS sphere out through the ~60 pc Local Bubble and into open space
  (out to the catalog's real ~1840 pc edge).
- **Open-space velocity data**: backfilled measured velocity (SIMBAD
  proper motion + radial velocity) for the ~587 catalog stars beyond the
  Local Bubble, and removed the UI gating that had previously restricted
  velocity vectors/Time Controls to only the Local Bubble.
- **Clusters & diffuse structures get real visual size**: backfilled
  physical size (`size_pc`) for star clusters, associations, and diffuse
  structures (molecular clouds, HII regions, planetary nebulae, supernova
  remnants), and switched the diffuse types from a uniform point-marker dot
  to a translucent extended-volume rendering reflecting their real size.
- **Visual design pass**: distinct colors and shapes per object-type family
  (pink molecular clouds, coral HII regions/nebulae, yellow star clusters as
  a bounded sphere with contained "star sparks," stellar associations as a
  loose amorphous haze with scattered sparks) - plus a real bug fix (an
  invisible picking-proxy mesh sized to a large structure's full visual
  radius could "steal" clicks meant for a smaller object rendering visually
  on top of it).
- **Molecular cloud / nebula catalog expansion**: mined the full Zucker et
  al. (2020) "compendium of distances to molecular clouds" (VizieR
  `J/A+A/633/A51`) for every well-known named region within the spec's
  ~800 pc scope not yet in the catalog - North America Nebula, Cocoon
  Nebula (IC 5146), Circinus, Norma, the Christmas Tree Cluster/Cone Nebula,
  Witch Head Nebula, the Lambda Orionis ring, Draco Cloud, Hercules,
  Pegasus, Spider Cirrus, Ursa Major Cloud, Iris Nebula, and Veil Nebula
  (Cygnus Loop) - each independently verified via live SIMBAD queries, with
  honest exclusions (and corrections of earlier wrong exclusions) documented
  along the way.
- **UI polish**: an "About" dialog and a "Simplifications & Sources" dialog
  (listing the deliberate simplifications this visualization makes, and
  every literature/data source behind it - see the app's own "S" button);
  removal of a toolbar-button lock/escape-hatch mechanism that had dimmed
  part of the toolbar during motion-player playback.

## Data sources

SIMBAD (CDS, Strasbourg), Gaia (ESA, DR2/DR3), VizieR (CDS, Strasbourg),
Harvard Dataverse, and RECONS - see the running app's own "Simplifications &
Sources" dialog, or [`README.md`](README.md), for the full citation list.
