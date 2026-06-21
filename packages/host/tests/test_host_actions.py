import asyncio
import inspect
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bsquare_host.host_actions import (
    host_action_proxy,
    setup_host_action_endpoint,
    pending_host_actions,
    host_action_results,
)


@dataclass
class _State:
    pending_host_action: Optional[Dict[str, Any]] = None
    host_action_result: Optional[Dict[str, Any]] = None


@dataclass
class _Deps:
    state: _State


class _Ctx:
    def __init__(self, tool_call_id, deps):
        self.tool_call_id = tool_call_id
        self.deps = deps


@host_action_proxy(timeout=2.0, auto_format=True)
async def navigate_to_page(ctx, page: str) -> str:
    return f"Navigated to {page}"


@host_action_proxy(timeout=0.2, auto_format=True)
async def slow_action(ctx) -> str:
    return "done"


@host_action_proxy(timeout=2.0)
async def manual_action(ctx, page: str, host_result: dict = None) -> str:
    return f"manual {page}"


def test_decorator_exposes_wrapped_parameters_to_schema():
    # PydanticAI (and any tool framework) builds a tool's JSON schema by
    # introspecting the function signature. The decorator must advertise the
    # wrapped function's real parameters -- NOT the wrapper's (ctx, *args,
    # **kwargs) -- otherwise the model is never told the tool takes `page` and
    # calls it with no arguments (the action then runs against empty params).
    sig = inspect.signature(navigate_to_page)
    assert "page" in sig.parameters, "the 'page' parameter must be visible to the schema builder"
    assert sig.parameters["page"].annotation is str
    kinds = {p.kind for p in sig.parameters.values()}
    assert inspect.Parameter.VAR_POSITIONAL not in kinds, "*args must not leak into the tool schema"
    assert inspect.Parameter.VAR_KEYWORD not in kinds, "**kwargs must not leak into the tool schema"


def test_decorator_hides_internal_host_result_param():
    # `host_result` is an internal coordination channel, not a model-facing
    # argument; it must never appear in the advertised signature.
    sig = inspect.signature(manual_action)
    assert "page" in sig.parameters
    assert "host_result" not in sig.parameters


async def test_handshake_accepts_keyword_arguments():
    # PydanticAI invokes tools with keyword arguments, so the params advertised
    # to the frontend must be captured from kwargs, not only positional args.
    ctx = _Ctx("call-kw", _Deps(_State()))
    task = asyncio.create_task(navigate_to_page(ctx, page="reports"))
    await asyncio.sleep(0.05)

    assert ctx.deps.state.pending_host_action["params"] == {"page": "reports"}

    host_action_results["call-kw"] = {
        "result": {"success": True, "page": "reports"},
        "success": True,
        "toolName": "navigate_to_page",
    }
    pending_host_actions["call-kw"].set()

    result = await task
    assert "completed successfully" in result
    assert "call-kw" not in pending_host_actions
    assert "call-kw" not in host_action_results


async def test_handshake_returns_formatted_success():
    ctx = _Ctx("call-1", _Deps(_State()))
    task = asyncio.create_task(navigate_to_page(ctx, "reports"))
    await asyncio.sleep(0.05)  # let the decorator register the pending action

    # The decorator must have advertised the pending action on state:
    assert ctx.deps.state.pending_host_action["action"] == "navigate_to_page"
    assert ctx.deps.state.pending_host_action["params"] == {"page": "reports"}

    # Simulate the frontend posting its result (what the endpoint does):
    host_action_results["call-1"] = {
        "result": {"success": True, "page": "reports"},
        "success": True,
        "toolName": "navigate_to_page",
    }
    pending_host_actions["call-1"].set()

    result = await task
    assert "completed successfully" in result
    # Coordination state is cleaned up after a successful handshake:
    assert "call-1" not in pending_host_actions
    assert "call-1" not in host_action_results


async def test_timeout_returns_message():
    ctx = _Ctx("call-2", _Deps(_State()))
    result = await slow_action(ctx)  # nobody ever sets the event
    assert "taking longer than expected" in result
    assert "call-2" not in pending_host_actions


def test_endpoint_sets_event_and_stores_result():
    app = FastAPI()
    setup_host_action_endpoint(app)
    client = TestClient(app)

    pending_host_actions["call-3"] = asyncio.Event()
    resp = client.post(
        "/host-action-result",
        json={
            "toolCallId": "call-3",
            "toolName": "navigate_to_page",
            "result": {"success": True},
            "success": True,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["toolCallId"] == "call-3"
    assert pending_host_actions["call-3"].is_set()
    assert host_action_results["call-3"]["success"] is True

    pending_host_actions.pop("call-3", None)
    host_action_results.pop("call-3", None)


def test_endpoint_rejects_missing_tool_call_id():
    app = FastAPI()
    setup_host_action_endpoint(app)
    client = TestClient(app)
    resp = client.post(
        "/host-action-result",
        json={"toolName": "x", "result": {}, "success": True},  # no toolCallId
    )
    assert resp.status_code == 200
    assert resp.json().get("status") == "error"
    # the None key must NOT have been written
    from bsquare_host.host_actions import host_action_results
    assert None not in host_action_results
