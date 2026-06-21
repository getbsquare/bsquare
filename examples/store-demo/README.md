# Store demo — the agent acting on a live storefront

A richer companion to [`../single-agent`](../single-agent). The minimal example shows
_how to wire an agent up_; this one shows _what host actions can do_: the agent
switches between category pages, spotlights a specific item (or a whole category),
adds items to the cart (which tracks its contents), reads the cart back, and shows
toasts — all on a third-party "Northwind Supply" store the widget is injected into.

Five host actions, each backed by a matching PydanticAI tool:

| Host action          | What it does on the page                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `navigate_to_page`   | switches the store to a category page (home / outerwear / packs / camp / accessories) and updates the active nav |
| `highlight_products` | spotlights ONE item (`product="Trail Jacket"`) or a whole category (`category="camp"`)                           |
| `add_to_cart`        | flashes the product and updates the cart (contents + count)                                                      |
| `get_cart`           | reads back the current cart items, quantities, and total                                                         |
| `show_notification`  | drops a toast (info / success / error)                                                                           |

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

- "show me the trail jacket"
- "take me to the camp page"
- "highlight the packs"
- "add two pairs of merino socks"
- "what's in my cart?"

## Deploy: Coolify

1. Create a new application in Coolify.
2. Connect the `getbsquare/bsquare` repository.
3. Set the **Compose file** to `examples/store-demo/docker-compose.yml`.
4. Set **Build pack** to "Docker" and **Base directory** to `examples/store-demo`.
5. Add environment variables:
   - `GEMINI_API_KEY` — your Google AI Studio API key
   - `BSQUARE_MODEL` (optional) — model string, e.g. `openai:gpt-4o-mini`
   - `OLLAMA_BASE_URL` (optional) — for local or cloud Ollama
   - `OLLAMA_API_KEY` (optional) — if using Ollama Cloud
6. Attach a domain (e.g. `store-demo.getbsquare.com`).
7. Deploy.

The services expose port 80 internally; Coolify's Traefik proxy routes your domain to the web service automatically.

## Models

By default, uses Google Gemini. Override via `BSQUARE_MODEL` environment variable:

- **Any PydanticAI string**: `openai:gpt-4o-mini`, `anthropic:claude-3.5-sonnet`, etc.
- **Ollama local**: `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1` + `BSQUARE_MODEL=llama3.1`
- **Ollama Cloud**: `OLLAMA_BASE_URL=https://ollama.com/v1` + `OLLAMA_API_KEY=...` + model

> **Important**: The model must support **tool calling**, or host actions won't work.
