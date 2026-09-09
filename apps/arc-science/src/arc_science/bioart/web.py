"""Authenticated, cache-first BioArt workflow for the local Arc web app."""
from __future__ import annotations

import asyncio
from dataclasses import asdict
import hashlib
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator

from .client import BioArtCacheMiss, BioArtClient
from .models import BioArtSettings, ORIGIN


BioArtId = Annotated[StrictInt, Field(gt=0, lt=2**53)]
ReceiptId = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


class _Request(BaseModel):
    model_config = ConfigDict(extra='forbid')


class SearchRequest(_Request):
    query: str = Field(min_length=1, max_length=200)
    allow_egress: StrictBool = False

    @field_validator('query')
    @classmethod
    def clean_query(cls, value):
        if not value.strip() or any(ord(character) < 32 for character in value):
            raise ValueError('Invalid BioArt search query')
        return value.strip()


class InspectRequest(_Request):
    entry_id: BioArtId
    allow_egress: StrictBool = False


class FetchRequest(InspectRequest):
    representation_id: BioArtId | None = None
    format: Literal['SVG', 'PNG', 'AI', 'EPS'] = 'SVG'


class ImportRequest(_Request):
    receipt_id: ReceiptId


def _problem(error: ValueError):
    detail = str(error)
    lowered = detail.lower()
    status = 504 if 'timeout' in lowered else 409
    return HTTPException(status, detail)


def _receipt_path(client: BioArtClient, receipt_id: str):
    if not re.fullmatch(r'[0-9a-f]{64}', receipt_id):
        raise ValueError('Invalid BioArt receipt identity')
    return client.cache.root / f'{receipt_id}.receipt.json'


async def _stop_cli(process):
    if process.returncode is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        await asyncio.wait_for(process.wait(), 1)
    except asyncio.TimeoutError:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
    finally:
        # A failed CLI must not leave its owned network worker behind even if the
        # CLI leader exited before its own cleanup completed.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


async def _stop_cli_uninterruptibly(process):
    cleanup = asyncio.create_task(_stop_cli(process))
    cancellation = None
    while not cleanup.done():
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError as error:
            cancellation = error
    cleanup.result()
    if cancellation is not None:
        raise cancellation


async def _run_bioart_cli(project: Path, arguments: tuple[str, ...], timeout: int):
    """Populate the cache through the existing main-thread, killable CLI path."""
    if os.name != 'posix':
        raise ValueError('BioArt web egress requires the qualified POSIX CLI provider')
    if not arguments:
        raise ValueError('Invalid BioArt CLI request')
    command = (sys.executable, '-m', 'arc_science', 'bioart', arguments[0],
               '--project', str(project), *arguments[1:])
    environment = os.environ.copy()
    # Run the same package tree as the service even when a developer starts it
    # from a source checkout and the project directory is elsewhere.
    environment['PYTHONPATH'] = str(Path(__file__).resolve().parents[2])
    with tempfile.TemporaryFile(mode='w+b') as errors:
        process = await asyncio.create_subprocess_exec(
            *command, cwd=project, env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=errors, close_fds=True,
            start_new_session=True)
        try:
            await asyncio.wait_for(process.wait(), timeout)
        except asyncio.TimeoutError:
            await _stop_cli_uninterruptibly(process)
            raise ValueError('BioArt web helper total timeout') from None
        except asyncio.CancelledError as cancellation:
            await _stop_cli_uninterruptibly(process)
            raise cancellation
        if process.returncode:
            errors.seek(0, os.SEEK_END)
            size = errors.tell()
            errors.seek(max(0, size - 4096))
            detail = errors.read(4096).decode('utf-8', errors='replace').strip()
            if size > 4096:
                detail = '[truncated] ' + detail
            raise ValueError('BioArt CLI failed' + (': ' + detail if detail else ''))


