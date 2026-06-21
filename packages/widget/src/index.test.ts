import { describe, it, expect, afterEach } from 'vitest';
import { mountAgent } from './index';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountAgent', () => {
  it('creates a container with a shadow root', () => {
    const assistant = mountAgent({ apiUrl: 'http://localhost:8000' });
    const container = document.getElementById('bsquare-container');
    expect(container).not.toBeNull();
    expect(container!.shadowRoot).not.toBeNull();
    assistant.unmount();
  });

  it('honors a custom containerId', () => {
    const assistant = mountAgent({ apiUrl: 'http://localhost:8000', containerId: 'my-agent' });
    expect(document.getElementById('my-agent')).not.toBeNull();
    assistant.unmount();
  });
});
