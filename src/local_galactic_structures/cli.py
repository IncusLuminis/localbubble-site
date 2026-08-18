"""`galactic-structures` CLI (spec Idea.md §34-35, Story #63).

A thin argparse wrapper over the library functions in this package - every
subcommand below calls the same underlying code the tests, notebook, and
`scripts/build_initial_catalog.py` call (spec §34: "CLI, notebooks, and
tests should call the same underlying library code"). No pipeline logic is
duplicated here.

Subcommands (spec §35):

    galactic-structures acquire <name> --source {simbad,gaia,vizier}
    galactic-structures build-catalog
    galactic-structures build-coordinates
    galactic-structures build-models
    galactic-structures export-scene --radius 800 --output data/derived/scene.json
    galactic-structures build   # combined build-catalog + build-coordinates
                                 # + build-models + export-scene

Install with `pip install -e .` (see `pyproject.toml`'s `[project.scripts]`)
to get the `galactic-structures` console script; `python -m
local_galactic_structures.cli ...` works identically without installing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from .catalog import load_catalog, save_catalog
from .coordinates import CoordinateDerivationError, derive_galactic_coordinates_batch
from .data_sources.gaia import GaiaResolver
from .data_sources.simbad import SimbadResolver
from .data_sources.vizier import VizierResolver
from .gould_belt import load_gould_belt_model
from .initial_catalog import (
    DEFAULT_PARQUET_PATH,
    DEFAULT_RECORDS_PATH,
    build_initial_catalog,
)
from .local_bubble import load_local_bubble_model
from .radcliffe_wave import load_radcliffe_wave
from .scene import build_scene, export_scene

#: Repository root, computed from this file's location
#: (src/local_galactic_structures/cli.py -> repo root).
REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_GOULD_BELT_PATH = REPO_ROOT / "models" / "gould_belt.yaml"
DEFAULT_RADCLIFFE_WAVE_PATH = REPO_ROOT / "models" / "radcliffe_wave.csv"
DEFAULT_LOCAL_BUBBLE_PATH = REPO_ROOT / "models" / "local_bubble.yaml"
#: data/derived/ is exactly where computed, renderer-ready structures
#: belong (spec §13); the web/ directory that spec §35's own example
#: writes to doesn't exist yet (a later Story).
DEFAULT_SCENE_PATH = REPO_ROOT / "data" / "derived" / "scene.json"

#: Radius default for `export-scene`/`build` (spec §35's own example uses
#: 800 pc). This is only a CLI convenience default - `scene.build_scene`
#: itself defaults to no filtering at all (spec §28: the architecture must
#: not hard-code 800 pc as a permanent limit).
DEFAULT_RADIUS_PC = 800.0

_RESOLVERS = {"simbad": SimbadResolver, "gaia": GaiaResolver}


# --------------------------------------------------------------------------
# Subcommand implementations
# --------------------------------------------------------------------------


def _cmd_acquire(args: argparse.Namespace) -> int:
    """Resolve one named object from a live data source and cache it
    (spec §12) - a thin wrapper over the `data_sources/` adapters built in
    Story #58, not a replacement for them."""
    if args.source == "vizier":
        if not args.vizier_catalog:
            print(
                "error: --vizier-catalog is required when --source vizier",
                file=sys.stderr,
            )
            return 2
        resolver = VizierResolver(
            args.vizier_catalog,
            object_type=args.object_type,
            cache_dir=args.cache_dir,
            manifest_path=args.manifest_path,
        )
    else:
        resolver_cls = _RESOLVERS[args.source]
        resolver = resolver_cls(
            object_type=args.object_type,
            cache_dir=args.cache_dir,
            manifest_path=args.manifest_path,
        )

    obj = resolver.resolve(args.name, force_refresh=args.force_refresh)
    payload = obj.model_dump_json(indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload + "\n")
        print(f"Resolved {args.name!r} via {args.source} -> {output_path}")
    else:
        print(payload)
    return 0


def _default_csv_output(primary_output: str | Path) -> Path:
    """Derive a `--csv-output` default from whatever primary (parquet)
    output path is actually in play for this invocation - sibling path,
    `.csv` extension - rather than a value hard-coded to the real repo's
    `data/normalized/catalog.csv`.

    This is what makes overriding `--output`/`--catalog` to a scratch path
    safe: without it, an invocation like `build-coordinates --catalog
    /tmp/scratch.parquet` would still silently overwrite the real,
    checked-in CSV with `--csv-output`'s old hard-coded default, even
    though the parquet output itself correctly went to the scratch path.
    """
    return Path(primary_output).with_suffix(".csv")


