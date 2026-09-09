"""Crash-released ownership and recovery for the private BioArt cache."""
import fcntl
import os

import pytest

from arc_science.bioart.cache import Cache


pytestmark = pytest.mark.skipif(os.name != 'posix', reason='BioArt cache is POSIX-only')


def test_stale_lock_file_and_private_temporary_do_not_wedge_the_cache(tmp_path):
    root = tmp_path / 'cache'
    root.mkdir()
    (root / '.writer-lock').write_bytes(b'previous process')
    orphan = root / ('.write-' + 'a' * 32)
    orphan.write_bytes(b'interrupted temporary')

    cache = Cache(root, 1024)
    cache.write({'value': b'complete'})

    assert cache.read('value', 1024) == b'complete'
    assert not orphan.exists()


def test_live_advisory_owner_rejects_a_competing_writer(tmp_path):
    root = tmp_path / 'cache'
    root.mkdir()
    descriptor = os.open(root / '.writer-lock', os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match='another writer is active'):
            Cache(root, 1024).write({'value': b'blocked'})
    finally:
        os.close(descriptor)
