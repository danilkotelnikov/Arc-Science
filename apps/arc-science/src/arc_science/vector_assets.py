"""Validated, immutable source/proof bundles for operator-authorized vectors."""
from __future__ import annotations

from io import BytesIO
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
from urllib.parse import urlsplit

from PIL import Image

from .contracts import canonical


_SOURCE_LIMIT = 16 * 1024 * 1024
_MANIFEST_LIMIT = 64 * 1024
_MAX_EDGE = 2048
_MAX_PIXELS = 4_194_304
_MAX_SVG_NODES = 10_000
_MAX_SVG_DEPTH = 64
_MAX_PDF_FORM_DEPTH = 16
_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_XML_NS = "http://www.w3.org/XML/1998/namespace"
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_TEMPLATE_ID = re.compile(r"^[A-Za-z0-9._-]{1,160}$")
_DIMENSION = re.compile(r"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:px)?$")
_LOCAL_URL = re.compile(r"url\(\s*#[A-Za-z_][A-Za-z0-9_.:-]*\s*\)", re.IGNORECASE)

# CairoSVG does not implement textLength/lengthAdjust/pathLength/fr. Its baseline
# alignment is partial and approximate, so dominant-baseline is also excluded.
_SVG_ATTRIBUTES = {
    "svg": {"width", "height", "viewBox", "preserveAspectRatio"},
    "g": set(),
    "defs": set(),
    "rect": {"x", "y", "width", "height", "rx", "ry"},
    "circle": {"cx", "cy", "r"},
    "ellipse": {"cx", "cy", "rx", "ry"},
    "line": {"x1", "y1", "x2", "y2"},
    "polyline": {"points"},
    "polygon": {"points"},
    "path": {"d"},
    "text": {"x", "y", "dx", "dy", "rotate"},
    "tspan": {"x", "y", "dx", "dy", "rotate"},
    "clipPath": {"clipPathUnits"},
    "linearGradient": {"x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod", "href"},
    "radialGradient": {"cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform", "spreadMethod", "href"},
    "stop": {"offset", "stop-color", "stop-opacity"},
}
_PRESENTATION_ATTRIBUTES = {
    "id", "transform", "opacity", "fill", "fill-opacity", "fill-rule", "stroke",
    "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "clip-path",
    "display", "visibility", "color", "font-family", "font-size", "font-style",
    "font-weight", "text-anchor", "letter-spacing",
}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _open_directory(path: Path, *, create: bool = False) -> int:
    """Open every directory component without following symlinks."""
    absolute = _absolute_path(path)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(absolute.anchor, flags)
    except OSError:
        raise ValueError("Path does not have a safe directory root") from None
    try:
        for component in absolute.parts[1:]:
            if create:
                try:
                    os.mkdir(component, mode=0o755, dir_fd=descriptor)
                except FileExistsError:
                    pass
            next_descriptor = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except OSError:
        os.close(descriptor)
        raise ValueError("Path contains a missing, non-directory, or symlink component") from None


