"""Tests for renderer-independent scene export (spec Idea.md §21, §37, §45,
Story #63): `scene.build_scene`/`scene.export_scene`/`scene.load_scene`, and
the `galactic-structures` CLI's `export-scene` subcommand.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from local_galactic_structures.catalog import load_catalog, save_catalog
from local_galactic_structures.cli import ModelLoadError, build_arg_parser, main as cli_main
from local_galactic_structures.initial_catalog import DEFAULT_CSV_PATH, DEFAULT_PARQUET_PATH
from local_galactic_structures.gould_belt import (
    GouldBeltCenter,
    GouldBeltModel,
    GouldBeltSource,
)
from local_galactic_structures.local_bubble import LocalBubbleModel, LocalBubbleSource
from local_galactic_structures.local_bubble import SemiAxes as LocalBubbleSemiAxes
from local_galactic_structures.radcliffe_wave import (
    RadcliffeWaveModel,
    RadcliffeWavePoint,
    RadcliffeWaveSource,
)
from local_galactic_structures.scene import STRUCTURE_KEYS, build_scene, export_scene, load_scene
from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Group,
    Source,
    Visual,
)


def _make_object(
    id: str,
    name: str,
    *,
    x_pc: float,
    y_pc: float,
    z_pc: float,
    object_type: str = "star",
    aliases: list[str] | None = None,
    size_pc: float | None = None,
    group_primary: str | None = None,
    notes: str | None = None,
) -> AstronomicalObject:
    distance_pc = math.sqrt(x_pc**2 + y_pc**2 + z_pc**2)
    return AstronomicalObject(
        id=id,
        name=name,
        aliases=aliases or [],
        object_type=object_type,
        coordinates=Coordinates(
            ra_deg=10.0, dec_deg=20.0, galactic_l_deg=30.0, galactic_b_deg=5.0
        ),
        distance=Distance(value_pc=distance_pc, error_pc=1.5),
        cartesian=Cartesian(x_pc=x_pc, y_pc=y_pc, z_pc=z_pc),
        group=Group(primary=group_primary, secondary=[]),
        source=Source(reference="Unit test fixture, definitely > 10 chars"),
        visual=Visual(size_pc=size_pc, color_class=None),
        notes=notes,
    )


@pytest.fixture
def sample_objects() -> list[AstronomicalObject]:
    return [
        _make_object("sun", "Sun", x_pc=0.0, y_pc=0.0, z_pc=0.0, object_type="reference_point"),
        _make_object("near-one", "Near One", x_pc=50.0, y_pc=0.0, z_pc=0.0, size_pc=5.0),
        _make_object("near-two", "Near Two", x_pc=0.0, y_pc=100.0, z_pc=50.0, size_pc=10.0),
        _make_object("far-one", "Far One", x_pc=900.0, y_pc=0.0, z_pc=0.0, size_pc=25.0),
    ]


@pytest.fixture
def sample_gould_belt() -> GouldBeltModel:
    return GouldBeltModel(
        representation="annulus",
        center=GouldBeltCenter(x_pc=-104.0, y_pc=-0.73, z_pc=0.0),
        major_radius_pc=373.0,
        minor_radius_pc=233.0,
        inclination_deg=17.2,
        orientation_deg=296.1,
        thickness_pc=60.0,
        source=GouldBeltSource(reference="Perrot & Grenier (2003), A&A 404, 519"),
    )


@pytest.fixture
def sample_radcliffe_wave() -> RadcliffeWaveModel:
    return RadcliffeWaveModel(
        points=[
            RadcliffeWavePoint(s_pc=0.0, x_pc=-200.0, y_pc=0.0, z_pc=-50.0),
            RadcliffeWavePoint(s_pc=100.0, x_pc=-100.0, y_pc=50.0, z_pc=0.0),
            RadcliffeWavePoint(s_pc=200.0, x_pc=0.0, y_pc=100.0, z_pc=50.0),
        ],
        source=RadcliffeWaveSource(reference="Konietzka et al. (2024), Nature, 626, 63"),
    )


@pytest.fixture
def sample_local_bubble() -> LocalBubbleModel:
    return LocalBubbleModel(
        representation="ellipsoid",
        center_pc=Cartesian(x_pc=10.0, y_pc=30.0, z_pc=0.0),
        semi_axes_pc=LocalBubbleSemiAxes(a_pc=60.0, b_pc=60.0, c_pc=162.0),
        source=LocalBubbleSource(reference="Pelgrims et al. (2020) unit test fixture"),
    )


@pytest.fixture
def sample_models(sample_gould_belt, sample_radcliffe_wave, sample_local_bubble) -> dict:
    return {
        "gould_belt": sample_gould_belt,
        "radcliffe_wave": sample_radcliffe_wave,
        "local_bubble": sample_local_bubble,
    }


# --------------------------------------------------------------------------
# build_scene shape (spec §21)
# --------------------------------------------------------------------------


def test_build_scene_top_level_shape(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models)
    assert set(scene.keys()) == {"metadata", "objects", "structures"}
    assert scene["metadata"] == {
        "coordinate_system": "heliocentric_galactic_cartesian",
        "distance_unit": "pc",
    }
    assert isinstance(scene["objects"], list)
    assert isinstance(scene["structures"], dict)


def test_build_scene_structures_always_has_all_three_keys(sample_objects):
    scene = build_scene(sample_objects, models=None)
    assert set(scene["structures"].keys()) == set(STRUCTURE_KEYS)
    assert set(STRUCTURE_KEYS) == {"gould_belt", "radcliffe_wave", "local_bubble"}


def test_build_scene_includes_one_entry_per_object(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models)
    assert len(scene["objects"]) == len(sample_objects)
    ids = {entry["id"] for entry in scene["objects"]}
    assert ids == {obj.id for obj in sample_objects}


def test_scene_object_entry_has_expected_fields(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models)
    entry = next(e for e in scene["objects"] if e["id"] == "near-two")
    assert entry["name"] == "Near Two"
    assert entry["object_type"] == "star"
    assert entry["position_pc"] == [0.0, 100.0, 50.0]
    assert entry["size_pc"] == 10.0
    assert entry["distance_pc"] == pytest.approx(math.sqrt(100.0**2 + 50.0**2))
    assert entry["source"]["reference"].startswith("Unit test fixture")


def test_scene_works_with_no_objects_and_no_models():
    scene = build_scene([], models=None)
    assert scene["objects"] == []
    assert scene["structures"] == {key: {} for key in STRUCTURE_KEYS}


# --------------------------------------------------------------------------
# Radius filtering (spec §28)
# --------------------------------------------------------------------------


def test_radius_filter_excludes_distant_objects(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models, radius_pc=800.0)
    ids = {entry["id"] for entry in scene["objects"]}
    assert "far-one" in {obj.id for obj in sample_objects}  # sanity: fixture has a far object
    assert "far-one" not in ids
    assert ids == {"sun", "near-one", "near-two"}


def test_radius_filter_none_includes_everything(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models, radius_pc=None)
    assert len(scene["objects"]) == len(sample_objects)


def test_radius_filter_is_inclusive_at_the_boundary():
    objects = [_make_object("edge", "Edge", x_pc=100.0, y_pc=0.0, z_pc=0.0)]
    scene = build_scene(objects, models=None, radius_pc=100.0)
    assert len(scene["objects"]) == 1


def test_radius_filter_does_not_filter_structures(sample_objects, sample_models):
    # Model/structure layers represent whole physical structures, not
    # point objects, so radius filtering must never remove them (spec §28
    # / this Story's acceptance criteria).
    scene_unfiltered = build_scene(sample_objects, sample_models, radius_pc=None)
    scene_filtered = build_scene(sample_objects, sample_models, radius_pc=1.0)
    assert len(scene_filtered["objects"]) == 1  # only the Sun, at distance 0
    assert scene_filtered["structures"] == scene_unfiltered["structures"]
    assert scene_filtered["structures"]["gould_belt"] != {}


# --------------------------------------------------------------------------
# Structure enabled/disabled semantics
# --------------------------------------------------------------------------


def test_disabled_radcliffe_wave_is_excluded(sample_objects, sample_models):
    sample_models["radcliffe_wave"] = sample_models["radcliffe_wave"].model_copy(
        update={"enabled": False}
    )
    scene = build_scene(sample_objects, sample_models)
    assert scene["structures"]["radcliffe_wave"] == {}
    # Other layers remain unaffected.
    assert scene["structures"]["gould_belt"] != {}
    assert scene["structures"]["local_bubble"] != {}


def test_disabled_local_bubble_is_excluded(sample_objects, sample_models):
    sample_models["local_bubble"] = sample_models["local_bubble"].model_copy(
        update={"enabled": False}
    )
    scene = build_scene(sample_objects, sample_models)
    assert scene["structures"]["local_bubble"] == {}


def test_missing_model_layer_is_empty_but_key_present(sample_objects, sample_gould_belt):
    scene = build_scene(sample_objects, {"gould_belt": sample_gould_belt})
    assert scene["structures"]["gould_belt"] != {}
    assert scene["structures"]["radcliffe_wave"] == {}
    assert scene["structures"]["local_bubble"] == {}


def test_gould_belt_has_no_enabled_field_and_is_always_included_when_present(
    sample_objects, sample_gould_belt
):
    # GouldBeltModel currently has no `enabled` field (known, pre-existing
    # inconsistency vs the other two model layers) - it must still be
    # included whenever supplied.
    assert not hasattr(sample_gould_belt, "enabled")
    scene = build_scene(sample_objects, {"gould_belt": sample_gould_belt})
    assert scene["structures"]["gould_belt"]["representation"] == "annulus"


def test_radcliffe_wave_points_are_exported_close_to_as_is(sample_objects, sample_radcliffe_wave):
    scene = build_scene(sample_objects, {"radcliffe_wave": sample_radcliffe_wave})
    points = scene["structures"]["radcliffe_wave"]["points"]
    assert len(points) == 3
    assert points[0] == {"s_pc": 0.0, "x_pc": -200.0, "y_pc": 0.0, "z_pc": -50.0}


# --------------------------------------------------------------------------
# Renderer independence (spec §45)
# --------------------------------------------------------------------------

_RENDERER_KEY_DENYLIST = {"material", "materials", "geometry", "mesh", "three", "threematerial"}


def _collect_keys(value, keys: set[str]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            keys.add(k.lower())
            _collect_keys(v, keys)
    elif isinstance(value, list):
        for item in value:
            _collect_keys(item, keys)


def test_scene_has_no_three_js_specific_keys(sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models)
    all_keys: set[str] = set()
    _collect_keys(scene, all_keys)
    offending = all_keys & _RENDERER_KEY_DENYLIST
    assert not offending, f"Renderer-specific keys leaked into the scene: {offending}"


def test_scene_object_entries_match_spec_good_example_pattern(sample_objects, sample_models):
    # spec §45's "good" example: object_type / position_pc / size_pc, no
    # renderer-specific properties.
    scene = build_scene(sample_objects, sample_models)
    entry = scene["objects"][0]
    assert "object_type" in entry
    assert "position_pc" in entry
    assert "size_pc" in entry
    assert "threeMaterial" not in entry


# --------------------------------------------------------------------------
# Export/import round-trip (spec §37 "Scene Serialization")
# --------------------------------------------------------------------------


def test_export_then_load_round_trips_objects_and_structures(
    tmp_path, sample_objects, sample_models
):
    scene = build_scene(sample_objects, sample_models, radius_pc=800.0)
    out_path = tmp_path / "nested" / "scene.json"
    written_path = export_scene(scene, out_path)
    assert written_path == out_path
    assert out_path.exists()

    loaded = load_scene(out_path)
    assert loaded == scene

    # Explicitly re-check the spec §37 invariant: coordinates and
    # structure definitions survive the round trip.
    for original, reloaded in zip(scene["objects"], loaded["objects"]):
        assert original["position_pc"] == reloaded["position_pc"]
    assert loaded["structures"]["gould_belt"] == scene["structures"]["gould_belt"]
    assert loaded["structures"]["radcliffe_wave"] == scene["structures"]["radcliffe_wave"]
    assert loaded["structures"]["local_bubble"] == scene["structures"]["local_bubble"]


def test_export_scene_creates_parent_directories(tmp_path):
    scene = build_scene([], models=None)
    out_path = tmp_path / "a" / "b" / "c" / "scene.json"
    export_scene(scene, out_path)
    assert out_path.exists()


def test_exported_json_is_valid_and_pretty(tmp_path, sample_objects, sample_models):
    scene = build_scene(sample_objects, sample_models)
    out_path = tmp_path / "scene.json"
    export_scene(scene, out_path)
    text = out_path.read_text()
    assert json.loads(text) == scene
    assert "\n" in text  # not minified onto a single line


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def test_cli_parser_help_exits_zero(capsys):
    parser = build_arg_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["--help"])
    assert exc_info.value.code == 0


def test_cli_export_scene_subcommand_help_exits_zero():
    parser = build_arg_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["export-scene", "--help"])
    assert exc_info.value.code == 0


def test_cli_export_scene_default_radius_is_800():
    parser = build_arg_parser()
    args = parser.parse_args(["export-scene"])
    assert args.radius_pc == 800.0


def test_module_invocation_help_works():
    result = subprocess.run(
        [sys.executable, "-m", "local_galactic_structures.cli", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "export-scene" in result.stdout
    assert "build-catalog" in result.stdout


def test_console_script_is_registered_and_help_works():
    # The `galactic-structures` console script (pyproject.toml
    # `[project.scripts]`) is installed alongside the interpreter running
    # these tests (spec §35) - resolve it via sys.executable's directory
    # rather than relying on PATH, which pytest invocations don't always
    # inherit from an activated venv.
    script_path = Path(sys.executable).with_name("galactic-structures")
    if not script_path.exists():
        pytest.skip(
            f"{script_path} not found - run `pip install -e .` to (re)install "
            "the console script entry point"
        )
    result = subprocess.run([str(script_path), "--help"], capture_output=True, text=True)
    assert result.returncode == 0
    assert "export-scene" in result.stdout
    assert "build-catalog" in result.stdout


def _write_model_fixtures(tmp_path: Path) -> tuple[Path, Path, Path]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    gould_belt_path = tmp_path / "gould_belt.yaml"
    gould_belt_path.write_text(
        yaml.safe_dump(
            {
                "representation": "annulus",
                "center": {"x_pc": -104.0, "y_pc": -0.73, "z_pc": 0.0},
                "major_radius_pc": 373.0,
                "minor_radius_pc": 233.0,
                "inclination_deg": 17.2,
                "orientation_deg": 296.1,
                "thickness_pc": 60.0,
                "source": {"reference": "Perrot & Grenier (2003), A&A 404, 519"},
            }
        )
    )

    radcliffe_wave_path = tmp_path / "radcliffe_wave.csv"
    radcliffe_wave_path.write_text(
        "s_pc,x_pc,y_pc,z_pc\n"
        "0.0,-200.0,0.0,-50.0\n"
        "100.0,-100.0,50.0,0.0\n"
        "200.0,0.0,100.0,50.0\n"
    )

    local_bubble_path = tmp_path / "local_bubble.yaml"
    local_bubble_path.write_text(
        yaml.safe_dump(
            {
                "representation": "ellipsoid",
                "enabled": True,
                "center_pc": {"x_pc": 10.0, "y_pc": 30.0, "z_pc": 0.0},
                "semi_axes_pc": {"a_pc": 60.0, "b_pc": 60.0, "c_pc": 162.0},
                "source": {"reference": "Unit test fixture for CLI export-scene"},
            }
        )
    )
    return gould_belt_path, radcliffe_wave_path, local_bubble_path


def test_cli_export_scene_invocation_writes_expected_scene(tmp_path, sample_objects):
    catalog_path = tmp_path / "catalog.parquet"
    save_catalog(sample_objects, catalog_path)

    gould_belt_path, radcliffe_wave_path, local_bubble_path = _write_model_fixtures(tmp_path)
    output_path = tmp_path / "derived" / "scene.json"

    exit_code = cli_main(
        [
            "export-scene",
            "--catalog",
            str(catalog_path),
            "--gould-belt",
            str(gould_belt_path),
            "--radcliffe-wave",
            str(radcliffe_wave_path),
            "--local-bubble",
            str(local_bubble_path),
            "--radius",
            "800",
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 0
    assert output_path.exists()
    scene = json.loads(output_path.read_text())
    assert set(scene.keys()) == {"metadata", "objects", "structures"}
    ids = {entry["id"] for entry in scene["objects"]}
    assert ids == {"sun", "near-one", "near-two"}  # far-one (900 pc) excluded at radius=800
    assert set(scene["structures"].keys()) == {"gould_belt", "radcliffe_wave", "local_bubble"}
    assert scene["structures"]["gould_belt"]["representation"] == "annulus"
    assert len(scene["structures"]["radcliffe_wave"]["points"]) == 3
    assert scene["structures"]["local_bubble"]["representation"] == "ellipsoid"


def test_cli_export_scene_no_radius_filter_includes_everything(tmp_path, sample_objects):
    catalog_path = tmp_path / "catalog.parquet"
    save_catalog(sample_objects, catalog_path)
    gould_belt_path, radcliffe_wave_path, local_bubble_path = _write_model_fixtures(tmp_path)
    output_path = tmp_path / "scene.json"

    exit_code = cli_main(
        [
            "export-scene",
            "--catalog",
            str(catalog_path),
            "--gould-belt",
            str(gould_belt_path),
            "--radcliffe-wave",
            str(radcliffe_wave_path),
            "--local-bubble",
            str(local_bubble_path),
            "--no-radius-filter",
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 0
    scene = json.loads(output_path.read_text())
    assert len(scene["objects"]) == len(sample_objects)


def test_cli_export_scene_missing_model_config_is_skipped_not_fatal(tmp_path, sample_objects):
    catalog_path = tmp_path / "catalog.parquet"
    save_catalog(sample_objects, catalog_path)
    output_path = tmp_path / "scene.json"

    exit_code = cli_main(
        [
            "export-scene",
            "--catalog",
            str(catalog_path),
            "--gould-belt",
            str(tmp_path / "does_not_exist.yaml"),
            "--radcliffe-wave",
            str(tmp_path / "does_not_exist.csv"),
            "--local-bubble",
            str(tmp_path / "does_not_exist.yaml"),
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 0
    scene = json.loads(output_path.read_text())
    assert scene["structures"] == {"gould_belt": {}, "radcliffe_wave": {}, "local_bubble": {}}


# --------------------------------------------------------------------------
# Regression: `--csv-output` must never default to the real repo path when
# `--catalog`/`--output` are overridden (Validator-reported bug against the
# original PR - see PR #78 review comment).
# --------------------------------------------------------------------------


def test_build_coordinates_does_not_touch_real_repo_csv_when_catalog_is_overridden(
    tmp_path, sample_objects
):
    # Reproduces the exact scenario the Validator found: running
    # build-coordinates against a scratch --catalog with no --csv-output
    # override must NOT silently overwrite the real, checked-in
    # data/normalized/catalog.csv.
    real_csv_before = DEFAULT_CSV_PATH.read_text()

    scratch_parquet = tmp_path / "scratch.parquet"
    save_catalog(sample_objects, scratch_parquet)

    exit_code = cli_main(["build-coordinates", "--catalog", str(scratch_parquet)])

    assert exit_code == 0
    assert DEFAULT_CSV_PATH.read_text() == real_csv_before, (
        "the real repo's data/normalized/catalog.csv was modified by a "
        "build-coordinates run against an unrelated scratch catalog"
    )

    # The CSV output should instead have landed next to the scratch
    # parquet path that was actually operated on.
    scratch_csv = scratch_parquet.with_suffix(".csv")
    assert scratch_csv.exists()
    scratch_objects = load_catalog(scratch_parquet)
    assert len(scratch_objects) == len(sample_objects)


def test_build_catalog_does_not_touch_real_repo_csv_when_output_is_overridden(tmp_path):
    # Same defect class as above, in build-catalog's --output/--csv-output
    # pairing - fixed alongside it even though the Validator's repro was
    # specifically against build-coordinates.
    real_csv_before = DEFAULT_CSV_PATH.read_text()

    scratch_parquet = tmp_path / "scratch.parquet"
    exit_code = cli_main(["build-catalog", "--output", str(scratch_parquet)])

    assert exit_code == 0
    assert DEFAULT_CSV_PATH.read_text() == real_csv_before
    assert scratch_parquet.with_suffix(".csv").exists()


def test_build_coordinates_default_invocation_still_targets_real_repo_paths():
    # The fix must not change the *default* (no-override) behavior: running
    # build-coordinates with no flags at all should still target the real
    # checked-in catalog/CSV, exactly as before.
    parser = build_arg_parser()
    args = parser.parse_args(["build-coordinates"])
    assert args.catalog == str(DEFAULT_PARQUET_PATH)
    assert args.csv_output is None  # resolved to DEFAULT_CSV_PATH at run time
    assert Path(args.catalog).with_suffix(".csv") == DEFAULT_CSV_PATH


# --------------------------------------------------------------------------
# Regression: malformed model configs must fail cleanly, not with a raw
# traceback, and `build` must not do redundant model-loading work.
# --------------------------------------------------------------------------


def test_export_scene_reports_clean_error_for_malformed_model_config(
    tmp_path, sample_objects, capsys
):
    catalog_path = tmp_path / "catalog.parquet"
    save_catalog(sample_objects, catalog_path)

    bad_gould_belt_path = tmp_path / "gould_belt.yaml"
    bad_gould_belt_path.write_text(
        yaml.safe_dump(
            {
                "representation": "annulus",
                "center": {"x_pc": -104.0, "y_pc": -0.73, "z_pc": 0.0},
                "major_radius_pc": -373.0,  # invalid: must be > 0
                "minor_radius_pc": 233.0,
                "inclination_deg": 17.2,
                "orientation_deg": 296.1,
                "thickness_pc": 60.0,
                "source": {"reference": "Perrot & Grenier (2003), A&A 404, 519"},
            }
        )
    )
    # Valid fixtures live in their own subdirectory so they don't collide
    # with (and silently overwrite) bad_gould_belt_path above - both would
    # otherwise be named "gould_belt.yaml" directly under tmp_path.
    _, radcliffe_wave_path, local_bubble_path = _write_model_fixtures(tmp_path / "valid")
    output_path = tmp_path / "scene.json"

    exit_code = cli_main(
        [
            "export-scene",
            "--catalog",
            str(catalog_path),
            "--gould-belt",
            str(bad_gould_belt_path),
            "--radcliffe-wave",
            str(radcliffe_wave_path),
            "--local-bubble",
            str(local_bubble_path),
            "--output",
            str(output_path),
        ]
    )

    # Non-zero, clean error - not an unhandled exception/traceback, and no
    # partial scene.json left behind.
    assert exit_code == 1
    assert not output_path.exists()
    captured = capsys.readouterr()
    assert "gould_belt" in captured.err
    assert "error" in captured.err.lower()


def test_load_models_for_scene_raises_model_load_error_for_malformed_config(tmp_path):
    from local_galactic_structures.cli import _load_models_for_scene

    bad_local_bubble_path = tmp_path / "local_bubble.yaml"
    bad_local_bubble_path.write_text(
        yaml.safe_dump(
            {
                "representation": "ellipsoid",
                "enabled": True,
                "center_pc": {"x_pc": 10.0, "y_pc": 30.0, "z_pc": 0.0},
                "semi_axes_pc": {"a_pc": -60.0, "b_pc": 60.0, "c_pc": 162.0},  # invalid
                "source": {"reference": "Unit test fixture"},
            }
        )
    )
    # Valid fixtures live in their own subdirectory so they don't collide
    # with (and silently overwrite) bad_local_bubble_path above.
    _, radcliffe_wave_path, _ = _write_model_fixtures(tmp_path / "valid")

    with pytest.raises(ModelLoadError, match="local_bubble"):
        _load_models_for_scene(
            tmp_path / "does_not_exist.yaml",  # missing - just skipped
            radcliffe_wave_path,
            bad_local_bubble_path,  # exists but invalid - must raise
        )


def test_build_does_not_call_load_models_for_scene_twice(tmp_path, monkeypatch):
    # Regression for the "build calls _load_models_for_scene once to print
    # 'build-models: done' (result discarded) and again inside export-scene"
    # waste the Validator flagged. Also incidentally re-confirms the
    # scripts/build_initial_catalog.py refactor still produces byte-
    # identical output on every `build` invocation, not just once.
    import local_galactic_structures.cli as cli_module

    parquet_before = DEFAULT_PARQUET_PATH.read_bytes()
    csv_before = DEFAULT_CSV_PATH.read_text()

    call_count = {"n": 0}
    original = cli_module._load_models_for_scene

    def counting_wrapper(*args, **kwargs):
        call_count["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(cli_module, "_load_models_for_scene", counting_wrapper)

    output_path = tmp_path / "scene.json"
    exit_code = cli_module.main(["build", "--output", str(output_path)])

    assert exit_code == 0
    assert call_count["n"] == 1, (
        "build should load the model-layer configs exactly once per "
        "invocation, not once (discarded) plus once more for real"
    )
    assert output_path.exists()

    # build-catalog/build-coordinates deterministically rewrite the real
    # checked-in catalog with identical content (spec §14: rebuildable) -
    # confirm that invariant held for this `build` run too.
    assert DEFAULT_PARQUET_PATH.read_bytes() == parquet_before
    assert DEFAULT_CSV_PATH.read_text() == csv_before


def test_cmd_build_reuses_subcommand_functions(monkeypatch):
    # Regression for "build inlines build-catalog/build-coordinates bodies
    # instead of calling those functions" - assert the actual `_cmd_*`
    # functions are invoked, in the documented order, rather than their
    # logic being duplicated inline. Stubs are pure no-ops (no real
    # loader/original call) so this test never touches the real repo's
    # catalog/model files.
    import local_galactic_structures.cli as cli_module

    calls: list[str] = []
    for name in (
        "_cmd_build_catalog",
        "_cmd_build_coordinates",
        "_cmd_build_models",
        "_cmd_export_scene",
    ):

        def make_stub(fn_name: str):
            def stub(args: argparse.Namespace) -> int:
                calls.append(fn_name)
                return 0

            return stub

        monkeypatch.setattr(cli_module, name, make_stub(name))

    build_args = argparse.Namespace(
        radius_pc=800.0, no_radius_filter=False, output="unused.json"
    )
    exit_code = cli_module._cmd_build(build_args)

    assert exit_code == 0
    assert calls == [
        "_cmd_build_catalog",
        "_cmd_build_coordinates",
        "_cmd_build_models",
        "_cmd_export_scene",
    ]


def test_cmd_build_aborts_early_when_a_stage_fails(monkeypatch):
    # If an earlier stage fails, later stages must not run.
    import local_galactic_structures.cli as cli_module

    calls: list[str] = []

    def failing_build_catalog(args: argparse.Namespace) -> int:
        calls.append("_cmd_build_catalog")
        return 1

    def should_not_run(args: argparse.Namespace) -> int:
        calls.append("should_not_run")
        return 0

    monkeypatch.setattr(cli_module, "_cmd_build_catalog", failing_build_catalog)
    monkeypatch.setattr(cli_module, "_cmd_build_coordinates", should_not_run)
    monkeypatch.setattr(cli_module, "_cmd_build_models", should_not_run)
    monkeypatch.setattr(cli_module, "_cmd_export_scene", should_not_run)

    build_args = argparse.Namespace(
        radius_pc=800.0, no_radius_filter=False, output="unused.json"
    )
    exit_code = cli_module._cmd_build(build_args)

    assert exit_code == 1
    assert calls == ["_cmd_build_catalog"]
