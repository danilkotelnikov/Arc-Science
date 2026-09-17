"""Exact-image contracts for reference-aware scientific figure review."""
import asyncio
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import struct
import time
import zlib

import httpx
from PIL import Image
import pytest


def _png(path: Path, color: tuple[int, int, int, int]) -> Path:
    image = BytesIO()
    Image.new("RGBA", (2, 2), color).save(image, format="PNG")
    path.write_bytes(image.getvalue())
    return path


def _invalid_deflate_with_valid_png_crc(data: bytes) -> bytes:
    output = bytearray(data[:8])
    offset = 8
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        if kind == b"IDAT":
            payload = b"\x00" * length
        output.extend(struct.pack(">I", len(payload)))
        output.extend(kind)
        output.extend(payload)
        output.extend(struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))
        offset += 12 + length
    return bytes(output)


def _invalid_idat_crc(data: bytes) -> bytes:
    changed = bytearray(data)
    offset = 8
    while offset < len(changed):
        length = struct.unpack(">I", changed[offset:offset + 4])[0]
        if changed[offset + 4:offset + 8] == b"IDAT":
            changed[offset + 8 + length] ^= 1
            return bytes(changed)
        offset += 12 + length
    raise AssertionError("PNG fixture has no IDAT chunk")


@pytest.fixture
def review_case(tmp_path):
    from arc_science.figure_review import build_review_packet

    candidate = _png(tmp_path / "candidate.png", (36, 91, 138, 255))
    reference = _png(tmp_path / "reference.png", (255, 255, 255, 255))
    packet = build_review_packet([candidate], [reference], candidate_id="candidate-03")
    candidate_hash = hashlib.sha256(candidate.read_bytes()).hexdigest()
    reference_hash = hashlib.sha256(reference.read_bytes()).hexdigest()
    reply = {
        "candidate_digest": packet["candidate_digest"],
        "reviewed_images": [
            {"role": "candidate", "digest": candidate_hash},
            {"role": "reference", "digest": reference_hash},
        ],
        "verdict": "passed",
        "findings": [],
        "summary": "The candidate is visually clear within the bounded appearance-only rubric.",
    }
    return packet, reply, candidate_hash, reference_hash


def test_packet_binds_independently_hashed_png_bytes_and_roles(review_case):
    from arc_science.figure_review import validate_visual_reply

    packet, reply, candidate_hash, reference_hash = review_case
    assert [(item["role"], item["digest"]) for item in packet["images"]] == [
        ("candidate", candidate_hash), ("reference", reference_hash)]
    assert [hashlib.sha256(base64.b64decode(item["data_base64"])).hexdigest()
            for item in packet["images"]] == [candidate_hash, reference_hash]
    assert {item["id"] for item in packet["rubric"]} == {
        "white_canvas", "semantic_color", "molecular_cropping", "occlusion",
        "legibility", "truthful_plot_axes", "reference_differences",
    }
    assert validate_visual_reply(packet, reply) == reply


def test_packet_rejects_crc_valid_png_with_undecodable_pixels(tmp_path):
    from arc_science.figure_review import build_review_packet

    candidate = _png(tmp_path / "candidate.png", (36, 91, 138, 255))
    candidate.write_bytes(_invalid_deflate_with_valid_png_crc(candidate.read_bytes()))
    with Image.open(candidate) as image:
        image.verify()  # CRC/structure alone accepts this fixture.
    reference = _png(tmp_path / "reference.png", (255, 255, 255, 255))
    with pytest.raises(ValueError, match="valid PNG"):
        build_review_packet([candidate], [reference], candidate_id="candidate-03")


def test_packet_rejects_decodable_png_with_corrupt_idat_checksum(tmp_path):
    from arc_science.figure_review import build_review_packet

    candidate = _png(tmp_path / "candidate.png", (36, 91, 138, 255))
    candidate.write_bytes(_invalid_idat_crc(candidate.read_bytes()))
    with Image.open(candidate) as image:
        image.load()  # Pixel decoding alone accepts this fixture.
    reference = _png(tmp_path / "reference.png", (255, 255, 255, 255))
    with pytest.raises(ValueError, match="valid PNG"):
        build_review_packet([candidate], [reference], candidate_id="candidate-03")


