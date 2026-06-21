"""
Host action coordination system for injectable AG-UI / PydanticAI agents.

This module provides the production-ready @host_action_proxy decorator and coordination
infrastructure that lets backend tools trigger an action on the host page (via the
injectable widget) and wait for its result, coordinated per tool_call_id.

Usage in any agent:
    from bsquare_host import host_action_proxy, setup_host_action_endpoint

    @your_agent.tool
    @host_action_proxy(timeout=3.0)
    async def get_page_info(ctx: RunContext[YourDeps], host_result: dict = None) -> str:
        if host_result and host_result.get('success'):
            return f"Retrieved page information: {host_result.get('result')}"
        return "Unable to retrieve page information at this time."

    # Add to your FastAPI app:
    setup_host_action_endpoint(app)

Diagnostic messages are emitted via the ``bsquare_host`` logger at DEBUG level, so the
library stays silent by default. Enable them with::

    import logging
    logging.getLogger("bsquare_host").setLevel(logging.DEBUG)
"""

import asyncio
import inspect
import logging
import time
import uuid
from typing import Dict, Any, Callable
from fastapi import FastAPI

logger = logging.getLogger("bsquare_host")

# Global coordination state - shared across all agents using this module
# This is intentionally global to allow coordination between:
# 1. Multiple decorated tools within an agent
# 2. The /host-action-result endpoint
# 3. Frontend widget result submissions
host_action_results: Dict[str, Any] = {}
pending_host_actions: Dict[str, asyncio.Event] = {}


def host_action_proxy(timeout: float = 5.0, auto_format: bool = False):
    """
    Production-ready decorator for backend tools that coordinate with frontend host actions.

    Features:
    - Multi-user safe using tool_call_id coordination
    - Automatic timeout handling and cleanup
    - Zero race conditions between concurrent users
    - Graceful error handling and fallback responses

    Args:
        timeout: Maximum time to wait for host action result (default: 5.0 seconds)
        auto_format: If True, automatically handle timeout/success/error responses (default: False)

    Usage Option 1 - Manual handling (existing pattern):
        @your_agent.tool
        @host_action_proxy(timeout=3.0)
        async def navigate_to_page(ctx: RunContext[YourDeps], page: str, host_result: dict = None) -> str:
            if host_result and host_result.get('timeout'):
                return f"Navigation to {page} is taking longer than expected..."

            if host_result and host_result.get('success'):
                result = host_result.get('result', {})
                if result.get('success'):
                    return f"Navigation completed: {result}"

            return f"Unable to navigate to {page} page at this time."

    Usage Option 2 - Auto-format (eliminates boilerplate):
        @your_agent.tool
        @host_action_proxy(timeout=3.0, auto_format=True)
        async def navigate_to_page(ctx: RunContext[YourDeps], page: str) -> dict:
            '''Navigate to a specific page in the construction management system.'''
            return {
                "action": "navigate_to_page",
                "params": {"page": page},
                "timeout_message": f"Navigation to {page} is taking longer than expected...",
                "error_message": f"Unable to navigate to {page} page at this time."
            }
    """
    def decorator(func: Callable) -> Callable:
        # The wrapper below is generic (ctx, *args, **kwargs), but agent
        # frameworks (e.g. PydanticAI) build each tool's JSON schema by
        # introspecting the function signature. If they see (*args, **kwargs)
        # the model is never told the real parameters and calls the tool with
        # none -- so the host action runs against empty params. Advertise the
        # wrapped function's real signature instead, hiding the internal
        # host_result coordination parameter.
        _orig_sig = inspect.signature(func)
        _public_params = [
            p for name, p in _orig_sig.parameters.items() if name != "host_result"
        ]
        _public_sig = _orig_sig.replace(parameters=_public_params)
        _public_annotations = {
            k: v
            for k, v in getattr(func, "__annotations__", {}).items()
            if k != "host_result"
        }

        async def wrapper(ctx, *args, **kwargs):
            action_name = func.__name__
            logger.debug(f"Host Action: {action_name} decorator wrapper called")

            # Get tool call ID from context - this is unique per tool call
            tool_call_id = ctx.tool_call_id
            if not tool_call_id:
                # Fallback to generating unique ID if not available
                tool_call_id = str(uuid.uuid4())

            logger.debug(f"Host Action: Using tool_call_id: {tool_call_id}")

            # Set up waiting mechanism using unique tool_call_id
            pending_host_actions[tool_call_id] = asyncio.Event()

            # Extract parameters from function signature
            sig = _orig_sig
            func_params = {}

            # Get parameters excluding ctx and host_result
            param_names = [p for p in sig.parameters.keys() if p not in ['ctx', 'host_result']]
            for i, param_name in enumerate(param_names):
                if i < len(args):
                    func_params[param_name] = args[i]

            # Only add non-host_result kwargs to func_params
            filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'host_result'}
            func_params.update(filtered_kwargs)

            # Store clean args and kwargs for function calls
            clean_args = args[:len(param_names)]
            clean_kwargs = filtered_kwargs

            # Set pending host action in state for frontend (include tool_call_id)
            # Handle both dict and dataclass state objects
            if hasattr(ctx.deps.state, 'pending_host_action'):
                # Dataclass-style state
                ctx.deps.state.pending_host_action = {
                    "action": action_name,
                    "params": func_params,
                    "tool_call_id": tool_call_id,
                    "timestamp": time.time()
                }
            else:
                # Dict-style state
                ctx.deps.state["pending_host_action"] = {
                    "action": action_name,
                    "params": func_params,
                    "tool_call_id": tool_call_id,
                    "timestamp": time.time()
                }

            logger.debug(f"Host Action: Set pending_host_action for {action_name} with tool_call_id {tool_call_id}, waiting for result...")

            # Wait for host action result with timeout
            try:
                await asyncio.wait_for(
                    pending_host_actions[tool_call_id].wait(),
                    timeout=timeout
                )

                # Get result using tool_call_id
                action_result = host_action_results.get(tool_call_id)

                if action_result:
                    result = action_result.get('result', {})
                    logger.debug(f"Host Action: Found {action_name} result for tool_call_id {tool_call_id}: {result}")

                    # Clean up
                    del pending_host_actions[tool_call_id]
                    del host_action_results[tool_call_id]

                    # Handle auto-format vs manual mode
                    if auto_format:
                        return _auto_format_response(action_result, action_name, func)
                    else:
                        # Call original function with host_result
                        return await func(ctx, host_result=action_result)
                else:
                    logger.debug(f"Host Action: No result found for {action_name} with tool_call_id {tool_call_id}")
                    if auto_format:
                        # Get function metadata for error handling
                        func_result = await func(ctx, *clean_args, **clean_kwargs)
                        if isinstance(func_result, dict) and 'error_message' in func_result:
                            return func_result['error_message']
                        return f"Unable to complete {action_name} at this time."
                    else:
                        return await func(ctx, host_result=None)

            except asyncio.TimeoutError:
                logger.debug(f"Host Action: {action_name} timed out after {timeout}s (tool_call_id: {tool_call_id})")
                # Clean up
                if tool_call_id in pending_host_actions:
                    del pending_host_actions[tool_call_id]

                if auto_format:
                    # Get function metadata for timeout handling
                    func_result = await func(ctx, *clean_args, **clean_kwargs)
                    if isinstance(func_result, dict) and 'timeout_message' in func_result:
                        return func_result['timeout_message']
                    return f"{action_name} is taking longer than expected..."
                else:
                    # Call function with timeout indication
                    return await func(ctx, host_result={'timeout': True})

        # Preserve original function metadata and advertise the real signature
        # (minus host_result) so tool-schema builders see the true parameters.
        wrapper.__name__ = func.__name__
        wrapper.__doc__ = func.__doc__
        wrapper.__annotations__ = _public_annotations
        wrapper.__signature__ = _public_sig

        return wrapper
    return decorator


