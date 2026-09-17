"""Crash-released ownership and recovery for the private BioArt cache."""
import os

import pytest

from arc_science.bioart.cache import Cache


def _hold_writer_lock(path):
    """Hold an exclusive non-blocking lock on the cache writer-lock, cross-platform."""
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    if os.name == 'posix':
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    else:
        import msvcrt
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    return fd


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


def test_live_owner_rejects_a_competing_writer(tmp_path):
    root = tmp_path / 'cache'
    root.mkdir()
    descriptor = _hold_writer_lock(root / '.writer-lock')
    try:
        with pytest.raises(ValueError):
            Cache(root, 1024).write({'value': b'blocked'})
    finally:
        os.close(descriptor)


def test_immutable_entries_and_budget_are_enforced(tmp_path):
    root = tmp_path / 'cache'
    root.mkdir()
    cache = Cache(root, 32)
    cache.write({'a': b'one'})
    cache.write({'a': b'one', 'b': b'two'})          # re-writing identical bytes is fine
    assert cache.read('a', 32) == b'one'
    assert cache.read('b', 32) == b'two'
    with pytest.raises(ValueError):                  # same name, different bytes -> immutable collision
        cache.write({'a': b'DIFFERENT'})
    with pytest.raises(ValueError):                  # exceeds the byte budget
        cache.write({'big': b'x' * 64})
    assert cache.read('missing', 32) is None
