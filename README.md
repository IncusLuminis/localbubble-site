# Local Galactic Structures

Scientifically grounded 3D model and data pipeline for the Solar neighborhood
(Gould Belt, Radcliffe Wave, Local Bubble, and nearby stellar/interstellar
structures). Full project spec: [`spec/Idea.md`](spec/Idea.md).

## Status

Phase 1 (Data Model) only: object schema, catalog storage, and RA/Dec/distance
-> Galactic XYZ coordinate transforms. Data acquisition, the full initial
catalog, scientific model layers (Gould Belt / Radcliffe Wave / Local Bubble),
scene export, and the web visualizer are separate, not-yet-implemented
Stories — see the `local-galactic-structures` GitHub Project board.

## Setup

```bash
cd local-galactic-structures
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Rebuild the sample catalog

```bash
python scripts/build_sample_catalog.py
```

Writes `data/normalized/catalog.parquet` and `data/normalized/catalog.csv` -
a small, hand-picked set of well-documented objects (Sun, Pleiades, Hyades,
Orion Nebula Cluster) used to validate the schema/transform pipeline. This is
not the full >=20-object initial catalog (spec §9), which is a separate
acquisition Story.

## Tests

```bash
pytest
```

## Layout

- `src/local_galactic_structures/schema.py` — normalized `AstronomicalObject`
  Pydantic schema (spec §7).
- `src/local_galactic_structures/coordinates.py` — RA/Dec/distance -> Galactic
  l/b and heliocentric Galactic Cartesian XYZ, via `astropy.coordinates` only
  (spec §6).
- `src/local_galactic_structures/catalog.py` — flatten/unflatten
  `AstronomicalObject` records to/from `data/normalized/catalog.parquet`
  (+ CSV for inspection).
- `data/{raw,normalized,derived}/` — strict raw -> normalized -> derived data
  separation (spec §13). `raw/` is never modified in place.