def _auto_format_response(action_result: dict, action_name: str, func: Callable) -> str:
    """
    Auto-format host action responses based on success/failure patterns.

    Args:
        action_result: Result from host action execution
        action_name: Name of the action that was executed
        func: Original function for extracting custom messages

    Returns:
        Formatted response string
    """
    if action_result.get('success'):
        result = action_result.get('result', {})
        if result.get('success'):
            # Format successful result - show data if meaningful
            if isinstance(result, dict) and len(result) > 1:
                return f"✅ {action_name.replace('_', ' ').title()} completed successfully: {result}"
            else:
                return f"✅ {action_name.replace('_', ' ').title()} completed successfully"
        else:
            # Host action succeeded but returned failure
            error_msg = result.get('error', 'Unknown error')
            return f"❌ {action_name.replace('_', ' ').title()} failed: {error_msg}"
    else:
        # Host action itself failed
        error_msg = action_result.get('error', 'Host action execution failed')
        return f"❌ {action_name.replace('_', ' ').title()} failed: {error_msg}"


def setup_host_action_endpoint(app: FastAPI):
    """
    Add the /host-action-result endpoint to a FastAPI app.

    This endpoint receives results from frontend host actions and coordinates
    with waiting backend tools through the global coordination system.

    Args:
        app: FastAPI application instance

    Usage:
        from bsquare_host import setup_host_action_endpoint

        app = FastAPI()
        setup_host_action_endpoint(app)
    """

    @app.post("/host-action-result")
    async def receive_host_action_result(request: dict):
        """Unified endpoint for receiving host action results from frontend widgets."""
        logger.debug(f"Host Action: Received result: {request.get('toolName')} -> {request.get('result')}")

        # Extract coordination data
        tool_call_id = request.get('toolCallId')
        tool_name = request.get('toolName')
        result = request.get('result')
        success = request.get('success', False)

        if not tool_call_id:
            return {"status": "error", "detail": "toolCallId is required"}

        # Store result and notify waiting tools
        host_action_results[tool_call_id] = {
            'result': result,
            'success': success,
            'toolName': tool_name
        }

        # Notify waiting tool if exists (using tool_call_id)
        if tool_call_id in pending_host_actions:
            logger.debug(f"Host Action: Found waiting tool for tool_call_id '{tool_call_id}', setting event!")
            pending_host_actions[tool_call_id].set()
        else:
            logger.debug(f"Host Action: No waiting tool found for tool_call_id '{tool_call_id}'")

        if success:
            logger.debug(f"Host action {tool_name} completed successfully")
        else:
            logger.debug(f"Host action {tool_name} failed")

        return {"status": "received", "toolCallId": tool_call_id}


def get_coordination_stats() -> Dict[str, Any]:
    """
    Get current coordination system statistics for debugging.

    Returns:
        Dictionary with current state of coordination system
    """
    return {
        "pending_actions": len(pending_host_actions),
        "stored_results": len(host_action_results),
        "pending_tool_call_ids": list(pending_host_actions.keys()),
        "result_tool_call_ids": list(host_action_results.keys())
    }
