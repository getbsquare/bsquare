import bsquare_host


def test_public_api_exports():
    for name in (
        "host_action_proxy",
        "setup_host_action_endpoint",
        "get_coordination_stats",
        "mount_agent_app",
        "AgentState",
    ):
        assert hasattr(bsquare_host, name), f"missing export: {name}"
