"""AccessGrant auth styles, including OAuth bearer for Claude model seats."""
from __future__ import annotations

import time

import pytest

from arc_science.transport import AccessGrant, AuthorizationError


def _grant(style: str) -> AccessGrant:
    return AccessGrant(
        token="tok",
        principal="local-operator",
        project_id="proj",
        resource="https://api.anthropic.com/v1/messages",
        credential_ref="planner",
        expires_at=int(time.time()) + 60,
        auth_style=style,
    )


def _headers(style: str) -> dict:
    return _grant(style).require(
        principal="local-operator",
        project_id="proj",
        resource="https://api.anthropic.com/v1/messages",
        credential_ref="planner",
        now=int(time.time()),
    )


def test_oauth_style_sets_bearer_authorization():
    assert _headers("oauth") == {"Authorization": "Bearer tok"}


def test_api_key_and_bearer_styles_unchanged():
    assert _headers("x-api-key") == {"x-api-key": "tok"}
    assert _headers("bearer") == {"Authorization": "Bearer tok"}


def test_unknown_style_is_rejected():
    with pytest.raises(AuthorizationError):
        _headers("basic")
