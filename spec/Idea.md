Local Galactic Structures 3D Visualizer

1. Goal

Create a standalone project that builds and visualizes a scientifically grounded three-dimensional model of the Solar neighborhood using real astronomical coordinates and measured distances.

The primary purpose is to show where nearby stellar and interstellar structures are actually located relative to one another in 3D space, and to compare large-scale interpretations such as:

* Gould Belt;
* Radcliffe Wave;
* Local Bubble;
* other local Galactic structures added later.

The project must be based on reproducible astronomical data, not manually positioned or generatively invented geometry.

The primary user-facing result should be an interactive web visualizer.

⸻

2. Expected Deliverable

The MVP deliverable is a small interactive website or standalone web application.

The user should be able to open the application and explore a 3D model of the Solar neighborhood.

Expected capabilities:

* rotate the scene;
* zoom;
* pan;
* view the Galactic Plane;
* display the Sun at the coordinate origin;
* display real astronomical objects at real derived XYZ positions;
* enable or disable object categories;
* enable or disable the Gould Belt model;
* enable or disable the Radcliffe Wave model;
* enable or disable the Local Bubble;
* display object labels;
* inspect object metadata;
* select visualization radius;
* switch between useful camera presets;
* export static images;
* optionally export/share the standalone visualization.

The expected conceptual UI is:

Local Galactic Structures
[Stars] [Clusters] [Clouds] [Associations]
[x] Galactic Plane
[ ] Gould Belt
[x] Radcliffe Wave
[ ] Local Bubble
Radius: 800 pc
              Interactive 3D Scene

⸻

3. Core Architectural Principle

Scientific data processing and visualization must be fully separated.

Astronomical sources
        ↓
raw source data
        ↓
normalized astronomical catalog
        ↓
derived Galactic XYZ dataset
        ↓
scene representation
        ↓
web renderer

The renderer must never contain scientific coordinates hard-coded directly into visualization code.

The same derived physical dataset should later be reusable by:

* the web visualizer;
* Jupyter notebooks;
* Blender;
* video production tools;
* publication graphics;
* educational interactive material.

⸻

4. System Architecture

The project should consist of two major subsystems.

4.1 Scientific/Data Pipeline

Responsibilities:

* retrieve or ingest astronomical data;
* normalize object metadata;
* store provenance;
* transform coordinates;
* calculate Galactic XYZ coordinates;
* build model datasets;
* validate results;
* export renderer-ready scene data.

Preferred stack:

Python
Astropy
Pandas
NumPy

4.2 Web Visualizer

Responsibilities:

* load prepared scene data;
* display the 3D Solar neighborhood;
* handle camera navigation;
* render object categories;
* render model overlays;
* display labels and metadata;
* support layer control;
* support visual export.

Preferred renderer:

Three.js

The website should not query Gaia, SIMBAD, VizieR, or other astronomical services at runtime.

All scientific data should be prepared by the Python pipeline.

⸻

5. Core Concept

For each astronomical object collect:

* canonical name;
* aliases;
* object type;
* right ascension;
* declination;
* distance;
* distance uncertainty;
* source/reference;
* additional metadata.

Then transform all objects into a common heliocentric Galactic Cartesian coordinate system.

Pipeline:

catalog sources
    ↓
normalized catalog
    ↓
coordinate transformation
    ↓
Galactic XYZ dataset
    ↓
scene dataset
    ↓
Three.js visualizer

⸻

6. Coordinate System

Use heliocentric Galactic Cartesian coordinates as the primary working coordinate system.

Sun = (0, 0, 0)
X — toward the Galactic Center
Y — direction of Galactic rotation
Z — toward the North Galactic Pole

Source coordinates may be stored as:

RA
Dec
distance_pc

The normalized/derived dataset should also contain:

l_deg
b_deg
x_pc
y_pc
z_pc

All standard astronomical coordinate transformations must use:

astropy.coordinates

Do not implement custom RA/Dec → Galactic transformation logic unless required by a specific published scientific model.

⸻

7. Object Catalog Schema

Minimum normalized object schema:

id: string
name: string
aliases: []
object_type: string
coordinates:
  ra_deg: float
  dec_deg: float
  galactic_l_deg: float
  galactic_b_deg: float
distance:
  value_pc: float
  error_pc: float | null
cartesian:
  x_pc: float
  y_pc: float
  z_pc: float
group:
  primary: string | null
  secondary: []
source:
  reference: string
  url: string | null
  catalog: string | null
visual:
  size_pc: float | null
  color_class: string | null
notes: string | null

Preferred internal storage:

data/normalized/catalog.parquet

CSV may also be generated for inspection and interoperability.

