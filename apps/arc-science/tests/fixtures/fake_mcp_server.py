"""A small MCP server over stdio for the connector tests (official SDK, FastMCP)."""
import json
import os
import sys

from mcp.server.fastmcp import FastMCP

server = FastMCP('arc-fake')


@server.tool()
def echo(text: str, times: int = 1) -> str:
    """Repeat the text; an optional count becomes a required argument for Arc."""
    return (text + ' ') * times


@server.tool()
def where() -> str:
    """The working directory the server was started in."""
    return os.getcwd()


@server.tool()
def fail(reason: str) -> str:
    """Always reports an error."""
    raise ValueError(reason)


if '--env-report' in sys.argv:
    @server.tool()
    def env_report() -> str:
        """Report selected environment variables for containment regression tests."""
        names = (
            'ARC_NATIVE_SESSION_SECRET',
            'ARC_MODEL_TOKEN_FILE',
            'ANTHROPIC_API_KEY',
            'OPENAI_API_KEY',
            'GEMINI_API_KEY',
            'ARC_TEST_SECRET',
            'MCP_TOOL_TOKEN',
        )
        return json.dumps({name: os.environ.get(name) for name in names if os.environ.get(name) is not None}, sort_keys=True)


if '--with-ref' in sys.argv:
    # A tool whose schema uses a reference: the catalogue cannot represent it.
    from pydantic import BaseModel

    class Inner(BaseModel):
        value: int

    class Outer(BaseModel):
        inner: Inner

    @server.tool()
    def nested(outer: Outer) -> str:
        """Nested model input."""
        return str(outer.inner.value)


server.run('stdio')