def _cmd_build_catalog(args: argparse.Namespace) -> int:
    """Rebuild the checked-in initial catalog (spec §9) - calls the exact
    same `initial_catalog.build_initial_catalog` that
    `scripts/build_initial_catalog.py` calls."""
    csv_output = args.csv_output
    if csv_output is None:
        csv_output = _default_csv_output(args.output)
    try:
        objects = build_initial_catalog(
            records_path=args.records,
            parquet_path=args.output,
            csv_path=csv_output,
        )
    except CoordinateDerivationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"Wrote {len(objects)} objects to {args.output} and {csv_output}")
    return 0


def _cmd_build_coordinates(args: argparse.Namespace) -> int:
    """Re-derive Galactic l/b and heliocentric Cartesian XYZ (spec §6) for
    every object already in the catalog, and re-save it. Idempotent:
    re-running against already-correct coordinates changes nothing."""
    objects = load_catalog(args.catalog)
    try:
        objects = derive_galactic_coordinates_batch(objects)
    except CoordinateDerivationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    output = args.output or args.catalog
    csv_output = args.csv_output
    if csv_output is None:
        csv_output = _default_csv_output(output)
    save_catalog(objects, output, csv_output)
    print(f"Re-derived coordinates for {len(objects)} objects -> {output}")
    return 0


def _cmd_build_models(args: argparse.Namespace) -> int:
    """Load and validate the three scientific model-layer configs
    (spec §16-18). Reports per-layer success/failure; does not write any
    derived artifact of its own - `export-scene` loads these same configs
    directly when composing the scene."""
    ok = True

    try:
        gb = load_gould_belt_model(args.gould_belt)
        print(
            f"gould_belt: OK ({gb.representation}, "
            f"source: {gb.source.reference})"
        )
    except Exception as exc:  # noqa: BLE001 - report any load/validation failure
        print(f"gould_belt: FAILED to load {args.gould_belt}: {exc}", file=sys.stderr)
        ok = False

    try:
        rw = load_radcliffe_wave(args.radcliffe_wave)
        print(f"radcliffe_wave: OK ({len(rw.points)} points, enabled={rw.enabled})")
    except Exception as exc:  # noqa: BLE001
        print(
            f"radcliffe_wave: FAILED to load {args.radcliffe_wave}: {exc}",
            file=sys.stderr,
        )
        ok = False

    try:
        lb = load_local_bubble_model(args.local_bubble)
        print(f"local_bubble: OK ({lb.representation}, enabled={lb.enabled})")
    except Exception as exc:  # noqa: BLE001
        print(
            f"local_bubble: FAILED to load {args.local_bubble}: {exc}",
            file=sys.stderr,
        )
        ok = False

    return 0 if ok else 1


class ModelLoadError(RuntimeError):
    """A model-layer config file exists but failed to load/validate (spec
    §16-18) - e.g. malformed YAML/CSV or a value outside its sanity range.
    Raised by `_load_models_for_scene` so callers can report a clean,
    single-line error (like `_cmd_build_models` already does for its own
    per-layer failures) instead of letting a raw traceback (e.g. a
    `pydantic.ValidationError`) reach the user.
    """


def _load_models_for_scene(
    gould_belt_path: str | Path,
    radcliffe_wave_path: str | Path,
    local_bubble_path: str | Path,
) -> dict:
    """Load whichever of the three model-layer configs are present.

    A *missing* config file is skipped (with a warning) rather than
    failing the whole scene export - a scene with fewer structure layers
    is still a valid, useful scene, and "not built yet" is a normal
    pipeline state. A config file that exists but fails to load/validate
    is a different situation - a real data-integrity problem - and raises
    `ModelLoadError` instead of being silently skipped or letting the
    underlying exception's raw traceback reach the user.
    """
    models: dict[str, object | None] = {}
    for key, path, loader in (
        ("gould_belt", gould_belt_path, load_gould_belt_model),
        ("radcliffe_wave", radcliffe_wave_path, load_radcliffe_wave),
        ("local_bubble", local_bubble_path, load_local_bubble_model),
    ):
        try:
            models[key] = loader(path)
        except FileNotFoundError:
            print(
                f"warning: {key} model config not found at {path}, "
                "omitting from scene",
                file=sys.stderr,
            )
            models[key] = None
        except Exception as exc:  # noqa: BLE001 - re-raised as a clean CLI error
            raise ModelLoadError(
                f"{key} model config at {path} failed to load: {exc}"
            ) from exc
    return models


