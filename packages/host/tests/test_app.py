from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bsquare_host.app import mount_agent_app


@dataclass
class _State:
    pending_host_action: Optional[Dict[str, Any]] = None
    host_action_result: Optional[Dict[str, Any]] = None


@dataclass
class _Deps:
    state: _State


class _FakeAgent:
    """Stands in for a PydanticAI agent; mirrors the .to_ag_ui() contract."""

    def __init__(self):
        self.deps_passed = None

    def to_ag_ui(self, deps=None):
        self.deps_passed = deps
        sub = FastAPI()

        @sub.get("/")
        def root():
            return {"ok": True}

        return sub


def test_mount_agent_app_wires_endpoints_and_mount():
    app = FastAPI()
    agent = _FakeAgent()
    mount_agent_app(agent, app, lambda: _Deps(_State()), cors_origins=["*"])
    client = TestClient(app)

    # host-action-result endpoint is present
    r = client.post(
        "/host-action-result",
        json={"toolCallId": "x", "toolName": "t", "result": {}, "success": True},
    )
    assert r.status_code == 200

    # agent is mounted at /agent
    r2 = client.get("/agent/")
    assert r2.status_code == 200
    assert r2.json() == {"ok": True}

    # deps factory was invoked and passed through
    assert isinstance(agent.deps_passed, _Deps)
