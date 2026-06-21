"""Minimal injectable-agent backend: three host actions + one backend tool."""

import os
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic_ai import Agent, RunContext

from bsquare_host import AgentState, host_action_proxy, mount_agent_app


@dataclass
class DemoState(AgentState):
    pass


@dataclass
class DemoDeps:
    state: DemoState


# Model selection:
#   - Default: Google Gemini via API key (set GEMINI_API_KEY).
#   - Any PydanticAI model string via BSQUARE_MODEL (e.g. "openai:gpt-4o-mini").
#   - Ollama (local or Cloud): set OLLAMA_BASE_URL (and OLLAMA_API_KEY for Cloud).
#     BSQUARE_MODEL then names the Ollama model (e.g. "llama3.1" local, "gpt-oss:120b" cloud).
#     NOTE: the chosen model MUST support tool calling, or host actions won't fire.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL")
if OLLAMA_BASE_URL:
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.ollama import OllamaProvider

    model = OpenAIChatModel(
        os.getenv("BSQUARE_MODEL", "llama3.1"),
        provider=OllamaProvider(
            base_url=OLLAMA_BASE_URL,
            api_key=os.getenv("OLLAMA_API_KEY", "ollama"),
        ),
    )
else:
    model = os.getenv("BSQUARE_MODEL", "google-gla:gemini-2.5-flash")

agent = Agent(
    model=model,
    deps_type=DemoDeps,
    system_prompt=(
        "You are a helpful assistant embedded in a web page. "
        "You can move the page to a named section with navigate_to_page, "
        "show a banner with show_notification, and draw a chart in the chat "
        "with render_chart. When the user gives you a set of numbers to "
        "visualize (or asks for a sample chart), call render_chart with a "
        "title, parallel labels/values arrays, and chart_type 'bar' or 'line'. "
        "After acting, briefly confirm what you did."
    ),
)


@agent.tool
async def get_server_time(ctx: RunContext[DemoDeps]) -> str:
    """Return the current server time (pure backend tool, no host action)."""
    return f"The server time is {datetime.now(timezone.utc).isoformat()}"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def navigate_to_page(ctx: RunContext[DemoDeps], page: str) -> str:
    """Navigate the host page to a named section (host action)."""
    return f"Navigated to {page}"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def show_notification(ctx: RunContext[DemoDeps], message: str, level: str = "info") -> str:
    """Show a notification banner on the host page (host action)."""
    return f"Showed {level} notification"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def render_chart(
    ctx: RunContext[DemoDeps],
    title: str,
    labels: list[str],
    values: list[float],
    chart_type: str = "bar",
) -> str:
    """Draw a chart inside the chat (host action).

    Pass a `title`, parallel `labels` and `values` arrays of equal length, and
    `chart_type` of either "bar" or "line". The widget renders the chart inline;
    a host action can return data for the chat to display, not just mutate the DOM.
    """
    return f"Rendered {chart_type} chart '{title}' with {len(values)} data points"


app = FastAPI(title="BSquare single-agent example")
mount_agent_app(agent, app, lambda: DemoDeps(state=DemoState()), cors_origins=["*"])


@app.get("/health")
def health():
    return {"status": "ok"}
