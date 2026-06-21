"""Store-demo backend — an injectable agent that ACTS on a live storefront.

Five host actions the widget runs against the Northwind store page:
navigate_to_page, highlight_products, add_to_cart, get_cart, show_notification.
"""

import os
from dataclasses import dataclass

from fastapi import FastAPI
from pydantic_ai import Agent, RunContext

from bsquare_host import AgentState, host_action_proxy, mount_agent_app


@dataclass
class StoreState(AgentState):
    pass


@dataclass
class StoreDeps:
    state: StoreState


CATALOG = """
Products (use the EXACT name with add_to_cart and highlight_products product=...):
- "Trail Jacket" (outerwear, $189)
- "Summit 45 Pack" (packs, $230)
- "Carbon Trekking Poles" (camp, $120)
- "Ridgeline 2 Tent" (camp, $349)
- "Trail Stove" (camp, $69)
- "Merino Wool Socks" (accessories, $24)

Pages (navigate_to_page): home, outerwear, packs, camp, accessories.
Categories (highlight_products category=...): outerwear, packs, camp, accessories, all.
"""

# Model selection: Gemini by default, any BSQUARE_MODEL string, or Ollama via
# OLLAMA_BASE_URL (+ OLLAMA_API_KEY for Cloud). The model MUST support tool calling.
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
    deps_type=StoreDeps,
    system_prompt=(
        "You are the shopping assistant for Northwind Supply, an outdoor-gear store. "
        "Act on the live page through host actions instead of merely describing things:\n"
        "- navigate_to_page(page): switch the store to a category page.\n"
        "- highlight_products: to spotlight ONE item, pass its exact name as `product` "
        "(e.g. product='Trail Jacket'). To spotlight a whole category, pass `category`. "
        "When the user asks about a single item, ALWAYS use `product` — never highlight "
        "everything.\n"
        "- add_to_cart(product, quantity): add an item; the cart counter updates.\n"
        "- get_cart(): read the current cart contents before answering anything about the cart.\n"
        "- show_notification(message, level): confirm with a toast.\n"
        "Use exact product names, and after acting confirm in one short line.\n" + CATALOG
    ),
)


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def navigate_to_page(ctx: RunContext[StoreDeps], page: str) -> str:
    """Switch the store to a category page (home, outerwear, packs, camp, accessories)."""
    return f"Opened the {page} page"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def show_notification(ctx: RunContext[StoreDeps], message: str, level: str = "info") -> str:
    """Show a toast on the store page (level: info | success | error)."""
    return f"Showed {level} notification"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def add_to_cart(ctx: RunContext[StoreDeps], product: str, quantity: int = 1) -> str:
    """Add a product to the cart by its exact name; the page's cart counter updates."""
    return f"Added {quantity} x {product} to the cart"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def highlight_products(ctx: RunContext[StoreDeps], product: str = "", category: str = "") -> str:
    """Spotlight items on the page.

    Pass `product` (the exact product name) to highlight a SINGLE item — use this
    whenever the user is asking about one item. Pass `category`
    (outerwear/packs/camp/accessories/all) to highlight a whole group instead.
    """
    if product:
        return f"Highlighted {product}"
    return f"Highlighted {category or 'all'} products"


@agent.tool
@host_action_proxy(timeout=3.0, auto_format=True)
async def get_cart(ctx: RunContext[StoreDeps]) -> str:
    """Read the current cart contents (items, quantities, and running total)."""
    return "Read the cart"


app = FastAPI(title="BSquare store demo")
mount_agent_app(agent, app, lambda: StoreDeps(state=StoreState()), cors_origins=["*"])


@app.get("/health")
def health():
    return {"status": "ok"}
