# BSquare — Injectable Frontend-Agent

Drop a single JS bundle into any web page to mount a Shadow-DOM-isolated AI
chat widget that streams from an AG-UI / PydanticAI backend and can act on the
host page's DOM through **host actions**.

## Packages

| Package | Where | Install |
|---------|-------|---------|
| `bsquare-widget` (npm) | `packages/widget` | `npm i bsquare-widget` |
| `bsquare-host` (pip) | `packages/host` | `pip install bsquare-host` |

## 60-second tour

Frontend (any page):
```html
<script src="bsquare-widget.global.js"></script>
<script>
  window.BSquare.mountAgent({
    apiUrl: 'https://your-backend.example.com',
    hostActions: [
      { name: 'navigate_to_page',
        description: 'Go to a section',
        parameters: { page: { type: 'string', description: 'Section to go to', required: true } },
        handler: (p) => { location.hash = p.page; return { success: true }; } },
    ],
  });
</script>
```

### Widget options (`mountAgent`)

| Option | Default | Purpose |
|--------|---------|---------|
| `apiUrl` | — | Backend base URL (`/agent` + `/host-action-result` are appended) |
| `agentName` | `"Assistant"` | Header title |
| `welcomeMessage` | built-in greeting | First message shown in the chat |
| `theme` | `"dark"` | `"dark"` or `"light"` (BSquare is dark-first) |
| `primaryColor` | brand blue | Accent color override |
| `toolDisplay` | `"minimal"` | `"minimal"` (compact card) or `"detailed"` (adds each tool's result row) |
| `toolLabel` | tool name | Tool-call text — a string (e.g. `"Executing action…"`) or `(toolName) => string` |
| `suggestions` | `[]` | Starter-prompt chips shown until the chat starts; clicking one sends it as the first message |
| `showNewConversationButton` | `true` | Show the reset button in the header |
| `apiToken`, `tenantId` | — | Bearer token / tenant id (used by the multi-tenant recipe) |
| `hostActions` | `[]` | Actions the agent can run on the page (see below) |

Backend (FastAPI + PydanticAI):
```python
from fastapi import FastAPI
from pydantic_ai import Agent, RunContext
from bsquare_host import AgentState, host_action_proxy, mount_agent_app
from dataclasses import dataclass

@dataclass
class State(AgentState): pass
@dataclass
class Deps: state: State

agent = Agent("google-gla:gemini-2.5-flash", deps_type=Deps)

@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def navigate_to_page(ctx: RunContext[Deps], page: str) -> str:
    return f"Navigated to {page}"

app = FastAPI()
mount_agent_app(agent, app, lambda: Deps(state=State()), cors_origins=["*"])
```

## How host actions work

```
user → widget POST /agent (SSE) → agent calls tool `navigate_to_page`
  → @host_action_proxy advertises the action and awaits (keyed by tool_call_id)
  → widget matches the tool name to a registered hostAction, runs it on the page
  → widget POSTs /host-action-result → the waiting tool wakes and returns
```

## Examples

- `examples/single-agent` — full Docker Compose demo.
- `examples/multi-tenant` — one bundle, many tenants via a transparent dispatcher.

## Develop

```bash
# widget
cd packages/widget && npm install && npm run build && npm test
# host
cd packages/host && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]' && pytest
```

## License

MIT

## Publishing (maintainers)

- npm: `cd packages/widget && npm publish` (runs the build via `prepublishOnly`).
- pip: `cd packages/host && python -m build && twine upload dist/*`.

Neither package is published automatically; do it deliberately with your own
credentials. Consider an `@scope` for the npm name if you create an npm org.
