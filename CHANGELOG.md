# Changelog

All notable changes to this project are documented in this file. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-09-04

First public release. Live at [localbubble.space](https://localbubble.space).

### Overview

Local Bubble is an interactive 3D map of the Solar neighborhood: real stars,
star clusters, stellar associations, molecular clouds, and nebulae, each
placed at its actual derived Galactic XYZ position - not sketched or
hand-placed - alongside three independent, literature-fitted models of the
region's large-scale structure (the Gould Belt, the Radcliffe Wave, and the
Local Bubble cavity itself). A built-in motion player animates real measured
stellar motion (proper motion + radial velocity) forward and backward in
time.

### Highlights

- **Full 3D navigation** of the Solar neighborhood out to a real catalog
  edge of ~3,400 pc, with camera presets, a search/go-to-object dialog, and
  a radius filter.
- **Time Controls (motion player)**: scrub or play real stellar motion
  forward/backward, with velocity vectors and motion trails that scale
  naturally at any zoom level, from the ~11.26 pc RECONS sphere out through
  the ~60 pc Local Bubble and into open space.
- **Three competing large-scale structure models**, individually
  toggleable for comparison: the Gould Belt (Perrot & Grenier 2003), the
  Radcliffe Wave (Konietzka et al. 2024), and the Local Bubble (Alves et
  al. 2018).
- **A curated, real catalog**: 1,098 objects total - 820 individually named
  stars, 228 star clusters, 26 molecular clouds/nebulae, 10 stellar
  associations, 5 HII regions, 4 planetary nebulae, and 3 supernova
  remnants - each resolved live against SIMBAD, Gaia, and VizieR, or
  sourced from cited literature where a direct catalog match wasn't
  available.
- **Distinct, deliberate visual language** per object-type family (pink
  molecular clouds, coral HII regions/nebulae, translucent-sphere star
  clusters with contained "star sparks," loose amorphous-haze stellar
  associations), tuned for a readable scene rather than a literal-scale
  rendering.
- **An in-app "Simplifications & Sources" dialog** listing every
  deliberate simplification the visualization makes and the literature/data
  source behind each - so the picture is never mistaken for more precise or
  complete than it actually is.

### Data

- Position/distance data resolved live from SIMBAD, Gaia (DR2/DR3), and
  VizieR, via Astropy/astroquery.
- Molecular cloud distances sourced from Zucker et al. (2020), "A
  compendium of distances to molecular clouds in the Star Formation
  Handbook" (VizieR `J/A+A/633/A51`).
- Star cluster/association structural radii sourced from Cantat-Gaudin et
  al. (2020) and Tarricq et al. (2022).
- Nearest-star census cross-referenced against RECONS's "100 Nearest Star
  Systems."

### Infrastructure

- Static Three.js/TypeScript single-page app, no server/database - the
  entire runtime footprint is one HTML file, one JS bundle, one CSS file,
  and one ~3 MB `scene.json` data file.
- Deployed on Cloudflare Pages, with a GitHub Actions workflow
  (`.github/workflows/deploy.yml`) that runs the full test suite and builds
  the app on every push to `master` before deploying.
- Extracted, with full commit history, from the private
  `IncusLuminis/visualization-studio-tools` monorepo - see
  [`MIGRATION.md`](MIGRATION.md) and [`DEVELOPMENT_TIMELINE.md`](DEVELOPMENT_TIMELINE.md).

### Known limitations

See the app's own "Simplifications & Sources" dialog (the "S" toolbar
button) for the full, current list. In short: the large-scale structure
models are abstractions with no sharp physical boundary; the catalog is a
curated selection, not an exhaustive census; velocities are Sun-relative and
don't model Galactic-Center gravity or orbital curvature; nothing is
rendered at true physical scale; and extended-object positions are
single best-estimate points, not measured 3D centroids.