⸻

8. Object Types

At minimum support:

star
star_cluster
stellar_association
molecular_cloud
star_forming_region
hii_region
supernova_remnant
bubble
reference_point

The type system must be extensible without changes to the core architecture.

⸻

9. Initial Object Set

The initial version should focus on structures within approximately 800 pc of the Sun.

Initial catalog should include at least:

Sun
Orion Molecular Cloud Complex
Taurus Molecular Cloud
Perseus Molecular Cloud
Ophiuchus / Rho Ophiuchi
Lupus
Chamaeleon
Cepheus Flare
Pipe Nebula
Pleiades
Hyades
Scorpius-Centaurus Association
Orion OB1
Perseus OB2
Cepheus OB2
Cepheus OB3
Cepheus OB4
Vela region
Vela SNR
Local Bubble

This list is only the initial seed.

The architecture should support expansion to hundreds or thousands of objects.

⸻

10. Data Sources

Every coordinate, distance, uncertainty, or structural parameter must have a traceable source.

Preferred sources:

Gaia
SIMBAD
VizieR
published astronomical catalogs
peer-reviewed papers
3D dust maps

Do not infer positions from screenshots, diagrams, or infographics.

Reference maps may be used only to identify candidate objects that are later resolved against scientific sources.

⸻

11. Data Provenance

Every imported record must preserve provenance.

For each scientific value retain, where applicable:

source catalog
source paper
record identifier
retrieval date
original value
normalized value
transformation method

Example:

source:
  catalog: Gaia DR3
  identifier: "..."
  retrieved: 2026-08-15
  reference: "..."

No scientific value should appear in the derived dataset without a traceable origin.

⸻

12. Data Acquisition Layer

Implement a dedicated data acquisition layer.

Suggested structure:

src/local_galactic_structures/data_sources/
    simbad.py
    gaia.py
    vizier.py
    literature.py

Each adapter returns data that can be normalized into the common object schema.

Conceptual interface:

class ObjectResolver:
    def resolve(self, name: str) -> AstronomicalObject:
        ...

The scientific core must not depend on one specific external service.

All externally retrieved data should be cached locally.

⸻

13. Data Directory Structure

Use strict separation between source, normalized, and derived data.

data/
    raw/
    normalized/
    derived/

Meaning:

raw/

Contains retrieved source material in original form.

normalized/

Contains cleaned records in the internal schema.

derived/

Contains computed values such as Galactic XYZ coordinates and renderer-ready structures.

Raw data must never be modified in place.

⸻

14. Reproducibility

Externally retrieved data must:

* be cached;
* include retrieval date;
* retain source references;
* not be silently overwritten;
* be rebuildable through documented commands.

Maintain a manifest:

data_manifest.yaml

Example:

sources:
  - id: gaia_dr3
    retrieved: 2026-08-15
    dataset: "..."

A clean checkout plus documented data acquisition steps should be sufficient to rebuild all derived datasets.

⸻

15. Extended Objects

Many relevant structures cannot be represented adequately by a single point.

Examples:

* molecular clouds;
* OB associations;
* Local Bubble;
* Radcliffe Wave.

MVP representation may use:

center + approximate radius

The architecture should support richer geometry later.

Supported geometry types:

point
sphere
ellipsoid
point_cloud
polyline
spline
volume

This is particularly important for:

* Orion;
* Taurus;
* Perseus;
* Local Bubble;
* Radcliffe Wave.

⸻

16. Gould Belt Model

Implement the Gould Belt as a separate scientific model layer.

Do not derive its geometry from a visual reference map.

The model should be configurable using parameters such as:

center XYZ
major radius
minor radius
inclination
orientation
thickness

Possible representations:

tilted ellipse
ellipsoid
annulus

Model configuration should live outside renderer code:

models/gould_belt.yaml

Example conceptual structure:

model: gould_belt
representation: annulus
center:
  x_pc: 0
  y_pc: 0
  z_pc: 0
major_radius_pc: ...
minor_radius_pc: ...
inclination_deg: ...
orientation_deg: ...
thickness_pc: ...
source:
  reference: "..."

Every model parameter set must reference the literature from which it was derived.

⸻

17. Radcliffe Wave Model

The Radcliffe Wave must not be represented as an arbitrary hand-drawn sinusoid.

Preferred sources, in order:

1. published XYZ positions of associated clouds;
2. published parametric model;
3. spline fitted to published observational positions.

Preferred representation:

3D spline

or:

3D polyline

Possible dataset:

models/radcliffe_wave.csv

Schema:

s_pc
x_pc
y_pc
z_pc

The visualization should distinguish between:

