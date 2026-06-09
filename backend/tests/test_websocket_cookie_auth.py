"""WebSocket authentication via the HttpOnly session cookie."""

from __future__ import annotations

from app import auth as auth_module
from app import config as config_module
from app.auth import SESSION_COOKIE_NAME
from app.websocket import _authenticate_websocket

TEST_JWT_SECRET = "ws-cookie-test-secret-32-bytes-min"


class _StubWebSocket:
    """Bare-minimum handshake surface for _authenticate_websocket."""

    def __init__(self, query_params=None, cookies=None):
        self.query_params = query_params or {}
        self.cookies = cookies or {}
        self.accepted = False
        # Anything not CONNECTING skips the accept-and-wait branch guards.
        self.application_state = object()

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        raise AssertionError("cookie-authenticated handshake must not wait for a frame")


def _issue_token(role: str = "admin") -> str:
    config_module.config.auth.jwt_secret = TEST_JWT_SECRET
    config_module.config.auth.token_version = 1
    return auth_module.create_token({"username": "admin", "role": role})


async def test_session_cookie_authenticates_handshake():
    token = _issue_token()
    ws = _StubWebSocket(cookies={SESSION_COOKIE_NAME: token})

    auth = await _authenticate_websocket(ws)

    assert auth is not None
    user, used_token = auth
    assert user == {"username": "admin", "role": "admin"}
    assert used_token == token
    assert ws.accepted is False  # authenticated before accept


async def test_query_param_token_takes_precedence_over_cookie():
    good = _issue_token()
    ws = _StubWebSocket(
        query_params={"token": "garbage"},
        cookies={SESSION_COOKIE_NAME: good},
    )

    # Explicit bad credential fails closed; the cookie must not rescue it.
    assert await _authenticate_websocket(ws) is None


async def test_invalid_cookie_fails_closed():
    _issue_token()
    ws = _StubWebSocket(cookies={SESSION_COOKIE_NAME: "garbage"})

    assert await _authenticate_websocket(ws) is None
