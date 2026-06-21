import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAGUI } from './useAGUI';

// --- helpers ---------------------------------------------------------------

/** Build a fake streaming Response that emits the given AG-UI events as SSE. */
function sseResponse(events: unknown[]) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () =>
            sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes }),
        };
      },
    },
  };
}

let hostResultPosts: any[];

/** Mock global.fetch: /agent returns the SSE stream, /host-action-result is recorded. */
function installFetch(agentEvents: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (typeof url === 'string' && url.endsWith('/host-action-result')) {
      hostResultPosts.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return sseResponse(agentEvents); // /agent
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

const HOST_ACTIONS = [{ name: 'show_notification' }];

beforeEach(() => {
  hostResultPosts = [];
  localStorage.clear();
});

// --- regression guards: the TOOL_CALL_END path we keep --------------------

describe('useAGUI host actions', () => {
  it('executes a registered host action exactly once on TOOL_CALL_END with the streamed args', async () => {
    const onExecute = vi.fn().mockResolvedValue({ success: true });
    installFetch([
      { type: 'RUN_STARTED' },
      { type: 'TOOL_CALL_START', toolCallId: 'call_1', toolCallName: 'show_notification' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'call_1', delta: '{"message":"hi","level":"info"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_1' },
      { type: 'RUN_FINISHED' },
    ]);

    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('go');
    });

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith('show_notification', { message: 'hi', level: 'info' });
  });

  it('posts the host action result back to /host-action-result', async () => {
    const onExecute = vi.fn().mockResolvedValue({ success: true });
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 'call_1', toolCallName: 'show_notification' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'call_1', delta: '{"message":"hi"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_1' },
    ]);

    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('go');
    });

    expect(hostResultPosts).toHaveLength(1);
    expect(hostResultPosts[0]).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'show_notification',
      success: true,
    });
  });

  // --- driver: coordination flows through TOOL_CALL_END only --------------
  // pydantic_ai's to_ag_ui never surfaces `pending_host_action` as a
  // STATE_SNAPSHOT, so the state-based reader is dead. Lock that in: a
  // STATE_SNAPSHOT must not trigger a host action.
  it('does not execute a host action from a STATE_SNAPSHOT pending_host_action', async () => {
    const onExecute = vi.fn().mockResolvedValue({ success: true });
    installFetch([
      { type: 'RUN_STARTED' },
      {
        type: 'STATE_SNAPSHOT',
        snapshot: {
          pending_host_action: {
            action: 'show_notification',
            params: { message: 'hi' },
            tool_call_id: 'call_1',
          },
        },
      },
      { type: 'RUN_FINISHED' },
    ]);

    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('go');
    });

    expect(onExecute).not.toHaveBeenCalled();
  });

  it('unwraps a { args: [...] } argument shape before invoking the handler', async () => {
    const onExecute = vi.fn().mockResolvedValue({ success: true });
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 'call_1', toolCallName: 'show_notification' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'call_1', delta: '{"args":[{"message":"hi"}]}' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_1' },
    ]);
    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('go');
    });
    expect(onExecute).toHaveBeenCalledWith('show_notification', { message: 'hi' });
  });

  it('records a tool error message when a host action handler throws', async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error('boom'));
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 'call_1', toolCallName: 'show_notification' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'call_1', delta: '{"message":"hi"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_1' },
    ]);
    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('go');
    });
    const err = result.current.messages.find((m) => m.role === 'tool' && m.content.startsWith('Failed:'));
    expect(err?.content).toContain('boom');
  });
});

describe('useAGUI message rendering', () => {
  it('accumulates streamed text into a single assistant message', async () => {
    installFetch([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello ' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'world' },
    ]);
    const { result } = renderHook(() => useAGUI('http://x'));
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('Hello world');
  });

  it('adds a tool message for a non-host backend tool result', async () => {
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'get_server_time' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: '12:00 UTC' },
    ]);
    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, HOST_ACTIONS, vi.fn()),
    );
    await act(async () => {
      await result.current.sendMessage('time?');
    });
    const tool = result.current.messages.find((m) => m.role === 'tool');
    expect(tool?.content).toBe('12:00 UTC');
    expect(tool?.toolName).toBe('get_server_time');
  });

  it('renders a chart UI block when a host action returns a chart spec', async () => {
    const onExecute = vi.fn().mockResolvedValue({ type: 'bar', data: [{ x: 'Q1', y: 10 }] });
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'render_chart' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    ]);
    const { result } = renderHook(() =>
      useAGUI('http://x', undefined, undefined, [{ name: 'render_chart' }], onExecute),
    );
    await act(async () => {
      await result.current.sendMessage('chart it');
    });
    const chartMsg: any = result.current.messages.find((m) => (m as any).uiBlock);
    expect(chartMsg?.uiBlock?.type).toBe('chart');
    expect(chartMsg?.uiBlock?.spec?.type).toBe('bar');
  });

  it('clears messages on clearSession and exposes session info', async () => {
    installFetch([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'hey' }]);
    const { result } = renderHook(() => useAGUI('http://x'));
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearSession();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.getSessionInfo().sessionId).toBeTruthy();
  });
});
