from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from PIL import Image
from reportlab.pdfgen import canvas


SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
    '<rect width="200" height="100" fill="#ffffff"/>'
    '<circle cx="100" cy="50" r="30" fill="#148c9e"/>'
    '</svg>'
)


def _provenance(**changes):
    value = {
        "origin": "synthetic_fixture",
        "title": "Synthetic vector fixture",
        "permission_note": "Original test artwork",
        "external_rendering_authorized": True,
    }
    value.update(changes)
    return value


def _svg(tmp_path: Path, text: str = SVG, name: str = "fixture.svg") -> Path:
    source = tmp_path / name
    source.write_text(text, encoding="utf-8")
    return source


def _pdf(path: Path, *, pages: int = 1, image: bool = False, vector: bool = True) -> Path:
    writer = canvas.Canvas(str(path), pagesize=(200, 100))
    for page in range(pages):
        if vector:
            writer.setFillColorRGB(0.08, 0.55, 0.62)
            writer.circle(100, 50, 25, fill=1)
            writer.drawString(8, 8, f"synthetic page {page + 1}")
        if image:
            raster = path.with_name(f"pixel-{page}.png")
            Image.new("RGB", (4, 4), (20, 140, 160)).save(raster)
            writer.drawImage(str(raster), 40, 20, width=30, height=30)
        writer.showPage()
    writer.save()
    return path


def _manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _rehash_manifest(path: Path, manifest: dict) -> None:
    unsigned = dict(manifest)
    unsigned.pop("asset_id", None)
    manifest["asset_id"] = hashlib.sha256(
        json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                   allow_nan=False).encode("utf-8")
    ).hexdigest()
    path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8")


def _rename_rehashed_bundle(asset: Path, manifest: dict) -> Path:
    _rehash_manifest(asset, manifest)
    renamed = asset.parent.with_name(manifest["asset_id"])
    asset.parent.rename(renamed)
    return renamed / "asset.json"


def _nested_image_form_pdf(path: Path, depth: int = 66) -> Path:
    raster = path.with_name("nested-pixel.png")
    Image.new("RGB", (4, 4), (20, 140, 160)).save(raster)
    writer = canvas.Canvas(str(path), pagesize=(200, 100))
    writer.beginForm("nested-0", 0, 0, 20, 20)
    writer.drawImage(str(raster), 0, 0, width=10, height=10)
    writer.endForm()
    for index in range(1, depth + 1):
        writer.beginForm(f"nested-{index}", 0, 0, 20, 20)
        writer.doForm(f"nested-{index - 1}")
        writer.endForm()
    writer.line(10, 10, 190, 90)
    writer.doForm(f"nested-{depth}")
    writer.showPage()
    writer.save()
    return path


