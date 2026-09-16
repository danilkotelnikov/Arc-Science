"""Native session memory for Arc Science.

A project-local, provenance-preserving store of the harness's own session history,
served by the native `arc-memory` worker. Retrieved content is untrusted data, never
instructions, and this layer grants it no authority over tools, permissions or
acceptance.
"""
from __future__ import annotations

from .client import MemoryClient, MemoryError

__all__ = ["MemoryClient", "MemoryError"]