def _resolve_radius(args: argparse.Namespace) -> float | None:
    return None if args.no_radius_filter else args.radius_pc


def _run_export_scene(
    *,
    catalog_path: str | Path,
    gould_belt_path: str | Path,
    radcliffe_wave_path: str | Path,
    local_bubble_path: str | Path,
    radius_pc: float | None,
    output: str | Path,
) -> dict:
    objects = load_catalog(catalog_path)
    models = _load_models_for_scene(
        gould_belt_path, radcliffe_wave_path, local_bubble_path
    )
    scene = build_scene(objects, models, radius_pc=radius_pc)
    output_path = export_scene(scene, output)
    included = len(scene["objects"])
    total = len(objects)
    structure_count = sum(1 for v in scene["structures"].values() if v)
    radius_desc = f"radius={radius_pc} pc" if radius_pc is not None else "no radius filter"
    print(
        f"Wrote scene with {included} of {total} objects and "
        f"{structure_count} structure(s) to {output_path} ({radius_desc})"
    )
    return scene


def _cmd_export_scene(args: argparse.Namespace) -> int:
    """Compose the catalog + model layers into a renderer-independent
    scene.json (spec §21)."""
    try:
        _run_export_scene(
            catalog_path=args.catalog,
            gould_belt_path=args.gould_belt,
            radcliffe_wave_path=args.radcliffe_wave,
            local_bubble_path=args.local_bubble,
            radius_pc=_resolve_radius(args),
            output=args.output,
        )
    except ModelLoadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def _cmd_build(args: argparse.Namespace) -> int:
    """Run the full pipeline end to end with default paths: build-catalog,
    build-coordinates, build-models, export-scene (spec §35's suggested
    combined command).

    Each stage below calls the exact same `_cmd_*` function a standalone
    `galactic-structures <stage>` invocation would call - nothing is
    reimplemented here, so a future fix to any one stage's argument
    defaults or error handling (e.g. the `--csv-output` default) cannot
    silently diverge between the standalone subcommand and this combined
    one. Each stage's own default paths are reused via the same
    module-level `DEFAULT_*` constants its own subparser uses, and a
    stage's non-zero exit code aborts the pipeline before running the
    next one.
    """
    catalog_status = _cmd_build_catalog(
        argparse.Namespace(
            records=str(DEFAULT_RECORDS_PATH),
            output=str(DEFAULT_PARQUET_PATH),
            csv_output=None,
        )
    )
    if catalog_status != 0:
        return catalog_status
    print("build-catalog: done")

    coordinates_status = _cmd_build_coordinates(
        argparse.Namespace(
            catalog=str(DEFAULT_PARQUET_PATH), output=None, csv_output=None
        )
    )
    if coordinates_status != 0:
        return coordinates_status
    print("build-coordinates: done")

    models_status = _cmd_build_models(
        argparse.Namespace(
            gould_belt=str(DEFAULT_GOULD_BELT_PATH),
            radcliffe_wave=str(DEFAULT_RADCLIFFE_WAVE_PATH),
            local_bubble=str(DEFAULT_LOCAL_BUBBLE_PATH),
        )
    )
    if models_status != 0:
        return models_status
    print("build-models: done")

    return _cmd_export_scene(
        argparse.Namespace(
            catalog=str(DEFAULT_PARQUET_PATH),
            gould_belt=str(DEFAULT_GOULD_BELT_PATH),
            radcliffe_wave=str(DEFAULT_RADCLIFFE_WAVE_PATH),
            local_bubble=str(DEFAULT_LOCAL_BUBBLE_PATH),
            radius_pc=args.radius_pc,
            no_radius_filter=args.no_radius_filter,
            output=args.output,
        )
    )


