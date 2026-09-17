"""Anchored directory ops behave the same on POSIX (openat) and Windows (paths)."""
import os

import pytest

from arc_science import anchored


def _symlinks_work(tmp_path):
    try:
        (tmp_path/'l').symlink_to(tmp_path/'t'); (tmp_path/'l').unlink(); return True
    except (OSError, NotImplementedError):
        return False


def test_write_read_rename_and_listdir_round_trip(tmp_path):
    root = anchored.open_directory(tmp_path/'store', create=True)
    try:
        sub = anchored.child_directory(root, 'bundle', create=True)
        try:
            fd = anchored.open_write_new_fd(sub, 'data.bin')
            try: os.write(fd, b'payload\r\n\x1aX')
            finally: os.close(fd)
            fd = anchored.open_read_fd(sub, 'data.bin')
            try: assert os.read(fd, 1024) == b'payload\r\n\x1aX'   # exact bytes, no text translation
            finally: os.close(fd)
            anchored.rename(sub, 'data.bin', 'final.bin')
            assert anchored.listdir(sub) == ['final.bin']
            assert anchored.lstat(sub, 'final.bin').st_size == 11
            anchored.unlink(sub, 'final.bin')
            with pytest.raises(FileNotFoundError):
                anchored.lstat(sub, 'final.bin')
        finally:
            anchored.close_directory(sub)
        anchored.rmdir(root, 'bundle')
    finally:
        anchored.close_directory(root)


def test_exclusive_create_refuses_existing(tmp_path):
    root = anchored.open_directory(tmp_path, create=True)
    try:
        fd = anchored.open_write_new_fd(root, 'once'); os.close(fd)
        with pytest.raises(FileExistsError):
            anchored.open_write_new_fd(root, 'once')
    finally:
        anchored.close_directory(root)


@pytest.mark.parametrize('name', ['../escape', 'a/b', '', '.', '..'])
def test_unsafe_child_names_are_rejected(tmp_path, name):
    root = anchored.open_directory(tmp_path, create=True)
    try:
        with pytest.raises(ValueError):
            anchored.lstat(root, name)
    finally:
        anchored.close_directory(root)


def test_symlink_component_is_rejected(tmp_path):
    if not _symlinks_work(tmp_path):
        pytest.skip('symlink creation not permitted on this platform/account')
    outside = tmp_path/'outside'; outside.mkdir()
    (tmp_path/'via').symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        anchored.open_directory(tmp_path/'via'/'inner', create=False)