def test_packet_rejects_oversize_or_nonregular_png_before_reading(tmp_path):
    import arc_science.figure_review as review

    reference = _png(tmp_path / "reference.png", (255, 255, 255, 255))
    oversized = tmp_path / "oversized.png"
    with oversized.open("wb") as handle:
        handle.truncate(review.MAX_IMAGE_BYTES + 1)
    with pytest.raises(ValueError, match="bounded regular"):
        review.build_review_packet([oversized], [reference], candidate_id="candidate-03")
    if hasattr(os, "mkfifo"):  # FIFO substitution is POSIX-only; anchored rejects non-regular on Windows too
        fifo = tmp_path / "image-fifo"
        os.mkfifo(fifo)
        with pytest.raises(ValueError, match="bounded regular"):
            review.build_review_packet([fifo], [reference], candidate_id="candidate-03")


@pytest.mark.parametrize("mutation", ["swapped", "missing", "duplicate"])
def test_reply_rejects_wrong_or_incomplete_role_coverage(review_case, mutation):
    from arc_science.figure_review import validate_visual_reply

    packet, reply, candidate_hash, reference_hash = review_case
    changed = json.loads(json.dumps(reply))
    if mutation == "swapped":
        changed["reviewed_images"] = [
            {"role": "reference", "digest": candidate_hash},
            {"role": "candidate", "digest": reference_hash},
        ]
    elif mutation == "missing":
        changed["reviewed_images"] = changed["reviewed_images"][:1]
    else:
        changed["reviewed_images"] = [changed["reviewed_images"][0]] * 2
    with pytest.raises(ValueError, match="coverage"):
        validate_visual_reply(packet, changed)


def test_reply_rejects_stale_candidate_digest(review_case):
    from arc_science.figure_review import validate_visual_reply

    packet, reply, _, _ = review_case
    with pytest.raises(ValueError, match="candidate"):
        validate_visual_reply(packet, {**reply, "candidate_digest": "0" * 64})


def test_reply_rejects_pass_with_blocking_finding(review_case):
    from arc_science.figure_review import validate_visual_reply

    packet, reply, candidate_hash, _ = review_case
    changed = {**reply, "findings": [{
        "image_digest": candidate_hash,
        "severity": "blocking",
        "category": "occlusion",
        "detail": "The interface is hidden by the overview geometry.",
    }]}
    with pytest.raises(ValueError, match="blocking"):
        validate_visual_reply(packet, changed)


@pytest.mark.parametrize("verdict", ["pass", "adequate", "", True])
def test_reply_rejects_malformed_verdict(review_case, verdict):
    from arc_science.figure_review import validate_visual_reply

    packet, reply, _, _ = review_case
    with pytest.raises(ValueError, match="reply"):
        validate_visual_reply(packet, {**reply, "verdict": verdict})


def test_packet_export_cli_is_offline_and_contains_no_source_paths(tmp_path, capsys, monkeypatch):
    from arc_science.cli import main

    monkeypatch.delenv("ARC_VISION_MODEL", raising=False)
    candidate = _png(tmp_path / "candidate.png", (0, 0, 255, 255))
    reference = _png(tmp_path / "reference.png", (255, 255, 255, 255))
    output = tmp_path / "packet.json"
    assert main(["figure-review-packet", "--candidate", str(candidate),
                 "--reference", str(reference), "--candidate-id", "frozen-03",
                 "--output", str(output)]) == 0
    result = json.loads(capsys.readouterr().out)
    packet = json.loads(output.read_text())
    assert result["candidate_digest"] == packet["candidate_digest"]
    assert str(tmp_path) not in output.read_text()


def test_live_review_uses_native_images_and_bound_grant(review_case):
    from arc_science.exploration.providers import ModelEndpoint
    from arc_science.figure_review import request_visual_review
    from arc_science.transport import AccessGrant

    packet, reply, _, _ = review_case
    seen = {}

    def handler(request):
        seen["authorization"] = request.headers.get("Authorization")
        body = json.loads(request.content)
        seen["body"] = body
        return httpx.Response(200, json={
            "model": "vision-model", "status": "completed",
            "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json.dumps(reply)}]}],
        })

    config = ModelEndpoint(provider="openai", endpoint="https://vision.example/v1/responses",
                           model="vision-model", credential_ref="vision")
    grant = AccessGrant(token="secret", principal="operator", project_id="frozen-03",
                        resource=config.endpoint, credential_ref="vision",
                        expires_at=int(time.time()) + 60)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False) as client:
            return await request_visual_review(packet, config=config, client=client,
                resolver=lambda *_: grant, project="frozen-03", principal="operator",
                allow_egress=True)

    result = asyncio.run(run())
    parts = seen["body"]["input"][0]["content"]
    images = [part for part in parts if part["type"] == "input_image"]
    prompt = next(part["text"] for part in parts if part["type"] == "input_text")
    assert len(images) == 2 and all(item["image_url"].startswith("data:image/png;base64,") for item in images)
    assert "data_base64" not in prompt
    assert seen["authorization"] == "Bearer secret"
    assert result["provider_executed"] is True
    assert result["reply"] == reply


