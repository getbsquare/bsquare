import { BSquareAssistant, BSquareAssistantConfig } from './inject-entry';

/**
 * Mount the injectable agent widget onto the current page.
 * Returns the assistant instance immediately; the Shadow DOM is attached
 * synchronously and React renders on the next tick.
 */
export function mountAgent(config: BSquareAssistantConfig = {}): BSquareAssistant {
  const assistant = new BSquareAssistant(config);
  assistant.mount().catch((err) => {
    console.error('[BSquare] mount() failed:', err);
  });
  return assistant;
}

export { BSquareAssistant };
export type { BSquareAssistantConfig };
export default BSquareAssistant;
