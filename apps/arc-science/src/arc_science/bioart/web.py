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


def _cli_environment():
    """Pass only locale and BioArt-specific configuration to the helper."""
    permitted = {'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'}
    return {key: value for key, value in os.environ.items()
            if key in permitted or key.startswith('ARC_BIOART_')}


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
    package_root = Path(__file__).resolve().parents[2]
    bootstrap = ('import sys; root=sys.argv.pop(1); sys.path.insert(0,root); '
                 'from arc_science.cli import main; raise SystemExit(main())')
    command = (sys.executable, '-I', '-c', bootstrap, str(package_root), 'bioart',
               arguments[0], '--project', str(project), *arguments[1:])
    try:
        with tempfile.TemporaryFile(mode='w+b') as errors:
            process = await asyncio.create_subprocess_exec(
                *command, cwd=package_root, env=_cli_environment(),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errors,
                close_fds=True, start_new_session=True)
            try:
                await asyncio.wait_for(process.wait(), timeout)
            except asyncio.TimeoutError:
                await _stop_cli_uninterruptibly(process)
                raise ValueError('BioArt web helper total timeout') from None
            except asyncio.CancelledError as cancellation:
                await _stop_cli_uninterruptibly(process)
                raise cancellation
            status = process.returncode
            await _stop_cli_uninterruptibly(process)
            if status:
                errors.seek(0, os.SEEK_END)
                size = errors.tell()
                errors.seek(max(0, size - 4096))
                lines = errors.read(4096).decode('utf-8', errors='replace').splitlines()
                last = lines[-1].strip() if lines else ''
                if (last.startswith('ValueError: ') and len(last) <= 2000 and
                        str(project) not in last):
                    raise ValueError('BioArt CLI failed: ' + last.removeprefix('ValueError: '))
                raise ValueError('BioArt CLI failed without a safe provider error')
    except OSError:
        raise ValueError('BioArt CLI could not start or complete') from None


def create_router(project: Path, authorized):
    root = Path(project).absolute()
    router = APIRouter(prefix='/api/bioart', dependencies=[Depends(authorized)])
    population = None

    def client(allow_egress=False):
        settings = BioArtSettings.from_environment(root)
        return BioArtClient(settings.cache_dir, allow_egress=allow_egress,
                            limits=settings.limits)

    async def call(operation):
        try:
            return await asyncio.to_thread(operation)
        except ValueError as error:
            raise _problem(error) from None

    async def populate(arguments, operation):
        # The cache may have changed after the request's first read. Recheck in
        # the shared operation before starting any network process.
        try:
            return await asyncio.to_thread(lambda: operation(client(False)))
        except BioArtCacheMiss:
            pass
        settings = BioArtSettings.from_environment(root)
        multiplier = 2 if arguments[0] == 'fetch' else 1
        timeout = settings.limits.timeout_seconds * multiplier + 5
        await _run_bioart_cli(root, arguments, timeout)
        return await asyncio.to_thread(lambda: operation(client(False)))

    async def populate_once(arguments, operation):
        """Join an identical live request; reject unrelated work without queuing."""
        nonlocal population
        record = population
        if record is not None and record['task'].done():
            record = None
        if record is None:
            task = asyncio.create_task(populate(arguments, operation))
            record = {'key': arguments, 'task': task, 'waiters': 0}
            population = record

            def finished(done):
                nonlocal population
                if population is record:
                    population = None
                try:
                    done.exception()
                except asyncio.CancelledError:
                    pass

            task.add_done_callback(finished)
        elif record['task'].cancelling():
            raise ValueError('BioArt live cache population is stopping; retry')
        elif record['key'] != arguments:
            raise ValueError(
                'BioArt live cache population is active for another request; retry')

        task = record['task']
        record['waiters'] += 1
        try:
            return await asyncio.shield(task)
        finally:
            record['waiters'] -= 1
            if record['waiters'] == 0 and not task.done():
                task.cancel()
                cancellation = None
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError as error:
                        cancellation = error
                    except Exception:
                        break
                try:
                    task.result()
                except (asyncio.CancelledError, Exception):
                    pass
                if cancellation is not None:
                    raise cancellation

    async def cache_first(allow_egress, arguments, operation):
        try:
            return await asyncio.to_thread(lambda: operation(client(False)))
        except BioArtCacheMiss as error:
            if not allow_egress:
                raise _problem(error) from None
        except ValueError as error:
            raise _problem(error) from None
        try:
            return await populate_once(arguments, operation)
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
        def operation():
            provider = client(False)
            manifest = provider.import_asset(_receipt_path(provider, request.receipt_id), root)
            try:
                relative = manifest.absolute().relative_to(root)
            except ValueError:
                raise ValueError('Imported BioArt manifest escaped the project') from None
            return {'asset_id': manifest.parent.name,
                    'asset_manifest': relative.as_posix()}

        return await call(operation)

    return router
