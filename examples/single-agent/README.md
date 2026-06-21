# Single-agent example

End-to-end demo of the injectable agent: a PydanticAI backend with three host
actions (`navigate_to_page`, `show_notification`, `render_chart`) and one
backend tool (`get_server_time`), plus a static host page that mounts the
widget.

`render_chart` shows that a host action doesn't have to mutate the page — it can
hand data back for the widget to render. Its handler returns
`{ type: "chart", spec }`, and the chat draws an inline, click-to-enlarge chart.

## Setup

1. Build the widget bundle:
   ```bash
   (cd ../../packages/widget && npm install && npm run build)
   cp ../../packages/widget/dist/bsquare-widget.global.js web/
   ```

2. Configure your model:
   ```bash
   cp .env.example .env
   # Edit .env and set GEMINI_API_KEY, or configure Ollama
   ```

## Local: Docker Compose

```bash
docker compose up --build
```

Then open http://localhost/web/index.html (or use Coolify deployment URLs).

Try these prompts:
- "take me to the reports section"
- "notify me that my order shipped"
- "chart our quarterly sales: Q1 120, Q2 210, Q3 180, Q4 260"

## Deploy: Coolify

1. Create a new application in Coolify.
2. Connect the `getbsquare/bsquare` repository.
3. Set the **Compose file** to `examples/single-agent/docker-compose.yml`.
4. Set **Build pack** to "Docker" and **Base directory** to `examples/single-agent`.
5. Add environment variables:
   - `GEMINI_API_KEY` — your Google AI Studio API key
   - `BSQUARE_MODEL` (optional) — model string, e.g. `openai:gpt-4o-mini`
   - `OLLAMA_BASE_URL` (optional) — for local or cloud Ollama
   - `OLLAMA_API_KEY` (optional) — if using Ollama Cloud
6. Attach a domain (e.g. `single-agent-demo.getbsquare.com`).
7. Deploy.

The services expose port 80 internally; Coolify's Traefik proxy routes your domain to the web service automatically.

## Models

By default, uses Google Gemini. Override via `BSQUARE_MODEL` environment variable:

- **Any PydanticAI string**: `openai:gpt-4o-mini`, `anthropic:claude-3.5-sonnet`, etc.
- **Ollama local**: `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1` + `BSQUARE_MODEL=llama3.1`
- **Ollama Cloud**: `OLLAMA_BASE_URL=https://ollama.com/v1` + `OLLAMA_API_KEY=...` + model

> **Important**: The model must support **tool calling**, or host actions won't work.