def create_router(project: Path, authorized):
    root = Path(project).absolute()
    router = APIRouter(prefix='/api/bioart', dependencies=[Depends(authorized)])

    def client(allow_egress=False):
        settings = BioArtSettings.from_environment(root)
        return BioArtClient(settings.cache_dir, allow_egress=allow_egress,
                            limits=settings.limits)

    async def call(operation):
        try:
            return await asyncio.to_thread(operation)
        except ValueError as error:
            raise _problem(error) from None

    async def cache_first(allow_egress, arguments, operation):
        try:
            return await asyncio.to_thread(lambda: operation(client(False)))
        except BioArtCacheMiss as error:
            if not allow_egress:
                raise _problem(error) from None
        except ValueError as error:
            raise _problem(error) from None
        try:
            timeout = BioArtSettings.from_environment(root).limits.timeout_seconds * 2 + 5
            await _run_bioart_cli(root, arguments, timeout)
            return await asyncio.to_thread(lambda: operation(client(False)))
        except ValueError as error:
            raise _problem(error) from None

    @router.post('/search')
    async def search(request: SearchRequest):
        hits = await cache_first(
            request.allow_egress,
            ('search', '--allow-egress', '--', request.query),
            lambda provider: provider.search(request.query))
        return {'hits': [asdict(hit) for hit in hits]}

    @router.post('/inspect')
    async def inspect(request: InspectRequest):
        entry = await cache_first(
            request.allow_egress,
            ('inspect', '--allow-egress', str(request.entry_id)),
            lambda provider: provider.inspect(request.entry_id))
        return {**asdict(entry),
                'preferred_representation_id': entry.preferred_representation_id,
                'source_url': f'{ORIGIN}/bioart/{entry.entry_id}'}

    @router.post('/fetch')
    async def fetch(request: FetchRequest):
        def operation(provider):
            receipt = provider.fetch(request.entry_id, request.representation_id,
                                     request.format)
            value = provider.verify(receipt.receipt_path)
            receipt_id = receipt.receipt_path.name[:64]
            safe = {key: item for key, item in value.items() if key != 'source_file'}
            return {**safe, 'receipt_id': receipt_id,
                    'preview_url': f'/api/bioart/receipts/{receipt_id}/preview',
                    'download_url': f'/api/bioart/receipts/{receipt_id}/source'}

        arguments = ['fetch', '--allow-egress', '--format', request.format]
        if request.representation_id is not None:
            arguments.extend(('--representation', str(request.representation_id)))
        arguments.append(str(request.entry_id))
        return await cache_first(request.allow_egress, tuple(arguments), operation)

    def verified_source(receipt_id):
        provider = client(False)
        receipt = _receipt_path(provider, receipt_id)
        value = provider.verify(receipt)
        data = provider.cache.read(value['source_file'], provider.limits.max_file_bytes)
        if (data is None or len(data) != value['size'] or
                hashlib.sha256(data).hexdigest() != value['sha256']):
            raise ValueError('Source size/hash mismatch')
        return data, value

    @router.get('/receipts/{receipt_id}/preview')
    async def preview(receipt_id: str):
        def operation():
            data, value = verified_source(receipt_id)
            if not value['preview_eligible']:
                raise ValueError('Verified BioArt source is not eligible for browser preview')
            media_type = {'SVG': 'image/svg+xml', 'PNG': 'image/png'}.get(value['format'])
            if media_type is None:
                raise ValueError('Verified BioArt source is not eligible for browser preview')
            return data, value, media_type

        data, value, media_type = await call(operation)
        return Response(data, media_type=media_type, headers={
            'ETag': f'"{value["sha256"]}"',
            'Content-Disposition': f'inline; filename="bioart-{value["entry_id"]}.{value["format"].lower()}"',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'same-origin',
        })

    @router.get('/receipts/{receipt_id}/source')
    async def source(receipt_id: str):
        data, value = await call(lambda: verified_source(receipt_id))
        media_type = {'SVG': 'image/svg+xml', 'PNG': 'image/png',
                      'EPS': 'application/postscript'}.get(value['format'],
                                                           'application/octet-stream')
        return Response(data, media_type=media_type, headers={
            'ETag': f'"{value["sha256"]}"',
            'Content-Disposition': f'attachment; filename="bioart-{value["entry_id"]}.{value["format"].lower()}"',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'same-origin',
        })

    @router.post('/import')
    async def import_asset(request: ImportRequest):
        provider = client(False)

        def operation():
            manifest = provider.import_asset(_receipt_path(provider, request.receipt_id), root)
            try:
                relative = manifest.absolute().relative_to(root)
            except ValueError:
                raise ValueError('Imported BioArt manifest escaped the project') from None
            return {'asset_id': manifest.parent.name,
                    'asset_manifest': relative.as_posix()}

        return await call(operation)

    return router
