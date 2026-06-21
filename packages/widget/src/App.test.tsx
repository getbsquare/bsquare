import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
  }));
});

describe('App', () => {
  it('renders the chat interface with the given props', () => {
    render(<App apiUrl="http://x" agentName="Routed Bot" />);
    expect(screen.getByText('Routed Bot')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeTruthy();
  });
});
