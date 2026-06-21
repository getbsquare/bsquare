import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { BSquareAssistant } from './inject-entry';

// A noop streaming fetch so the mounted ChatInterface's hook never errors.
function installNoopFetch() {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
  }));
}

const action = (name: string, handler: (params: any) => any = vi.fn(async () => ({ success: true }))) => ({
  name,
  description: `${name} action`,
  parameters: {},
  handler,
});

async function mount(assistant: BSquareAssistant, id?: string) {
  await act(async () => {
    await assistant.mount(id);
  });
}

/** Collect host-bound events dispatched via sendToHost on the container. */
function captureHostEvents(containerId = 'bsquare-container') {
  const seen: { type: string; data: any }[] = [];
  document
    .getElementById(containerId)!
    .addEventListener('bsquare-widget-message', ((e: CustomEvent) => {
      seen.push({ type: e.detail.type, data: e.detail.data });
    }) as EventListener);
  return seen;
}

beforeEach(() => {
  localStorage.clear();
  installNoopFetch();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('bsquare-fonts')?.remove();
});

describe('BSquareAssistant', () => {
  it('registers host actions and handlers passed in the constructor', () => {
    const assistant = new BSquareAssistant({
      hostActions: [action('navigate'), action('notify')],
      hostMessageHandlers: [{ type: 'ping', handler: vi.fn() }],
    });
    expect(assistant.getAvailableHostActions()).toEqual(['navigate', 'notify']);
  });

  it('mounts into a shadow root and injects styles + brand fonts', async () => {
    const assistant = new BSquareAssistant();
    await mount(assistant);

    const container = document.getElementById('bsquare-container')!;
    expect(container).not.toBeNull();
    expect(container.shadowRoot).not.toBeNull();
    expect(container.shadowRoot!.querySelector('style')).not.toBeNull();
    expect(container.shadowRoot!.querySelector('.bsquare-react-root')).not.toBeNull();
    expect(document.getElementById('bsquare-fonts')).not.toBeNull();
  });

  it('reuses an existing container element', async () => {
    const existing = document.createElement('div');
    existing.id = 'preexisting';
    document.body.appendChild(existing);

    const assistant = new BSquareAssistant({ containerId: 'preexisting' });
    await mount(assistant, 'preexisting');

    expect(document.querySelectorAll('#preexisting')).toHaveLength(1);
    expect(existing.shadowRoot).not.toBeNull();
  });

  it('registers and unregisters host actions at runtime', async () => {
    const assistant = new BSquareAssistant();
    await mount(assistant);

    assistant.registerHostAction(action('later'));
    expect(assistant.getAvailableHostActions()).toContain('later');

    assistant.unregisterHostAction('later');
    expect(assistant.getAvailableHostActions()).not.toContain('later');
  });

  it('executes a registered host action and emits lifecycle events', async () => {
    const handler = vi.fn(async (p: any) => ({ ok: p.value }));
    const assistant = new BSquareAssistant({ hostActions: [action('do', handler)] });
    await mount(assistant);
    const events = captureHostEvents();

    const result = await (assistant as any).executeHostAction('do', { value: 42 });

    expect(handler).toHaveBeenCalledWith({ value: 42 });
    expect(result).toEqual({ ok: 42 });
    expect(events.map((e) => e.type)).toContain('host-action-executing');
    expect(events.map((e) => e.type)).toContain('host-action-completed');
  });

  it('throws when executing an unknown host action', async () => {
    const assistant = new BSquareAssistant();
    await mount(assistant);
    await expect((assistant as any).executeHostAction('missing', {})).rejects.toThrow(/not found/);
  });

  it('emits an error event and rethrows when a host action handler fails', async () => {
    const handler = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const assistant = new BSquareAssistant({ hostActions: [action('bad', handler)] });
    await mount(assistant);
    const events = captureHostEvents();

    await expect((assistant as any).executeHostAction('bad', {})).rejects.toThrow('kaboom');
    const err = events.find((e) => e.type === 'host-action-error');
    expect(err?.data.error).toBe('kaboom');
  });

  it('routes host->widget messages to handlers and the global callback', async () => {
    const onHostMessage = vi.fn();
    const typed = vi.fn();
    const assistant = new BSquareAssistant({ onHostMessage });
    await mount(assistant);

    assistant.onHostMessage('refresh', typed);
    assistant.sendMessageToWidget('refresh', { n: 1 });

    expect(typed).toHaveBeenCalledWith({ n: 1 });
    expect(onHostMessage).toHaveBeenCalledWith({ type: 'refresh', data: { n: 1 } });
  });

  it('reports widget info and supports updateConfig', async () => {
    const assistant = new BSquareAssistant({ hostActions: [action('x')] });
    await mount(assistant);

    let info = assistant.getWidgetInfo();
    expect(info.mounted).toBe(true);
    expect(info.isDestroyed).toBe(false);
    expect(info.availableHostActions).toContain('x');

    await act(async () => {
      assistant.updateConfig({ theme: 'light' });
    });
    expect(assistant.getWidgetInfo().config.theme).toBe('light');
  });

  it('unmounts and tears down the container', async () => {
    const assistant = new BSquareAssistant();
    await mount(assistant);
    expect(document.getElementById('bsquare-container')).not.toBeNull();

    await act(async () => {
      assistant.unmount();
    });

    expect(document.getElementById('bsquare-container')).toBeNull();
    expect(assistant.getWidgetInfo().isDestroyed).toBe(true);
    expect(assistant.getWidgetInfo().mounted).toBe(false);
  });
});