# --------------------------------------------------------------------------
# Argument parser
# --------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="galactic-structures",
        description=(
            "Local Galactic Structures scientific data pipeline "
            "(spec Idea.md §34-35)."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_acquire = subparsers.add_parser(
        "acquire",
        help="Resolve one named object from a live data source and cache it.",
    )
    p_acquire.add_argument("name", help="Object name/identifier to resolve.")
    p_acquire.add_argument(
        "--source", choices=("simbad", "gaia", "vizier"), default="simbad"
    )
    p_acquire.add_argument(
        "--object-type",
        default="star",
        help="AstronomicalObject.object_type to tag the resolved object with (spec §8).",
    )
    p_acquire.add_argument(
        "--vizier-catalog",
        default=None,
        help="VizieR catalog id (required when --source vizier).",
    )
    p_acquire.add_argument("--cache-dir", default=None)
    p_acquire.add_argument("--manifest-path", default=None)
    p_acquire.add_argument(
        "--force-refresh",
        action="store_true",
        help="Re-query upstream even if a cached response already exists.",
    )
    p_acquire.add_argument(
        "--output",
        default=None,
        help="Write the resolved object as JSON to this path instead of stdout.",
    )
    p_acquire.set_defaults(func=_cmd_acquire)

    p_build_catalog = subparsers.add_parser(
        "build-catalog", help="Rebuild the checked-in initial catalog (spec §9)."
    )
    p_build_catalog.add_argument("--records", default=str(DEFAULT_RECORDS_PATH))
    p_build_catalog.add_argument("--output", default=str(DEFAULT_PARQUET_PATH))
    p_build_catalog.add_argument(
        "--csv-output",
        default=None,
        help="Defaults to the resolved --output path with a .csv extension.",
    )
    p_build_catalog.set_defaults(func=_cmd_build_catalog)

    p_build_coordinates = subparsers.add_parser(
        "build-coordinates",
        help="Re-derive Galactic l/b and heliocentric XYZ for every catalog object (spec §6).",
    )
    p_build_coordinates.add_argument("--catalog", default=str(DEFAULT_PARQUET_PATH))
    p_build_coordinates.add_argument(
        "--output",
        default=None,
        help="Defaults to overwriting --catalog in place.",
    )
    p_build_coordinates.add_argument(
        "--csv-output",
        default=None,
        help="Defaults to the resolved --output/--catalog path with a .csv extension.",
    )
    p_build_coordinates.set_defaults(func=_cmd_build_coordinates)

    p_build_models = subparsers.add_parser(
        "build-models",
        help="Validate the scientific model-layer configs (spec §16-18).",
    )
    p_build_models.add_argument("--gould-belt", default=str(DEFAULT_GOULD_BELT_PATH))
    p_build_models.add_argument(
        "--radcliffe-wave", default=str(DEFAULT_RADCLIFFE_WAVE_PATH)
    )
    p_build_models.add_argument("--local-bubble", default=str(DEFAULT_LOCAL_BUBBLE_PATH))
    p_build_models.set_defaults(func=_cmd_build_models)

    p_export = subparsers.add_parser(
        "export-scene",
        help="Compose the catalog + model layers into a renderer-independent scene.json (spec §21).",
    )
    p_export.add_argument("--catalog", default=str(DEFAULT_PARQUET_PATH))
    p_export.add_argument("--gould-belt", default=str(DEFAULT_GOULD_BELT_PATH))
    p_export.add_argument("--radcliffe-wave", default=str(DEFAULT_RADCLIFFE_WAVE_PATH))
    p_export.add_argument("--local-bubble", default=str(DEFAULT_LOCAL_BUBBLE_PATH))
    p_export.add_argument(
        "--radius",
        type=float,
        default=DEFAULT_RADIUS_PC,
        dest="radius_pc",
        help=f"Heliocentric radius in pc to filter objects to (spec §28; default {DEFAULT_RADIUS_PC:g}).",
    )
    p_export.add_argument(
        "--no-radius-filter",
        action="store_true",
        help="Disable radius filtering entirely (include every object), ignoring --radius.",
    )
    p_export.add_argument("--output", default=str(DEFAULT_SCENE_PATH))
    p_export.set_defaults(func=_cmd_export_scene)

    p_build = subparsers.add_parser(
        "build",
        help="Run build-catalog, build-coordinates, build-models, and export-scene in sequence.",
    )
    p_build.add_argument(
        "--radius", type=float, default=DEFAULT_RADIUS_PC, dest="radius_pc"
    )
    p_build.add_argument("--no-radius-filter", action="store_true")
    p_build.add_argument("--output", default=str(DEFAULT_SCENE_PATH))
    p_build.set_defaults(func=_cmd_build)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