* observed cloud positions;
* interpolated/fitted Radcliffe Wave curve.

The model curve is a scientific interpretation and must not replace the actual objects.

⸻

18. Local Bubble

The Local Bubble should be implemented as another optional structure layer.

For MVP, a simplified volume is acceptable if backed by a source.

Possible representations:

sphere
ellipsoid
mesh
point cloud boundary

The architecture should allow replacement of a simplified MVP model by a more realistic 3D reconstruction later.

⸻

19. Scientific Data Classification

The system must explicitly distinguish:

measured data
derived data
scientific model
visual decoration

Example:

Orion distance

Measured data.

Orion XYZ coordinates

Derived data.

Gould Belt ellipse

Scientific model.

glowing nebula material around Orion

Visual decoration.

These categories must remain separate in the data model.

⸻

20. Uncertainties

Where available, preserve uncertainties.

Minimum:

distance_error_pc

Future versions may visualize uncertainty using:

error bars
radial uncertainty
transparent uncertainty volumes
Monte Carlo samples

Displaying uncertainties is not required for the MVP.

Preserving uncertainty metadata is required.

⸻

21. Scene Dataset

The Python pipeline should export a renderer-independent scene dataset.

Preferred format:

JSON

Example:

{
  "metadata": {
    "coordinate_system": "heliocentric_galactic_cartesian",
    "distance_unit": "pc"
  },
  "objects": [],
  "structures": {
    "gould_belt": {},
    "radcliffe_wave": {},
    "local_bubble": {}
  }
}

The web visualizer consumes this dataset.

Three.js-specific properties should not be mixed into the scientific source data.

⸻

22. Web Visualizer

The primary user-facing deliverable is a Three.js-based application.

Required capabilities:

* WebGL 3D rendering;
* orbit-style camera control;
* zoom;
* pan;
* object picking;
* labels;
* tooltips or info panels;
* layer toggles;
* camera presets;
* visualization radius control;
* responsive layout.

The application should work locally without requiring a backend once the scene dataset has been built.

⸻

23. Visualizer Layers

Implement independent layers for:

stars
clusters
associations
molecular_clouds
HII_regions
supernova_remnants
bubbles
Gould_Belt
Radcliffe_Wave
Galactic_Plane
labels
reference_geometry

Each layer should support at least:

show/hide
opacity
size

where relevant.

⸻

24. Object Interaction

Clicking or selecting an object should display its metadata.

Example:

Pleiades
Type:
Star Cluster
Distance:
136 pc
Galactic coordinates:
l = ...
b = ...
Cartesian:
X = ...
Y = ...
Z = ...
Source:
Gaia / literature reference

Exact UI design is not part of the MVP requirement, but inspection functionality is.

⸻

25. Labels

Labels should:

* remain legible while navigating;
* optionally hide at large distances;
* avoid excessive clutter;
* be toggleable.

Possible implementation:

CSS2DRenderer

or equivalent Three.js-compatible label approach.

⸻

26. Galactic Plane

Display the Galactic Plane as a visual reference layer.

Representation:

large semi-transparent plane

It should correspond to:

Z = 0

This layer is primarily geometric reference and must remain visually subtle.

⸻

27. Coordinate Axes

Optionally display:

X
Y
Z

with clear orientation.

Reference:

+X → Galactic Center
+Y → Galactic rotation
+Z → North Galactic Pole

Axes should be toggleable.

⸻

28. Radius Control

The visualizer should support filtering by heliocentric distance.

Initial presets:

100 pc
250 pc
500 pc
800 pc
1 kpc
2 kpc

The architecture must not hard-code 800 pc as a permanent limit.

⸻

29. Camera Presets

Provide useful presets such as:

Perspective
Top view
Galactic Plane / face-on
Edge-on
Sun-centered
Fit all

Of particular importance:

Face-on

View approximately along Galactic Z.

Useful for XY structure.

Edge-on

View approximately parallel to the Galactic Plane.

Useful for showing vertical displacement and the Radcliffe Wave.

⸻

30. Initial Visualization Style

The visualizer should prioritize spatial clarity over decorative effects.

Recommended MVP style:

* black/dark background;
* restrained star field;
* subtle Galactic Plane;
* distinct object-category markers;
* translucent clouds;
* unobtrusive labels;
* clear scientific model overlays.

Do not attempt photorealistic Milky Way rendering in the MVP.

⸻

31. Web Technology

Preferred stack:

TypeScript
Three.js
Vite

Optional lightweight UI framework:

React

or:

plain TypeScript + DOM

Do not introduce React unless it materially simplifies the UI.

The 3D renderer should remain independent from the UI framework.

⸻

