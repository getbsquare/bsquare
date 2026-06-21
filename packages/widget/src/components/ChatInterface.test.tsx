import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatInterface from './ChatInterface';

// --- SSE fetch mock (same boundary the hook talks to) ----------------------
function sseResponse(events: unknown[]) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes }),
      }),
    },
  };
}

function installFetch(agentEvents: unknown[]) {
  (globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
    if (typeof url === 'string' && url.endsWith('/host-action-result')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return sseResponse(agentEvents);
  });
}

beforeEach(() => {
  localStorage.clear();
  installFetch([]);
});

describe('ChatInterface', () => {
  it('shows the default welcome message and agent name', () => {
    render(<ChatInterface apiUrl="http://x" />);
    expect(screen.getByText('Assistant')).toBeTruthy();
    expect(screen.getByText(/your BSquare assistant/i)).toBeTruthy();
  });

  it('honors custom agent name and welcome message', () => {
    render(<ChatInterface apiUrl="http://x" agentName="Acme Bot" welcomeMessage="Hi from Acme" />);
    expect(screen.getByText('Acme Bot')).toBeTruthy();
    expect(screen.getByText('Hi from Acme')).toBeTruthy();
  });

  it('fires widget-mounted on mount', () => {
    const onWidgetEvent = vi.fn();
    render(<ChatInterface apiUrl="http://x" onWidgetEvent={onWidgetEvent} />);
    expect(onWidgetEvent).toHaveBeenCalledWith('widget-mounted', expect.objectContaining({ apiUrl: 'http://x' }));
  });

  it('renders suggestion chips and sends one when clicked', async () => {
    installFetch([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'on it' }]);
    render(<ChatInterface apiUrl="http://x" suggestions={['Show reports', 'Notify me']} />);
    const chip = screen.getByText('Show reports');
    expect(chip).toBeTruthy();

    await act(async () => {
      fireEvent.click(chip);
    });
    await waitFor(() => expect(screen.getByText('Show reports')).toBeTruthy()); // user echo
    await waitFor(() => expect(screen.getByText('on it')).toBeTruthy());
  });

  it('disables send until input has text, then sends and clears the input', async () => {
    installFetch([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'reply text' }]);
    const onWidgetEvent = vi.fn();
    render(<ChatInterface apiUrl="http://x" onWidgetEvent={onWidgetEvent} />);

    const input = screen.getByPlaceholderText(/Ask anything/i) as HTMLInputElement;
    const sendBtn = screen.getByTitle('Send Message') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'hello there' } });
    expect(sendBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => expect(screen.getByText('reply text')).toBeTruthy());
    expect(input.value).toBe('');
    expect(onWidgetEvent).toHaveBeenCalledWith('message-sending', { content: 'hello there' });
    expect(onWidgetEvent).toHaveBeenCalledWith('message-sent', { content: 'hello there' });
  });

  it('minimizes and restores the widget', () => {
    const onWidgetEvent = vi.fn();
    render(<ChatInterface apiUrl="http://x" onWidgetEvent={onWidgetEvent} />);

    fireEvent.click(screen.getByTitle('Minimize'));
    expect(onWidgetEvent).toHaveBeenCalledWith('widget-minimized', expect.any(Object));
    const launch = screen.getByTitle('Open BSquare Assistant');
    expect(launch).toBeTruthy();

    fireEvent.click(launch);
    expect(onWidgetEvent).toHaveBeenCalledWith('widget-maximized', expect.any(Object));
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeTruthy();
  });

  it('opens the new-conversation confirm dialog and cancels', () => {
    render(<ChatInterface apiUrl="http://x" />);
    fireEvent.click(screen.getByTitle('New Conversation'));
    expect(screen.getByText('Start New Conversation?')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Start New Conversation?')).toBeNull();
  });

  it('confirms a new conversation and emits new_conversation', () => {
    const onWidgetEvent = vi.fn();
    render(<ChatInterface apiUrl="http://x" onWidgetEvent={onWidgetEvent} />);
    fireEvent.click(screen.getByTitle('New Conversation'));
    fireEvent.click(screen.getByText('Start New'));
    expect(onWidgetEvent).toHaveBeenCalledWith('new_conversation', expect.any(Object));
    expect(screen.queryByText('Start New Conversation?')).toBeNull();
  });

  it('hides the new-conversation button when disabled', () => {
    render(<ChatInterface apiUrl="http://x" showNewConversationButton={false} />);
    expect(screen.queryByTitle('New Conversation')).toBeNull();
  });

  it('applies a custom primary color to the container', () => {
    const { container } = render(<ChatInterface apiUrl="http://x" primaryColor="#3366ff" />);
    const root = container.querySelector('.bsquare-widget-container') as HTMLElement;
    expect(root.style.getPropertyValue('--accent-primary')).toBe('#3366ff');
    expect(root.style.getPropertyValue('--accent-primary-hover')).toMatch(/^#/);
  });

  it('renders a tool card for a backend tool result', async () => {
    installFetch([
      { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'get_server_time' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: '12:00 UTC' },
    ]);
    render(<ChatInterface apiUrl="http://x" toolDisplay="detailed" hostActions={[]} onExecuteHostAction={vi.fn()} />);

    const input = screen.getByPlaceholderText(/Ask anything/i);
    fireEvent.change(input, { target: { value: 'time?' } });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Send Message'));
    });

    await waitFor(() => expect(screen.getByText('get_server_time')).toBeTruthy());
    expect(screen.getByText(/12:00 UTC/)).toBeTruthy(); // detailed mode shows result row
  });
});
