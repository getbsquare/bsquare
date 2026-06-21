import { describe, it, expect, beforeEach } from 'vitest';
import { getSessionManager, SessionManager, SessionData, StoredMessage } from './sessionManager';

function msg(content: string): StoredMessage {
  return { role: 'user', content, message_id: '1', timestamp: Date.now() };
}

const MESSAGES_KEY = 'bsquare_widget_messages';

describe('sessionManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and restores messages for a tenant', () => {
    const sm = getSessionManager('tenant-a');
    sm.saveMessages([msg('hello')]);
    const restored = getSessionManager('tenant-a').loadMessages();
    expect(restored.length).toBe(1);
    expect(restored[0].content).toBe('hello');
  });

  it('isolates storage between tenants', () => {
    getSessionManager('tenant-a').saveMessages([msg('only-a')]);
    expect(getSessionManager('tenant-b').loadMessages().length).toBe(0);
  });

  it('exposes a stable thread id', () => {
    const sm = getSessionManager('tenant-a');
    expect(typeof sm.getThreadId()).toBe('string');
    expect(sm.getThreadId().length).toBeGreaterThan(0);
  });

  it('returns the same instance per tenant key', () => {
    expect(getSessionManager('tenant-x')).toBe(getSessionManager('tenant-x'));
    expect(getSessionManager('tenant-x')).not.toBe(getSessionManager('tenant-y'));
  });
});

describe('SessionManager (class)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates distinct session and thread ids', () => {
    const sm = new SessionManager();
    expect(sm.getSessionId()).toBeTruthy();
    expect(sm.getThreadId()).toBeTruthy();
    expect(sm.getSessionId()).not.toBe(sm.getThreadId());
  });

  it('clearSession removes stored messages', () => {
    const sm = new SessionManager();
    sm.saveMessages([msg('keep?')]);
    expect(sm.loadMessages()).toHaveLength(1);
    sm.clearSession();
    expect(sm.loadMessages()).toHaveLength(0);
  });

  it('startNewSession rotates ids and clears messages', () => {
    const sm = new SessionManager();
    const oldSession = sm.getSessionId();
    const oldThread = sm.getThreadId();
    sm.saveMessages([msg('old')]);

    sm.startNewSession();

    expect(sm.getSessionId()).not.toBe(oldSession);
    expect(sm.getThreadId()).not.toBe(oldThread);
    expect(sm.loadMessages()).toHaveLength(0);
  });

  it('getSessionMetadata reports id and message count', () => {
    const sm = new SessionManager();
    sm.saveMessages([msg('a'), msg('b')]);
    const meta = sm.getSessionMetadata();
    expect(meta.sessionId).toBe(sm.getSessionId());
    expect(meta.threadId).toBe(sm.getThreadId());
    expect(meta.messageCount).toBe(2);
    expect(meta.age).toBeGreaterThanOrEqual(0);
  });

  it('exports and imports session data', () => {
    const source = new SessionManager();
    source.saveMessages([msg('exported')]);
    const exported = source.exportSession();
    expect(exported?.messages[0].content).toBe('exported');

    localStorage.clear();
    const target = new SessionManager();
    target.importSession(exported as SessionData);
    expect(target.getSessionId()).toBe(exported!.sessionId);
    expect(target.loadMessages()[0].content).toBe('exported');
  });

  it('treats a session older than 7 days as expired', () => {
    const sm = new SessionManager();
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    sm.importSession({
      sessionId: sm.getSessionId(),
      threadId: sm.getThreadId(),
      messages: [msg('stale')],
      createdAt: eightDaysAgo,
      lastUpdatedAt: eightDaysAgo,
    });
    expect(sm.loadMessages()).toHaveLength(0);
  });

  it('returns [] for corrupted stored data', () => {
    const sm = new SessionManager();
    localStorage.setItem(MESSAGES_KEY, 'not-json{');
    expect(sm.loadMessages()).toHaveLength(0);
  });

  it('returns [] when stored messages are not an array', () => {
    const sm = new SessionManager();
    localStorage.setItem(
      MESSAGES_KEY,
      JSON.stringify({ sessionId: 's', threadId: 't', messages: 'oops', createdAt: Date.now() }),
    );
    expect(sm.loadMessages()).toHaveLength(0);
  });
});
