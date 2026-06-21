from bsquare_host.state import AgentState


def test_agent_state_defaults_are_none():
    s = AgentState()
    assert s.pending_host_action is None
    assert s.host_action_result is None
    assert s.api_token is None


def test_agent_state_is_mutable():
    s = AgentState()
    s.pending_host_action = {"action": "navigate_to_page"}
    assert s.pending_host_action["action"] == "navigate_to_page"
