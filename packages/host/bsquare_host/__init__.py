"""bsquare-host: backend host-action coordination for injectable agents."""

from .app import mount_agent_app
from .host_actions import (
    get_coordination_stats,
    host_action_proxy,
    setup_host_action_endpoint,
)
from .state import AgentState

__all__ = [
    "host_action_proxy",
    "setup_host_action_endpoint",
    "get_coordination_stats",
    "mount_agent_app",
    "AgentState",
]

__version__ = "0.1.0"