32. Scientific Python Stack

Preferred:

Python >= 3.12
Astropy
NumPy
Pandas
PyArrow
Pydantic

Optional:

SciPy

for spline fitting and model interpolation.

⸻

33. Jupyter Notebook

A Jupyter notebook should remain part of the project as a scientific validation and exploration tool.

Create:

notebooks/local_neighborhood.ipynb

It is not the primary deliverable.

Its purpose is to:

* inspect source data;
* verify coordinate transforms;
* inspect XYZ distribution;
* compare model geometry;
* validate the scene before rendering;
* produce quick diagnostic plots.

It may initially use:

Plotly

for exploratory 3D visualization.

⸻

34. Python API

The scientific pipeline should expose reusable library functions.

Conceptual API:

catalog = load_catalog(...)
catalog = normalize_catalog(catalog)
catalog = derive_galactic_coordinates(catalog)
scene = build_scene(catalog, models)
export_scene(scene, "scene.json")

CLI, notebooks, and tests should call the same underlying library code.

⸻

35. CLI

Provide a minimal CLI.

Example:

galactic-structures acquire
galactic-structures build-catalog
galactic-structures build-coordinates
galactic-structures build-models
galactic-structures export-scene

Possible combined command:

galactic-structures build

Example:

galactic-structures export-scene \
    --radius 800 \
    --output web/public/data/scene.json

⸻

36. Suggested Repository Structure

local-galactic-structures/
│
├── README.md
├── pyproject.toml
├── package.json
│
├── data/
│   ├── raw/
│   ├── normalized/
│   └── derived/
│
├── models/
│   ├── gould_belt.yaml
│   ├── radcliffe_wave.csv
│   └── local_bubble.yaml
│
├── notebooks/
│   └── local_neighborhood.ipynb
│
├── src/
│   └── local_galactic_structures/
│       ├── catalog.py
│       ├── coordinates.py
│       ├── models.py
│       ├── scene.py
│       ├── export.py
│       └── data_sources/
│           ├── simbad.py
│           ├── gaia.py
│           ├── vizier.py
│           └── literature.py
│
├── scripts/
│   └── build_scene.py
│
├── web/
│   ├── index.html
│   ├── package.json
│   ├── public/
│   │   └── data/
│   │       └── scene.json
│   └── src/
│       ├── main.ts
│       ├── scene/
│       │   ├── createScene.ts
│       │   ├── camera.ts
│       │   ├── objects.ts
│       │   ├── labels.ts
│       │   └── layers.ts
│       └── ui/
│           ├── controls.ts
│           └── inspector.ts
│
└── tests/
    ├── test_coordinates.py
    ├── test_catalog.py
    ├── test_models.py
    └── test_scene.py

⸻

37. Testing

Coordinate Transformations

Verify reference objects against Astropy.

Distance Preservation

After transformation:

import numpy as np
distance = np.sqrt(x**2 + y**2 + z**2)

must reproduce the original distance within floating-point tolerance.

Sun Origin

Sun = (0, 0, 0)

Galactic Plane

For:

b = 0

the derived value should satisfy:

z ≈ 0

Provenance

Normalized records must retain links to source records.

Scene Serialization

Scene export/import must preserve object coordinates and structure definitions.

⸻

38. Web Testing

At minimum verify:

* scene loads successfully;
* camera controls work;
* layers toggle correctly;
* object selection works;
* labels can be enabled/disabled;
* radius filter works;
* camera presets work;
* missing optional layers do not break the application.

Automated browser tests are desirable but not mandatory for the first iteration.

⸻

39. Export

The web visualizer should support at minimum:

PNG screenshot

The scientific pipeline should support:

JSON
CSV
Parquet

Future formats:

SVG
GLTF
GLB
Blender-compatible scene data

Standalone HTML export is desirable if practical.

⸻

40. Animation-Ready Architecture

Animation is not part of the MVP, but the scene architecture must make it possible later.

Important independently controllable properties:

camera_position
camera_target
layer_visibility
object_visibility
object_opacity
structure_opacity
label_visibility

This should support future sequences such as:

show local objects
    ↓
fade in Gould Belt
    ↓
rotate camera
    ↓
move toward edge-on Galactic view
    ↓
fade out Gould Belt
    ↓
fade in Radcliffe Wave

The scientific data itself must remain static during this transition.

Only visualization state changes.

⸻

41. Future Cinematic Rendering

After the scientific geometry is validated, the same scene dataset may be used to generate higher-quality media.

Preferred future architecture:

Python
    scientific pipeline
Three.js
    interactive exploration
Blender
    cinematic rendering

Possible export path:

scene.json
    ↓