def test_import_preserves_original_and_detects_tampering(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    source = _svg(tmp_path)
    asset = import_vector(source, tmp_path / "project", _provenance())
    manifest = verify_asset(asset)

    assert (asset.parent / manifest["source"]["file"]).read_bytes() == source.read_bytes()
    assert manifest["format"] == "arc-vector-asset/1"
    assert manifest["source"] == {
        "file": "source.svg",
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "size": len(source.read_bytes()),
        "media_type": "image/svg+xml",
        "content_kind": "vector",
    }
    assert manifest["preview"]["file"] == "source.png"
    assert manifest["preview"]["width"] == 200
    assert manifest["preview"]["height"] == 100
    assert manifest["rights_verified"] is False
    assert manifest["scientific_validity_established"] is False
    with Image.open(asset.parent / "source.png") as proof:
        proof.verify()

    (asset.parent / manifest["source"]["file"]).write_bytes(b"changed")
    with pytest.raises(ValueError):
        verify_asset(asset)


def test_imports_one_page_vector_pdf_and_classifies_mixed_pdf(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    vector_asset = import_vector(
        _pdf(tmp_path / "vector.pdf"), tmp_path / "vector-project", _provenance()
    )
    mixed_asset = import_vector(
        _pdf(tmp_path / "mixed.pdf", image=True), tmp_path / "mixed-project", _provenance()
    )

    vector = verify_asset(vector_asset)
    mixed = verify_asset(mixed_asset)
    assert vector["source"]["content_kind"] == "vector"
    assert mixed["source"]["content_kind"] == "mixed_vector_image"
    assert vector["source"]["file"] == mixed["source"]["file"] == "source.pdf"
    assert (vector["preview"]["width"], vector["preview"]["height"]) == (200, 100)


def test_rejects_pdf_forms_deeper_than_complete_object_inspection(tmp_path):
    from arc_science.vector_assets import import_vector

    source = _nested_image_form_pdf(tmp_path / "nested.pdf")
    with pytest.raises(ValueError):
        import_vector(source, tmp_path / "project", _provenance())


@pytest.mark.parametrize(
    "provenance",
    [
        {k: v for k, v in _provenance().items() if k != "external_rendering_authorized"},
        _provenance(external_rendering_authorized=False),
        _provenance(unknown="not allowed"),
        _provenance(origin="unknown"),
    ],
)
def test_rejects_unapproved_or_open_ended_provenance(tmp_path, provenance):
    from arc_science.vector_assets import import_vector

    with pytest.raises(ValueError):
        import_vector(_svg(tmp_path), tmp_path / "project", provenance)


def test_malformed_provenance_scalar_raises_value_error(tmp_path):
    from arc_science.vector_assets import import_vector

    with pytest.raises(ValueError):
        import_vector(_svg(tmp_path), tmp_path / "project", _provenance(origin=[]))


def test_biorender_provenance_closed_public_detail_contract(tmp_path, biorender_provenance_case):
    from arc_science.vector_assets import import_vector, verify_asset

    provenance, accepted = biorender_provenance_case
    source = _svg(tmp_path)
    if accepted:
        manifest = verify_asset(import_vector(source, tmp_path / "project", provenance))
        assert manifest["provenance"] == provenance
        assert manifest["rights_verified"] is False
        assert manifest["scientific_validity_established"] is False
    else:
        with pytest.raises(ValueError):
            import_vector(source, tmp_path / "project", provenance)


@pytest.mark.parametrize(
    "name,data",
    [
        ("fake.svg", b"%PDF-1.7\nnot really a PDF"),
        ("fake.pdf", SVG.encode("utf-8")),
        ("fake.png", b"\x89PNG\r\n\x1a\n"),
        ("empty.svg", b""),
    ],
)
def test_rejects_spoofed_empty_or_unsupported_sources(tmp_path, name, data):
    from arc_science.vector_assets import import_vector

    source = tmp_path / name
    source.write_bytes(data)
    with pytest.raises(ValueError):
        import_vector(source, tmp_path / "project", _provenance())


@pytest.mark.parametrize(
    "dimensions",
    [
        'width="0" height="100"',
        'width="200" height="-1"',
        'width="NaN" height="100"',
        'width="inf" height="100"',
        'width="200"',
    ],
)
def test_rejects_empty_or_nonfinite_svg_dimensions(tmp_path, dimensions):
    from arc_science.vector_assets import import_vector

    source = _svg(tmp_path, f'<svg xmlns="http://www.w3.org/2000/svg" {dimensions}/>' )
    with pytest.raises(ValueError):
        import_vector(source, tmp_path / "project", _provenance())


@pytest.mark.parametrize(
    "content",
    [
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect onclick="x()"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,AA=="/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>rect{fill:red}</style></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use href="#x"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="url(https://evil.example/x)"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><metadata/></svg>',
        '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">&xxe;</svg>',
    ],
)
def test_rejects_unsafe_or_unsupported_svg(tmp_path, content):
    from arc_science.vector_assets import import_vector

    with pytest.raises(ValueError):
        import_vector(_svg(tmp_path, content), tmp_path / "project", _provenance())


@pytest.mark.parametrize("content", [
    pytest.param('<text x="10" y="60" textLength="50">Protein</text>', id="text-textLength"),
    pytest.param('<text x="10" y="60" lengthAdjust="spacingAndGlyphs">Protein</text>', id="text-lengthAdjust"),
    pytest.param('<text><tspan x="10" y="60" textLength="250">Protein</tspan></text>', id="tspan-textLength"),
    pytest.param('<text><tspan x="10" y="60" lengthAdjust="spacing">Protein</tspan></text>', id="tspan-lengthAdjust"),
    pytest.param('<path d="M10 50 H190" stroke="black" stroke-dasharray="5 5" pathLength="1"/>', id="path-pathLength"),
    pytest.param('<defs><radialGradient id="g" fr="40%"><stop stop-color="red"/>'
                 '<stop offset="1" stop-color="blue"/></radialGradient></defs>'
                 '<rect width="200" height="100" fill="url(#g)"/>', id="radial-gradient-fr"),
    pytest.param('<text x="10" y="60" dominant-baseline="mathematical">Protein</text>', id="dominant-baseline"),
    pytest.param('<g dominant-baseline="ideographic"><text x="10" y="60">Protein</text></g>', id="inherited-dominant-baseline"),
])
def test_rejects_svg_attributes_with_unimplemented_converter_semantics(tmp_path, content):
    from arc_science.vector_assets import import_vector

    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' + content + '</svg>'
    with pytest.raises(ValueError, match="Unsupported SVG attribute"):
        import_vector(_svg(tmp_path, svg), tmp_path / "project", _provenance())
    assert not (tmp_path / "project").exists()


def test_supported_static_shapes_text_clips_and_gradients_remain_intact(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"
                  viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="clip" clipPathUnits="userSpaceOnUse"><rect width="100" height="100"/></clipPath>
        <linearGradient id="linear" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"
                        gradientTransform="translate(0 0)" spreadMethod="pad">
          <stop offset="0" stop-color="#ff0000" stop-opacity="1"/><stop offset="1" stop-color="#0000ff"/>
        </linearGradient>
        <radialGradient id="radial" cx="0.5" cy="0.5" r="0.5" fx="0.5" fy="0.5"
                        gradientUnits="objectBoundingBox" href="#linear"/>
      </defs>
      <rect width="200" height="100" fill="url(#linear)" clip-path="url(#clip)"/>
      <circle cx="150" cy="25" r="20" fill="url(#radial)"/>
      <g transform="translate(100 50)" fill="none" stroke="black" stroke-width="1" opacity="0.8">
        <ellipse cx="15" cy="10" rx="10" ry="5"/><line x1="0" y1="20" x2="40" y2="20"/>
        <polyline points="0,25 10,30 20,25"/><polygon points="30,25 40,30 50,25"/>
        <path d="M0 35 H90" stroke-dasharray="5 5" stroke-dashoffset="1"/>
      </g>
      <text x="105" y="97" font-size="10" font-family="sans-serif" font-style="normal"
            font-weight="bold" text-anchor="start" letter-spacing="1" xml:space="preserve">
        A<tspan dx="1" dy="0" rotate="0">B</tspan>
      </text>
    </svg>'''
    source = _svg(tmp_path, svg)
    asset = import_vector(source, tmp_path / "project", _provenance())
    assert verify_asset(asset)["source"]["content_kind"] == "vector"
    assert (asset.parent / "source.svg").read_bytes() == source.read_bytes()
    with Image.open(asset.parent / "source.png") as image:
        assert image.size == (200, 100)
        assert image.getpixel((10, 10))[0] > image.getpixel((10, 10))[2]
        assert image.getpixel((90, 10))[2] > image.getpixel((90, 10))[0]
        assert image.getpixel((110, 10))[3] == 0  # User-space clip is retained.
        assert image.getpixel((150, 25))[0] > image.getpixel((150, 25))[2]


def test_rejects_svg_beyond_node_and_depth_limits(tmp_path):
    from arc_science.vector_assets import import_vector

    too_many = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' + (
        '<rect width="1" height="1"/>' * 10_001
    ) + "</svg>"
    too_deep = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' + (
        "<g>" * 65
    ) + ("</g>" * 65) + "</svg>"
    for index, content in enumerate((too_many, too_deep)):
        with pytest.raises(ValueError):
            import_vector(
                _svg(tmp_path, content, f"large-{index}.svg"),
                tmp_path / f"project-{index}",
                _provenance(),
            )


def test_rejects_image_only_and_multiple_page_pdfs(tmp_path):
    from arc_science.vector_assets import import_vector

    for index, source in enumerate(
        (_pdf(tmp_path / "image.pdf", image=True, vector=False), _pdf(tmp_path / "pages.pdf", pages=2))
    ):
        with pytest.raises(ValueError):
            import_vector(source, tmp_path / f"project-{index}", _provenance())


def test_identical_import_validates_before_reusing_existing_bundle(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    source = _svg(tmp_path)
    project = tmp_path / "project"
    first = import_vector(source, project, _provenance())
    second = import_vector(source, project, _provenance())
    assert first == second
    assert verify_asset(second)["asset_id"] == first.parent.name

    (first.parent / "source.png").write_bytes(b"broken")
    with pytest.raises(ValueError):
        import_vector(source, project, _provenance())


@pytest.mark.skipif(not hasattr(os, "mkfifo") or not hasattr(os, "O_NONBLOCK"),
                    reason="FIFO substitution requires POSIX nonblocking files")
@pytest.mark.parametrize("boundary", ["input-source", "provenance-file", "asset.json", "source.svg", "source.png"])
def test_stat_to_fifo_substitution_rejects_before_read_without_blocking(tmp_path, boundary):
    import arc_science.vector_assets as vector_assets

    source = _svg(tmp_path)
    provenance_file = tmp_path / "provenance.json"
    provenance_file.write_text(json.dumps(_provenance()))
    asset = vector_assets.import_vector(source, tmp_path / "project", _provenance())
    if boundary == "input-source":
        target = source
    elif boundary == "provenance-file":
        target = provenance_file
    else:
        target = asset.parent / boundary

    # Perform the real replacement at the stat/open boundary in a disposable
    # process. The outer timeout kills it even if a blocking-open bug returns.
    script = '''import json, os, pathlib, stat, sys, time
sys.path.insert(0, sys.argv[1])
from arc_science import vector_assets
from arc_science.cli import main
target, source, provenance_file, asset = map(pathlib.Path, sys.argv[2:6])
boundary = sys.argv[6]
real_stat, real_read = os.stat, os.read
swapped = False
def stat_then_fifo(path, *args, **kwargs):
    global swapped
    result = real_stat(path, *args, **kwargs)
    if not swapped and path == target.name and kwargs.get('dir_fd') is not None:
        swapped = True
        target.unlink()
        os.mkfifo(target)
    return result
def regular_read_only(fd, *args):
    assert stat.S_ISREG(os.fstat(fd).st_mode), 'Nonregular descriptor reached read'
    return real_read(fd, *args)
os.stat, os.read = stat_then_fifo, regular_read_only
started = time.monotonic()
if boundary == 'provenance-file':
    assert main(['figure-import', str(source), '--project', str(target.parent/'rejected'),
                 '--provenance-file', str(provenance_file)]) == 1
else:
    try:
        if boundary == 'input-source':
            vector_assets.import_vector(source, target.parent/'rejected', json.loads(provenance_file.read_text()))
        else:
            vector_assets.verify_asset(asset)
    except ValueError:
        pass
    else:
        raise AssertionError('FIFO substitution was accepted')
assert swapped, 'Substitution did not exercise the boundary'
assert time.monotonic() - started < 1, 'FIFO rejection was not prompt'
print('FIFO_REJECTED_BEFORE_READ')
'''
    result = subprocess.run(
        [sys.executable, "-c", script, str(Path(vector_assets.__file__).parents[1]),
         str(target), str(source), str(provenance_file), str(asset), boundary],
        capture_output=True, text=True, timeout=3,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    assert result.stdout.strip() == "FIFO_REJECTED_BEFORE_READ"


@pytest.mark.parametrize("primitive", ["O_NONBLOCK", "O_NOFOLLOW"])
def test_vector_reads_fail_closed_without_safe_open_primitives(tmp_path, monkeypatch, primitive):
    from arc_science.vector_assets import import_vector

    source = _svg(tmp_path)
    monkeypatch.delattr(os, primitive)
    with pytest.raises(ValueError, match="filesystem"):
        import_vector(source, tmp_path / "project", _provenance())
    assert not (tmp_path / "project").exists()


def test_existing_asset_verification_stays_bound_to_opened_assets_directory(tmp_path, monkeypatch):
    import arc_science.vector_assets as vector_assets

    source = _svg(tmp_path)
    current = tmp_path / "current"
    shadow = tmp_path / "shadow"
    held = tmp_path / "held"
    asset = vector_assets.import_vector(source, current, _provenance())
    vector_assets.import_vector(source, shadow, _provenance())
    (asset.parent / "source.png").write_bytes(b"corrupt")
    asset_id = asset.parent.name
    real_stat = vector_assets.os.stat
    swapped = False

    def stat_then_swap(path, *args, **kwargs):
        nonlocal swapped
        result = real_stat(path, *args, **kwargs)
        if path == asset_id and kwargs.get("dir_fd") is not None and not swapped:
            swapped = True
            current.rename(held)
            shadow.rename(current)
        return result

    monkeypatch.setattr(vector_assets.os, "stat", stat_then_swap)
    with pytest.raises(ValueError):
        vector_assets.import_vector(source, current, _provenance())
    assert (held / "assets" / asset_id / "source.png").read_bytes() == b"corrupt"


def test_concurrent_asset_verification_stays_bound_to_opened_assets_directory(tmp_path, monkeypatch):
    import arc_science.vector_assets as vector_assets

    source = _svg(tmp_path)
    current = tmp_path / "current"
    shadow = tmp_path / "shadow"
    donor = tmp_path / "donor"
    held = tmp_path / "held"
    shadow_asset = vector_assets.import_vector(source, shadow, _provenance())
    donor_asset = vector_assets.import_vector(source, donor, _provenance())
    (donor_asset.parent / "source.png").write_bytes(b"corrupt")
    asset_id = shadow_asset.parent.name
    real_rename = vector_assets.os.rename
    swapped = False

    def concurrent_destination_then_swap(source_name, destination_name, *args, **kwargs):
        nonlocal swapped
        if (not swapped and isinstance(source_name, str) and source_name.startswith(".asset-") and
                destination_name == asset_id and kwargs.get("dst_dir_fd") is not None):
            swapped = True
            assets_fd = kwargs["dst_dir_fd"]
            real_rename(donor_asset.parent, asset_id, dst_dir_fd=assets_fd)
            real_rename(current, held)
            real_rename(shadow, current)
            raise FileExistsError("simulated concurrent destination")
        return real_rename(source_name, destination_name, *args, **kwargs)

    monkeypatch.setattr(vector_assets.os, "rename", concurrent_destination_then_swap)
    with pytest.raises(ValueError):
        vector_assets.import_vector(source, current, _provenance())
    assert (held / "assets" / asset_id / "source.png").read_bytes() == b"corrupt"


@pytest.mark.parametrize("boundary", ["source", "project", "verify"])
def test_rejects_symlinks_in_ancestor_path_components(tmp_path, boundary):
    from arc_science.vector_assets import import_vector, verify_asset

    real = tmp_path / "real"
    real.mkdir()
    source = _svg(real)
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)

    if boundary == "source":
        with pytest.raises(ValueError):
            import_vector(alias / source.name, tmp_path / "project", _provenance())
    elif boundary == "project":
        with pytest.raises(ValueError):
            import_vector(source, alias / "project", _provenance())
    else:
        asset = import_vector(source, real / "project", _provenance())
        aliased_asset = alias / "project" / "assets" / asset.parent.name / "asset.json"
        with pytest.raises(ValueError):
            verify_asset(aliased_asset)


def test_import_rejects_dangling_symlink_at_asset_destination(tmp_path):
    from arc_science.vector_assets import import_vector

    source = _svg(tmp_path)
    first = import_vector(source, tmp_path / "first-project", _provenance())
    second_assets = tmp_path / "second-project" / "assets"
    second_assets.mkdir(parents=True)
    (second_assets / first.parent.name).symlink_to(tmp_path / "outside")

    with pytest.raises(ValueError):
        import_vector(source, tmp_path / "second-project", _provenance())


@pytest.mark.parametrize("target_name", ["source.svg", "source.png"])
def test_verify_rejects_source_and_preview_symlinks(tmp_path, target_name):
    from arc_science.vector_assets import import_vector, verify_asset

    asset = import_vector(_svg(tmp_path), tmp_path / "project", _provenance())
    target = asset.parent / target_name
    saved = tmp_path / (target_name + ".saved")
    saved.write_bytes(target.read_bytes())
    target.unlink()
    target.symlink_to(saved)
    with pytest.raises(ValueError):
        verify_asset(asset)


def test_verify_rejects_forged_rehashed_preview_metadata(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    asset = import_vector(_svg(tmp_path), tmp_path / "project", _provenance())
    preview = asset.parent / "source.png"
    with Image.open(preview) as image:
        forged = image.convert("RGBA")
    forged.putpixel((0, 0), (255, 0, 255, 255))
    forged.save(preview, format="PNG")

    manifest = _manifest(asset)
    manifest["preview"]["sha256"] = hashlib.sha256(preview.read_bytes()).hexdigest()
    manifest["preview"]["pixel_sha256"] = hashlib.sha256(forged.tobytes()).hexdigest()
    asset = _rename_rehashed_bundle(asset, manifest)

    with pytest.raises(ValueError):
        verify_asset(asset)


def test_verify_checks_png_header_dimensions_before_loading_pixels(tmp_path, monkeypatch):
    from arc_science.vector_assets import import_vector, verify_asset

    asset = import_vector(_svg(tmp_path), tmp_path / "project", _provenance())
    preview = asset.parent / "source.png"
    Image.new("RGB", (3000, 3000), (20, 140, 160)).save(preview)
    manifest = _manifest(asset)
    manifest["preview"]["sha256"] = hashlib.sha256(preview.read_bytes()).hexdigest()
    asset = _rename_rehashed_bundle(asset, manifest)

    def allocation_forbidden(*_args, **_kwargs):
        raise RuntimeError("pixel allocation reached")

    monkeypatch.setattr("PIL.ImageFile.ImageFile.load", allocation_forbidden)
    with pytest.raises(ValueError, match="dimensions"):
        verify_asset(asset)


def test_malformed_manifest_scalar_raises_value_error(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    asset = import_vector(_svg(tmp_path), tmp_path / "project", _provenance())
    manifest = _manifest(asset)
    manifest["source"]["content_kind"] = []
    asset = _rename_rehashed_bundle(asset, manifest)
    with pytest.raises(ValueError):
        verify_asset(asset)


def test_verify_rejects_manifest_shape_and_asset_identity_forgery(tmp_path):
    from arc_science.vector_assets import import_vector, verify_asset

    asset = import_vector(_svg(tmp_path), tmp_path / "project", _provenance())
    manifest = _manifest(asset)
    manifest["unexpected"] = True
    _rehash_manifest(asset, manifest)
    with pytest.raises(ValueError):
        verify_asset(asset)


def test_figure_import_cli_returns_absolute_manifest_path(tmp_path, capsys):
    from arc_science.cli import main

    source = _svg(tmp_path)
    project = tmp_path / "project"
    status = main(
        [
            "figure-import",
            str(source),
            "--project",
            str(project),
            "--provenance",
            json.dumps(_provenance()),
        ]
    )
    output = json.loads(capsys.readouterr().out)
    assert status == 0
    assert Path(output["asset_manifest"]).is_absolute()
    assert output["asset_id"] == _manifest(Path(output["asset_manifest"]))["asset_id"]


def test_figure_import_cli_bounds_provenance_json(tmp_path, capsys):
    from arc_science.cli import main

    status = main(
        [
            "figure-import",
            str(_svg(tmp_path)),
            "--project",
            str(tmp_path / "project"),
            "--provenance",
            "{" + ("x" * 70_000),
        ]
    )
    assert status == 1
    assert "ValueError" in capsys.readouterr().err


def test_figure_import_cli_reads_bounded_regular_provenance_file(tmp_path, capsys):
    from arc_science.cli import main

    provenance_file = tmp_path / "provenance.json"
    provenance_file.write_text(json.dumps(_provenance()), encoding="utf-8")
    status = main(
        [
            "figure-import",
            str(_svg(tmp_path)),
            "--project",
            str(tmp_path / "project"),
            "--provenance-file",
            str(provenance_file),
        ]
    )
    output = json.loads(capsys.readouterr().out)
    assert status == 0
    assert output["asset_id"] == _manifest(Path(output["asset_manifest"]))["asset_id"]


def test_figure_import_cli_rejects_symlinked_provenance_file(tmp_path, capsys):
    from arc_science.cli import main

    stored = tmp_path / "stored.json"
    stored.write_text(json.dumps(_provenance()), encoding="utf-8")
    link = tmp_path / "provenance.json"
    link.symlink_to(stored)
    status = main(
        [
            "figure-import",
            str(_svg(tmp_path)),
            "--project",
            str(tmp_path / "project"),
            "--provenance-file",
            str(link),
        ]
    )
    assert status == 1
    assert "ValueError" in capsys.readouterr().err


def test_figure_import_cli_rejects_ambiguous_provenance_options(tmp_path, capsys):
    from arc_science.cli import main

    provenance_file = tmp_path / "provenance.json"
    provenance_file.write_text(json.dumps(_provenance()), encoding="utf-8")
    with pytest.raises(SystemExit) as raised:
        main(
            [
                "figure-import",
                str(_svg(tmp_path)),
                "--project",
                str(tmp_path / "project"),
                "--provenance",
                json.dumps(_provenance()),
                "--provenance-file",
                str(provenance_file),
            ]
        )
    assert raised.value.code == 2
    assert "not allowed with argument" in capsys.readouterr().err
