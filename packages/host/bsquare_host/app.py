"""One-call wiring for an injectable agent backend."""

from typing import Callable, Optional, Sequence

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .host_actions import setup_host_action_endpoint


def mount_agent_app(
    agent,
    app: FastAPI,
    deps_factory: Callable[[], object],
    *,
    path: str = "/agent",
    cors_origins: Optional[Sequence[str]] = None,
) -> FastAPI:
    """Wire an AG-UI agent, the host-action endpoint, and (optionally) CORS.

    Args:
        agent: an object exposing ``to_ag_ui(deps=...)`` (e.g. a PydanticAI Agent).
        app: the FastAPI app to mount onto.
        deps_factory: zero-arg callable returning the agent's deps instance.
            Called once at mount time (not per request).
        path: mount path for the AG-UI app (default ``/agent``).
        cors_origins: if given, a permissive CORS middleware is added for them.
    """
    if cors_origins is not None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cors_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    setup_host_action_endpoint(app)
    app.mount(path, agent.to_ag_ui(deps=deps_factory()))
    return app