def test_live_review_requires_explicit_egress_before_transport(review_case):
    from arc_science.exploration.providers import ModelEndpoint
    from arc_science.figure_review import request_visual_review

    packet, _, _, _ = review_case
    config = ModelEndpoint(provider="openai", endpoint="https://vision.example/v1/responses",
                           model="vision-model", credential_ref="vision")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda _: pytest.fail("transport must not run")), trust_env=False) as client:
            await request_visual_review(packet, config=config, client=client,
                resolver=lambda *_: pytest.fail("grant must not resolve"),
                project="frozen-03", principal="operator", allow_egress=False)

    with pytest.raises(ValueError, match="egress"):
        asyncio.run(run())


def test_live_review_cli_without_config_writes_no_reply(review_case, tmp_path, capsys, monkeypatch):
    from arc_science.cli import main

    packet, _, _, _ = review_case
    source = tmp_path / "packet.json"
    source.write_text(json.dumps(packet))
    output = tmp_path / "reply.json"
    for name in ("ARC_MODEL", "ARC_PROVIDER_URL", "ARC_VISION_MODEL", "ARC_VISION_URL",
                 "ARC_MODEL_TOKEN_FILE", "ARC_REVIEWER_TOKEN_FILE", "ARC_VISION_TOKEN_FILE"):
        monkeypatch.delenv(name, raising=False)
    assert main(["figure-review", str(source), "--allow-egress", "--output", str(output)]) == 1
    assert "Configure ARC_VISION_MODEL" in capsys.readouterr().err
    assert not output.exists()


def test_live_review_cli_uses_complete_vision_config_without_planner(review_case, tmp_path, capsys, monkeypatch):
    from arc_science.cli import main

    packet, reply, _, _ = review_case
    source = tmp_path / "packet.json"
    source.write_text(json.dumps(packet))
    output = tmp_path / "reply.json"
    token = tmp_path / "vision.token"
    token.write_text("vision-secret\n")
    for name in ("ARC_MODEL", "ARC_PROVIDER_URL", "ARC_REVIEWER_MODEL", "ARC_REVIEWER_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ARC_VISION_PROVIDER", "openai")
    monkeypatch.setenv("ARC_VISION_MODEL", "vision-model")
    monkeypatch.setenv("ARC_VISION_URL", "https://vision.example/v1/responses")
    monkeypatch.setenv("ARC_VISION_TOKEN_FILE", str(token))
    real_client = httpx.AsyncClient

    def handler(request):
        assert request.headers["Authorization"] == "Bearer vision-secret"
        return httpx.Response(200, json={
            "model": "vision-model", "status": "completed",
            "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json.dumps(reply)}]}],
        })

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), trust_env=False))
    assert main(["figure-review", str(source), "--allow-egress", "--output", str(output)]) == 0
    result = json.loads(output.read_text())
    assert result["provider_executed"] is True and result["model"] == "vision-model"
    assert json.loads(capsys.readouterr().out)["candidate_digest"] == packet["candidate_digest"]


def test_live_review_cli_rejects_oversize_packet_before_json_decode(tmp_path, capsys):
    from arc_science.cli import main
    from arc_science.figure_review import MAX_PACKET_BYTES

    source = tmp_path / "packet.json"
    with source.open("wb") as handle:
        handle.truncate(MAX_PACKET_BYTES + 1)
    output = tmp_path / "reply.json"
    assert main(["figure-review", str(source), "--allow-egress", "--output", str(output)]) == 1
    assert "bounded regular" in capsys.readouterr().err
    assert not output.exists()


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="FIFO substitution is POSIX-only")
def test_packet_reader_rejects_fifo_without_blocking(tmp_path):
    from arc_science.figure_review import read_review_packet

    fifo = tmp_path / "packet-fifo"
    os.mkfifo(fifo)
    with pytest.raises(ValueError, match="bounded regular"):
        read_review_packet(fifo)