def _read_regular_at(directory_fd: int, name: str, limit: int,
                     label: str = "Source or manifest") -> bytes:
    if Path(name).name != name or name in {"", ".", ".."}:
        raise ValueError(f"{label} filename is unsafe")
    if not getattr(os, "O_NOFOLLOW", 0) or not getattr(os, "O_NONBLOCK", 0):
        raise ValueError("Safe file reads require no-follow and nonblocking filesystem primitives")
    try:
        before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except OSError:
        raise ValueError(f"{label} is not a readable regular file") from None
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise ValueError(f"{label} is not a bounded regular file")
    # A regular file can be replaced with a FIFO after stat. Never block before
    # fstat validates the descriptor, and keep reads anchored to directory_fd.
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            opened = os.fstat(descriptor)
            if (not stat.S_ISREG(opened.st_mode) or opened.st_dev != before.st_dev or
                    opened.st_ino != before.st_ino or opened.st_size != before.st_size):
                raise ValueError("File changed while it was opened")
            chunks = []
            remaining = limit + 1
            while remaining:
                chunk = os.read(descriptor, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            if (after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or
                    after.st_ctime_ns != before.st_ctime_ns):
                raise ValueError(f"{label} changed while it was read")
        finally:
            os.close(descriptor)
    except ValueError:
        raise
    except OSError:
        raise ValueError(f"{label} could not be read safely") from None
    data = b"".join(chunks)
    if not data or len(data) > limit or len(data) != before.st_size:
        raise ValueError(f"{label} exceeds its size limit")
    return data


def _read_regular(path: Path, limit: int, label: str = "Source or manifest") -> bytes:
    absolute = _absolute_path(path)
    directory_fd = _open_directory(absolute.parent)
    try:
        return _read_regular_at(directory_fd, absolute.name, limit, label)
    finally:
        os.close(directory_fd)


def _write_regular_at(directory_fd: int, name: str, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(name, flags, 0o644, dir_fd=directory_fd)
    try:
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _remove_temporary_at(assets_fd: int, name: str) -> None:
    try:
        temporary_fd = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=assets_fd,
        )
    except OSError:
        return
    try:
        for entry in os.listdir(temporary_fd):
            os.unlink(entry, dir_fd=temporary_fd)
    finally:
        os.close(temporary_fd)
    os.rmdir(name, dir_fd=assets_fd)


def _plain_text(value: object, field: str, maximum: int) -> str:
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum or
            any(ord(character) < 32 for character in value)):
        raise ValueError(f"Invalid provenance {field}")
    return value


def _safe_https_url(value: object) -> str:
    url = _plain_text(value, "source_url", 2000)
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    try:
        port = parsed.port
    except ValueError:
        port = -1
    if ("\\" in url or any(character.isspace() for character in url) or
            parsed.scheme != "https" or parsed.username is not None or parsed.password is not None or
            port is not None or not hostname or not hostname.isascii() or
            parsed.netloc.casefold() != hostname):
        raise ValueError("Invalid provenance source_url")
    return url


