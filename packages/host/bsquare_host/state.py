"""Base state for agents that coordinate with frontend host actions."""

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class AgentState:
    """Carry the fields the host-action handshake reads and writes.

    - ``pending_host_action`` is set by :func:`host_action_proxy` so the
      frontend knows which action to run.
    - ``host_action_result`` mirrors the frontend's reply (the canonical copy
      lives in the coordination map keyed by ``tool_call_id``).
    - ``api_token`` is forwarded by the widget in the AG-UI ``state`` field.
    """

    pending_host_action: Optional[Dict[str, Any]] = None
    host_action_result: Optional[Dict[str, Any]] = None
    api_token: Optional[str] = None