GLTF / custom Blender importer
    ↓
Blender
    ↓
cinematic animation

This is explicitly outside the MVP.

⸻

42. MVP Scope

The MVP is complete when all of the following are true:

* at least 20 real local astronomical objects are included;
* every object has traceable scientific provenance;
* real coordinates and distances are stored;
* RA/Dec/distance can be converted into Galactic XYZ;
* a renderer-ready scene JSON is generated;
* the web application loads that scene;
* the Sun is shown at the origin;
* the Galactic Plane is shown;
* object categories can be toggled;
* labels can be displayed;
* objects can be inspected;
* the Gould Belt model can be enabled;
* the Radcliffe Wave model can be enabled;
* the Local Bubble can be enabled if initial data are available;
* the camera can rotate, pan, and zoom;
* face-on and edge-on views are available;
* visualization radius can be changed;
* the scene can be exported at least as a PNG screenshot;
* the project can be rebuilt from documented source data.

⸻

43. Out of Scope for MVP

Do not implement yet:

* full visual scene editor;
* Unreal Engine;
* Unity;
* stellar dynamics;
* gas dynamics;
* physical simulation of molecular clouds;
* custom astronomical database server;
* production-grade backend;
* automatic 3D reconstruction of arbitrary nebulae;
* photorealistic Milky Way rendering;
* generative AI graphics;
* cinematic video rendering;
* advanced uncertainty visualization;
* multiplayer or collaborative functionality;
* complex account/authentication system.

⸻

44. Performance Expectations

The MVP should handle at least several thousand rendered points without usability problems on a normal desktop browser.

The architecture should allow later scaling using:

InstancedMesh
BufferGeometry
GPU-friendly point rendering
LOD

Do not prematurely optimize for millions of stars.

The initial product is a structural scientific visualization, not a Gaia catalog browser.

⸻

45. Renderer Independence

The exported scientific scene must not depend on Three.js.

Bad:

{
  "threeMaterial": "MeshBasicMaterial"
}

Good:

{
  "object_type": "molecular_cloud",
  "position_pc": [120.4, -35.2, -18.7],
  "size_pc": 25.0
}

Renderer-specific styling belongs in the web layer.

⸻

46. Configuration

Avoid hard-coded scene parameters.

Provide configuration for:

default radius
camera defaults
enabled layers
label thresholds
visual scale factors
object size mappings

Example:

config/visualization.yaml

or web-side configuration in typed JSON/TypeScript.

Scientific model parameters must remain separate from purely visual parameters.

⸻

47. Documentation

README should explain:

* project purpose;
* scientific coordinate system;
* data sources;
* how data are acquired;
* how derived data are rebuilt;
* how to run tests;
* how to run the notebook;
* how to build the scene;
* how to launch the web visualizer.

Expected quick-start flow:

uv sync
galactic-structures build
cd web
npm install
npm run dev

Exact tooling may differ, but the workflow must remain simple.

⸻

48. Development Strategy

Recommended implementation phases:

Phase 1 — Data Model

Implement:

* schemas;
* sample catalog;
* coordinate transforms;
* tests.

Phase 2 — Scientific Dataset

Collect real data for the initial object set.

Generate validated Galactic XYZ data.

Phase 3 — Model Layers

Implement:

* Gould Belt;
* Radcliffe Wave;
* Local Bubble if feasible.

Phase 4 — Scene Export

Generate renderer-independent:

scene.json

Phase 5 — Web MVP

Implement basic Three.js viewer.

Phase 6 — Interaction

Add:

* layer controls;
* labels;
* inspector;
* radius filtering;
* camera presets.

Phase 7 — Visual Refinement

Only after geometry and data are validated.

⸻

49. Acceptance Criterion

The project must allow a user to answer visually:

Where are the major nearby stellar and interstellar structures actually located relative to the Sun and relative to one another in three-dimensional Galactic space?

It must then allow the user to compare different large-scale interpretations of those same observations, initially:

Gould Belt
vs.
Radcliffe Wave

without moving astronomical objects by hand.

The positions of real objects must come from data.

The Gould Belt and Radcliffe Wave must appear as separate scientific model layers over the same physical Solar-neighborhood dataset.

⸻

50. Final Product Vision

The long-term product is a reusable local-Galaxy visualization engine.

The first release is deliberately narrower:

real astronomical data
        ↓
validated local 3D model
        ↓
interactive web visualizer

The web viewer is the primary deliverable.

The Python pipeline is the scientific foundation.

The Jupyter notebook is the validation and research tool.

Future animation, Blender rendering, and publication graphics should reuse the same normalized scene rather than rebuilding geometry independently.