def _validate_provenance(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Provenance must be an object")
    allowed = {"origin", "title", "source_url", "template_id", "permission_note",
               "external_rendering_authorized"}
    required = {"origin", "title", "permission_note", "external_rendering_authorized"}
    if set(value) - allowed or not required <= set(value):
        raise ValueError("Invalid provenance fields")
    origin = value.get("origin")
    if not isinstance(origin, str) or origin not in {"biorender", "nih_bioart", "user", "synthetic_fixture"}:
        raise ValueError("Invalid provenance origin")
    _plain_text(value.get("title"), "title", 500)
    _plain_text(value.get("permission_note"), "permission_note", 4000)
    if value.get("external_rendering_authorized") is not True:
        raise ValueError("External rendering authorization must be asserted")
    if "source_url" in value:
        _safe_https_url(value["source_url"])
    if "template_id" in value:
        if not isinstance(value["template_id"], str) or not _TEMPLATE_ID.fullmatch(value["template_id"]):
            raise ValueError("Invalid provenance template_id")
    if origin == "biorender":
        if "source_url" not in value or "template_id" not in value:
            raise ValueError("BioRender provenance requires template identity")
        # Retain only the discovered public-detail shape, without URL normalization.
        expected = "https://app.biorender.com/biorender-templates/details/t-" + value["template_id"]
        if value["source_url"] not in {expected, expected + "?source=mcp"}:
            raise ValueError("BioRender provenance is not a matching public-template detail URL")
    elif "template_id" in value:
        raise ValueError("template_id is reserved for BioRender provenance")
    if origin == "nih_bioart" and not re.fullmatch(r'https://bioart\.niaid\.nih\.gov/bioart/[1-9][0-9]*', value.get('source_url', '')):
        raise ValueError("NIH BioArt provenance requires a canonical entry URL")
    try:
        encoded = canonical(value)
    except (TypeError, ValueError):
        raise ValueError("Provenance is not canonical JSON") from None
    if len(encoded) > _MANIFEST_LIMIT:
        raise ValueError("Provenance exceeds its size limit")
    return json.loads(encoded)


def _local_name(name: str) -> tuple[str, str | None]:
    if name.startswith("{"):
        namespace, local = name[1:].split("}", 1)
        return local, namespace
    return name, None


def _source_dimension(value: str | None) -> float:
    if value is None or not _DIMENSION.fullmatch(value.strip()):
        raise ValueError("SVG requires finite positive pixel dimensions")
    number = float(value[:-2] if value.endswith("px") else value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError("SVG requires finite positive pixel dimensions")
    return number


def _bounded_dimensions(width: float, height: float) -> tuple[int, int]:
    if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
        raise ValueError("Vector source has invalid dimensions")
    scale = min(1.0, _MAX_EDGE / width, _MAX_EDGE / height,
                math.sqrt(_MAX_PIXELS / (width * height)))
    output_width = max(1, int(math.floor(width * scale + 1e-9)))
    output_height = max(1, int(math.floor(height * scale + 1e-9)))
    if (output_width > _MAX_EDGE or output_height > _MAX_EDGE or
            output_width * output_height > _MAX_PIXELS):
        raise ValueError("Preview dimensions exceed limits")
    return output_width, output_height


def _validate_svg(data: bytes) -> tuple[float, float]:
    try:
        from defusedxml import ElementTree
        root = ElementTree.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception:
        # The broad parser boundary also normalizes malformed encodings and XML syntax.
        raise ValueError("Invalid or unsafe SVG") from None
    root_name, root_namespace = _local_name(root.tag)
    if root_name != "svg" or root_namespace not in {None, _SVG_NS}:
        raise ValueError("Source is not an SVG document")
    width = _source_dimension(root.attrib.get("width"))
    height = _source_dimension(root.attrib.get("height"))
    count = 0
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        count += 1
        if count > _MAX_SVG_NODES or depth > _MAX_SVG_DEPTH:
            raise ValueError("SVG complexity exceeds limits")
        local, namespace = _local_name(element.tag)
        if namespace not in {None, _SVG_NS} or local not in _SVG_ATTRIBUTES:
            raise ValueError("Unsupported SVG element")
        allowed = _SVG_ATTRIBUTES[local] | _PRESENTATION_ATTRIBUTES
        for raw_name, raw_value in element.attrib.items():
            attribute, attribute_namespace = _local_name(raw_name)
            if attribute_namespace == _XLINK_NS:
                attribute = "href"
            elif attribute_namespace == _XML_NS and attribute == "space" and local in {"text", "tspan"}:
                if raw_value not in {"default", "preserve"}:
                    raise ValueError("Unsupported SVG xml:space value")
                continue
            elif attribute_namespace is not None:
                raise ValueError("Unsupported SVG attribute namespace")
            if attribute.lower().startswith("on") or attribute not in allowed:
                raise ValueError("Unsupported SVG attribute")
            lowered = raw_value.casefold()
            if "url(" in lowered:
                without_local = _LOCAL_URL.sub("", raw_value)
                if "url(" in without_local.casefold():
                    raise ValueError("External SVG reference is forbidden")
            if any(marker in lowered for marker in ("data:", "file:", "http:", "https:", "//")):
                raise ValueError("External SVG reference is forbidden")
            if attribute == "href" and not re.fullmatch(r"#[A-Za-z_][A-Za-z0-9_.:-]*", raw_value):
                raise ValueError("External SVG reference is forbidden")
        stack.extend((child, depth + 1) for child in reversed(list(element)))
    return width, height


def _canonical_image(image: Image.Image, expected: tuple[int, int] | None = None) -> tuple[bytes, str, int, int]:
    reported_width, reported_height = image.size
    if (reported_width <= 0 or reported_height <= 0 or reported_width > _MAX_EDGE or
            reported_height > _MAX_EDGE or reported_width * reported_height > _MAX_PIXELS):
        raise ValueError("Generated preview has invalid dimensions")
    image.load()
    normalized = image.convert("RGBA")
    if expected is not None and normalized.size != expected:
        normalized = normalized.resize(expected, Image.Resampling.LANCZOS)
    width, height = normalized.size
    if (width <= 0 or height <= 0 or width > _MAX_EDGE or height > _MAX_EDGE or
            width * height > _MAX_PIXELS):
        raise ValueError("Generated preview has invalid dimensions")
    pixels = normalized.tobytes()
    output = BytesIO()
    normalized.save(output, format="PNG", optimize=False, compress_level=9)
    return output.getvalue(), _sha256(pixels), width, height


def _render_svg(data: bytes) -> tuple[str, bytes, str, int, int]:
    width, height = _validate_svg(data)
    target = _bounded_dimensions(width, height)
    try:
        import cairosvg
        rendered = cairosvg.svg2png(bytestring=data, output_width=target[0], output_height=target[1])
        with Image.open(BytesIO(rendered)) as image:
            preview, pixel_digest, actual_width, actual_height = _canonical_image(image, target)
    except ValueError:
        raise
    except Exception:
        raise ValueError("SVG conversion failed") from None
    return "vector", preview, pixel_digest, actual_width, actual_height


def _render_pdf(data: bytes) -> tuple[str, bytes, str, int, int]:
    try:
        import pypdfium2 as pdfium
        document = pdfium.PdfDocument(data)
        try:
            if pdfium.raw.FPDF_GetSecurityHandlerRevision(document.raw) != -1:
                raise ValueError("Encrypted PDF is forbidden")
            if len(document) != 1:
                raise ValueError("PDF must contain exactly one page")
            page = document[0]
            try:
                width, height = page.get_size()
                target = _bounded_dimensions(width, height)
                counts = {pdfium.raw.FPDF_PAGEOBJ_TEXT: 0, pdfium.raw.FPDF_PAGEOBJ_PATH: 0,
                          pdfium.raw.FPDF_PAGEOBJ_IMAGE: 0}
                object_count = 0
                for obj in page.get_objects(max_depth=_MAX_PDF_FORM_DEPTH + 1):
                    object_count += 1
                    if object_count > _MAX_SVG_NODES:
                        raise ValueError("PDF object count exceeds limit")
                    if obj.level >= _MAX_PDF_FORM_DEPTH:
                        raise ValueError("PDF form nesting exceeds the inspection limit")
                    if obj.type in counts:
                        counts[obj.type] += 1
                    elif obj.type not in {pdfium.raw.FPDF_PAGEOBJ_FORM,
                                          pdfium.raw.FPDF_PAGEOBJ_SHADING}:
                        raise ValueError("Unsupported PDF page object")
                vectors = counts[pdfium.raw.FPDF_PAGEOBJ_TEXT] + counts[pdfium.raw.FPDF_PAGEOBJ_PATH]
                if vectors == 0:
                    raise ValueError("Image-only PDF is forbidden")
                content_kind = "mixed_vector_image" if counts[pdfium.raw.FPDF_PAGEOBJ_IMAGE] else "vector"
                scale = min(target[0] / width, target[1] / height)
                bitmap = page.render(scale=scale)
                try:
                    rendered = bitmap.to_pil().copy()
                finally:
                    bitmap.close()
                preview, pixel_digest, actual_width, actual_height = _canonical_image(rendered, target)
            finally:
                page.close()
        finally:
            document.close()
    except ValueError:
        raise
    except Exception:
        raise ValueError("Invalid or unsupported PDF") from None
    return content_kind, preview, pixel_digest, actual_width, actual_height


def _converter(extension: str) -> dict:
    if extension == ".svg":
        return {"engine": "CairoSVG", "engine_version": version("CairoSVG"),
                "pillow_version": version("Pillow")}
    return {"engine": "pypdfium2", "engine_version": version("pypdfium2"),
            "pillow_version": version("Pillow")}


def _convert(extension: str, data: bytes) -> tuple[str, bytes, str, int, int]:
    if extension == ".svg":
        if data.lstrip().startswith(b"%PDF-"):
            raise ValueError("Source content does not match .svg suffix")
        return _render_svg(data)
    if extension == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("Source content does not match .pdf suffix")
        return _render_pdf(data)
    raise ValueError("Only SVG and PDF vector sources are supported")


def _exact_keys(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"Invalid {label} structure")
    return value


def _valid_hash(value: object) -> bool:
    return isinstance(value, str) and bool(_DIGEST.fullmatch(value))


def _regular_artifact(directory_fd: int, basename: str, limit: int) -> bytes:
    if basename not in {"source.svg", "source.pdf", "source.png"}:
        raise ValueError("Manifest artifact filename is not fixed")
    return _read_regular_at(directory_fd, basename, limit, "Asset artifact")


def import_vector(source: Path, project_dir: Path, provenance: dict, *, expected_sha256: str | None = None) -> Path:
    """Return immutable assets/<asset-id>/asset.json after source/proof validation."""
    source = Path(source)
    project_dir = _absolute_path(Path(project_dir))
    provenance = _validate_provenance(provenance)
    data = _read_regular(source, _SOURCE_LIMIT)
    if expected_sha256 is not None and (not _valid_hash(expected_sha256) or _sha256(data) != expected_sha256):
        raise ValueError("Source hash does not match verified import receipt")
    extension = source.suffix.lower()
    content_kind, preview, pixel_digest, width, height = _convert(extension, data)
    source_name = "source" + extension
    media_type = "image/svg+xml" if extension == ".svg" else "application/pdf"
    unsigned = {
        "format": "arc-vector-asset/1",
        "provenance": provenance,
        "source": {"file": source_name, "sha256": _sha256(data), "size": len(data),
                   "media_type": media_type, "content_kind": content_kind},
        "preview": {"file": "source.png", "sha256": _sha256(preview),
                    "pixel_sha256": pixel_digest, "width": width, "height": height},
        "converter": _converter(extension),
        "rights_verified": False,
        "scientific_validity_established": False,
    }
    asset_id = _sha256(canonical(unsigned))
    manifest = {"format": unsigned["format"], "asset_id": asset_id,
                **{key: value for key, value in unsigned.items() if key != "format"}}
    assets = project_dir / "assets"
    destination = assets / asset_id
    manifest_path = destination / "asset.json"
    project_fd = _open_directory(project_dir, create=True)
    try:
        try:
            os.mkdir("assets", mode=0o755, dir_fd=project_fd)
        except FileExistsError:
            pass
        assets_fd = os.open(
            "assets",
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=project_fd,
        )
    except OSError:
        raise ValueError("Asset root is not a regular directory") from None
    finally:
        os.close(project_fd)
    temporary_name = ".asset-" + secrets.token_hex(12)
    temporary_created = False
    try:
        try:
            existing = os.stat(asset_id, dir_fd=assets_fd, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            if not stat.S_ISDIR(existing.st_mode):
                raise ValueError("Asset destination is not a regular directory")
            validated = _verify_asset_at(assets_fd, asset_id)
            if validated != manifest:
                raise ValueError("Existing asset bundle does not match the import")
            return manifest_path
        os.mkdir(temporary_name, mode=0o700, dir_fd=assets_fd)
        temporary_created = True
        temporary_fd = os.open(
            temporary_name,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=assets_fd,
        )
        try:
            _write_regular_at(temporary_fd, source_name, data)
            _write_regular_at(temporary_fd, "source.png", preview)
            _write_regular_at(temporary_fd, "asset.json", canonical(manifest))
            os.fsync(temporary_fd)
        finally:
            os.close(temporary_fd)
        try:
            os.rename(temporary_name, asset_id, src_dir_fd=assets_fd, dst_dir_fd=assets_fd)
            temporary_created = False
        except OSError:
            try:
                concurrent = os.stat(asset_id, dir_fd=assets_fd, follow_symlinks=False)
            except FileNotFoundError:
                raise
            if not stat.S_ISDIR(concurrent.st_mode):
                raise ValueError("Concurrent asset destination is not a regular directory") from None
            validated = _verify_asset_at(assets_fd, asset_id)
            if validated != manifest:
                raise ValueError("Concurrent asset bundle does not match the import")
        return manifest_path
    finally:
        if temporary_created:
            _remove_temporary_at(assets_fd, temporary_name)
        os.close(assets_fd)


def _verify_asset_contents(directory_fd: int, directory_name: str) -> dict:
    try:
        raw_manifest = _read_regular_at(directory_fd, "asset.json", _MANIFEST_LIMIT,
                                        "Asset manifest")
        try:
            manifest = json.loads(raw_manifest)
        except (UnicodeDecodeError, ValueError, RecursionError):
            raise ValueError("Asset manifest is invalid JSON") from None
        _exact_keys(manifest, {"format", "asset_id", "provenance", "source", "preview",
                               "converter", "rights_verified", "scientific_validity_established"},
                    "asset manifest")
        if manifest["format"] != "arc-vector-asset/1":
            raise ValueError("Unsupported asset manifest format")
        if (not _valid_hash(manifest["asset_id"]) or manifest["asset_id"] != directory_name or
                manifest["rights_verified"] is not False or
                manifest["scientific_validity_established"] is not False):
            raise ValueError("Invalid asset identity or assertions")
        provenance = _validate_provenance(manifest["provenance"])
        if provenance != manifest["provenance"]:
            raise ValueError("Non-canonical provenance")
        source = _exact_keys(manifest["source"],
                             {"file", "sha256", "size", "media_type", "content_kind"}, "source")
        preview = _exact_keys(manifest["preview"],
                              {"file", "sha256", "pixel_sha256", "width", "height"}, "preview")
        converter = _exact_keys(manifest["converter"],
                                {"engine", "engine_version", "pillow_version"}, "converter")
        if source["file"] == "source.svg":
            extension, media_type = ".svg", "image/svg+xml"
        elif source["file"] == "source.pdf":
            extension, media_type = ".pdf", "application/pdf"
        else:
            raise ValueError("Invalid source filename")
        if (source["media_type"] != media_type or
                not isinstance(source["content_kind"], str) or
                source["content_kind"] not in {"vector", "mixed_vector_image"} or
                not _valid_hash(source["sha256"]) or type(source["size"]) is not int or
                not 0 < source["size"] <= _SOURCE_LIMIT or preview["file"] != "source.png" or
                not _valid_hash(preview["sha256"]) or not _valid_hash(preview["pixel_sha256"]) or
                type(preview["width"]) is not int or type(preview["height"]) is not int or
                not 1 <= preview["width"] <= _MAX_EDGE or not 1 <= preview["height"] <= _MAX_EDGE or
                preview["width"] * preview["height"] > _MAX_PIXELS or converter != _converter(extension)):
            raise ValueError("Invalid asset metadata")
        unsigned = dict(manifest)
        unsigned.pop("asset_id")
        if _sha256(canonical(unsigned)) != manifest["asset_id"]:
            raise ValueError("Asset manifest identity mismatch")
        source_data = _regular_artifact(directory_fd, source["file"], _SOURCE_LIMIT)
        if len(source_data) != source["size"] or _sha256(source_data) != source["sha256"]:
            raise ValueError("Asset source integrity mismatch")
        preview_data = _regular_artifact(directory_fd, "source.png", _SOURCE_LIMIT)
        if _sha256(preview_data) != preview["sha256"]:
            raise ValueError("Asset preview integrity mismatch")
        try:
            with Image.open(BytesIO(preview_data)) as image:
                if image.format != "PNG":
                    raise ValueError("Asset preview is not PNG")
                if image.size != (preview["width"], preview["height"]):
                    raise ValueError("Asset preview dimensions mismatch")
                _, stored_pixels, stored_width, stored_height = _canonical_image(image)
        except ValueError:
            raise
        except Exception:
            raise ValueError("Asset preview is invalid") from None
        if ((stored_width, stored_height) != (preview["width"], preview["height"]) or
                stored_pixels != preview["pixel_sha256"]):
            raise ValueError("Asset preview metadata mismatch")
        content_kind, _, regenerated_pixels, regenerated_width, regenerated_height = _convert(
            extension, source_data
        )
        if (content_kind != source["content_kind"] or regenerated_pixels != preview["pixel_sha256"] or
                (regenerated_width, regenerated_height) != (preview["width"], preview["height"])):
            raise ValueError("Asset preview does not reproduce from its source")
        return manifest
    finally:
        os.close(directory_fd)


def _verify_asset_at(assets_fd: int, asset_id: str) -> dict:
    try:
        directory_fd = os.open(
            asset_id,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=assets_fd,
        )
    except OSError:
        raise ValueError("Asset destination is not a regular directory") from None
    return _verify_asset_contents(directory_fd, asset_id)


def verify_asset(asset_json: Path) -> dict:
    """Return the validated asset manifest; raise ValueError on inconsistency."""
    asset_json = _absolute_path(Path(asset_json))
    directory = asset_json.parent
    if asset_json.name != "asset.json":
        raise ValueError("Asset manifest path is unsafe")
    directory_fd = _open_directory(directory)
    return _verify_asset_contents(directory_fd, directory.name)
