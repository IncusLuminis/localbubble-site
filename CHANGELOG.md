# Changelog

All notable changes to this project are documented in this file. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Visual star-rendering style**: a second, toggleable way to render the
  catalog's ~820 stars (Settings panel, "Star Rendering: Model / Visual"),
  alongside the original marker-sphere rendering (now labeled "Model").
  Visual renders each star as a single twinkle/spike sprite whose size,
  color, and glow are driven by its real absolute magnitude and spectral
  type, with a Sun-relative distance falloff that tapers very luminous but
  very distant giants back down so they don't dominate the view when
  zoomed out to the catalog's full extent. A live-tunable surface in the
  Settings panel (bloom strength/radius/threshold, color-bloom
  compensation, per-tier size boost, faint-star minimum size, spike
  length/width, intensity, and the distance-falloff pair) lets the whole
  look be adjusted without a rebuild. Click-to-inspect picking, the
  radius filter, category visibility, and the "Object size" slider all
  work the same way under both styles. Model separately gained its own
  Marker opacity / Diffuse structure opacity sliders.
- Cookie-consent banner; Settings-panel choices (star rendering style,
  radius filter, and every tuning slider) now persist across visits.
- **Visual is now the default star-rendering style** for a first-time
  visitor (or anyone who declined/never saw the cookie-consent prompt).
  A returning visitor who explicitly chose Model, and accepted
  persistence, keeps seeing Model exactly as they left it.

### Fixed

- A GPU memory leak: switching away from Model repeatedly (Model → Visual
  → Model → ...) never freed the outgoing Model star bucket's own
  `InstancedMesh` buffers, growing GPU memory usage without bound over
  many toggles. The outgoing bucket's mesh is now disposed on teardown
  (its shared geometry/material caches are untouched, since those are
  reused by every bucket).
- Visual's distance-falloff defaults had shipped effectively disabled
  (threshold above every real star's distance, strength at "off"), so the
  very largest, most distant giants in the catalog still rendered
  oversized at extreme zoom - exactly the look the falloff was added to
  prevent. Re-tuned the defaults so the falloff actually engages beyond
  the Local Bubble.
- The "Object size" slider used to move Model markers' and diffuse
  structures' real positions outward/inward along with their size; it now
  scales size only, and is hidden entirely while Visual is active (Visual
  has its own, position-safe size control).
- A stale guard in the click handler silently disabled all picking under
  Visual for one revision; click-to-inspect now works correctly for both
  styles.
- The Time Controls player (scrubbing/playing through time) didn't move
  animated stars, their labels, or their motion trails at all while
  Visual was active - they now animate correctly under both styles.

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
