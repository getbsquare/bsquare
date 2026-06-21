/**
 * Session Manager for B² Injectable Widget
 * Handles conversation persistence across page refreshes using localStorage
 */

import { v4 as uuidv4 } from 'uuid';

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  message_id: string;
  timestamp: number;
  tool?: any;
  tool_calls?: any[];
}

export interface SessionData {
  sessionId: string;
  threadId: string;
  messages: StoredMessage[];
  createdAt: number;
  lastUpdatedAt: number;
  tenantId?: string;
  metadata?: Record<string, any>;
}

const STORAGE_PREFIX = 'bsquare_widget_';
const SESSION_ID_KEY = `${STORAGE_PREFIX}session_id`;
const THREAD_ID_KEY = `${STORAGE_PREFIX}thread_id`;
const MESSAGES_KEY = `${STORAGE_PREFIX}messages`;
const SESSION_DATA_KEY = `${STORAGE_PREFIX}session_data`;
const SESSION_EXPIRY_DAYS = 7; // Sessions expire after 7 days

export class SessionManager {
  private tenantId?: string;
  private sessionId: string;
  private threadId: string;

  constructor(tenantId?: string) {
    this.tenantId = tenantId;
    this.sessionId = this.getOrCreateSessionId();
    this.threadId = this.getOrCreateThreadId();
    
    // Clean up expired sessions on initialization
    this.cleanupExpiredSessions();
  }

  /**
   * Get or create a unique session ID
   */
  private getOrCreateSessionId(): string {
    const storageKey = this.getStorageKey(SESSION_ID_KEY);
    let sessionId = localStorage.getItem(storageKey);
    
    if (!sessionId) {
      sessionId = uuidv4();
      localStorage.setItem(storageKey, sessionId);
      console.log('🆔 Created new session ID:', sessionId);
    } else {
      console.log('🔄 Restored session ID:', sessionId);
    }
    
    return sessionId;
  }

  /**
   * Get or create a thread ID for AG-UI
   */
  private getOrCreateThreadId(): string {
    const storageKey = this.getStorageKey(THREAD_ID_KEY);
    let threadId = localStorage.getItem(storageKey);
    
    if (!threadId) {
      threadId = uuidv4();
      localStorage.setItem(storageKey, threadId);
      console.log('🧵 Created new thread ID:', threadId);
    } else {
      console.log('🔄 Restored thread ID:', threadId);
    }
    
    return threadId;
  }

  /**
   * Get storage key with tenant prefix if available
   */
  private getStorageKey(key: string): string {
    return this.tenantId ? `${key}_${this.tenantId}` : key;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get current thread ID
   */
  getThreadId(): string {
    return this.threadId;
  }

  /**
   * Save messages to localStorage
   */
  saveMessages(messages: StoredMessage[]): void {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      const sessionData: SessionData = {
        sessionId: this.sessionId,
        threadId: this.threadId,
        messages,
        createdAt: this.getSessionCreatedAt(),
        lastUpdatedAt: Date.now(),
        tenantId: this.tenantId,
        metadata: {}
      };
      
      localStorage.setItem(storageKey, JSON.stringify(sessionData));
      console.log(`💾 Saved ${messages.length} messages to session`);
    } catch (error) {
      console.error('Failed to save messages to localStorage:', error);
      // Handle quota exceeded error
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('⚠️ localStorage quota exceeded, clearing old messages');
        this.clearOldMessages();
      }
    }
  }

  /**
   * Load messages from localStorage
   */
  loadMessages(): StoredMessage[] {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      const stored = localStorage.getItem(storageKey);
      
      if (!stored) {
        console.log('📭 No stored messages found');
        return [];
      }

      const sessionData: SessionData = JSON.parse(stored);
      
      // Check if session is expired
      if (this.isSessionExpired(sessionData)) {
        console.log('⏰ Session expired, clearing messages');
        this.clearSession();
        return [];
      }

      // Validate session data
      if (!Array.isArray(sessionData.messages)) {
        console.warn('⚠️ Invalid session data format, clearing');
        this.clearSession();
        return [];
      }

      console.log(`📬 Loaded ${sessionData.messages.length} messages from session`);
      return sessionData.messages;
    } catch (error) {
      console.error('Failed to load messages from localStorage:', error);
      // Clear corrupted data
      this.clearSession();
      return [];
    }
  }

  /**
   * Get session created timestamp
   */
  private getSessionCreatedAt(): number {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const sessionData: SessionData = JSON.parse(stored);
        return sessionData.createdAt || Date.now();
      }
    } catch (error) {
      // Ignore errors
    }
    return Date.now();
  }

  /**
   * Check if session is expired
   */
  private isSessionExpired(sessionData: SessionData): boolean {
    const expiryTime = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const age = Date.now() - sessionData.createdAt;
    return age > expiryTime;
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    const storageKey = this.getStorageKey(MESSAGES_KEY);
    localStorage.removeItem(storageKey);
    console.log('🗑️ Session cleared');
  }

  /**
   * Start a new session (clear old and create new IDs)
   */
  startNewSession(): void {
    this.clearSession();
    
    // Clear session and thread IDs
    localStorage.removeItem(this.getStorageKey(SESSION_ID_KEY));
    localStorage.removeItem(this.getStorageKey(THREAD_ID_KEY));
    
    // Create new IDs
    this.sessionId = this.getOrCreateSessionId();
    this.threadId = this.getOrCreateThreadId();
    
    console.log('🆕 Started new session');
  }

  /**
   * Clear old messages to free up space (keep last 50 messages)
   */
  private clearOldMessages(): void {
    const messages = this.loadMessages();
    if (messages.length > 50) {
      const recentMessages = messages.slice(-50);
      this.saveMessages(recentMessages);
      console.log(`🧹 Cleared old messages, kept ${recentMessages.length} recent messages`);
    }
  }

  /**
   * Clean up expired sessions from localStorage
   */
  private cleanupExpiredSessions(): void {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        const sessionData: SessionData = JSON.parse(stored);
        if (this.isSessionExpired(sessionData)) {
          this.clearSession();
          console.log('🧹 Cleaned up expired session');
        }
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  /**
   * Get session metadata
   */
  getSessionMetadata(): { sessionId: string; threadId: string; messageCount: number; age: number } {
    const messages = this.loadMessages();
    const createdAt = this.getSessionCreatedAt();
    const age = Date.now() - createdAt;
    
    return {
      sessionId: this.sessionId,
      threadId: this.threadId,
      messageCount: messages.length,
      age
    };
  }

  /**
   * Export session data (for debugging or migration)
   */
  exportSession(): SessionData | null {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Failed to export session:', error);
      return null;
    }
  }

  /**
   * Import session data (for debugging or migration)
   */
  importSession(sessionData: SessionData): void {
    try {
      const storageKey = this.getStorageKey(MESSAGES_KEY);
      localStorage.setItem(storageKey, JSON.stringify(sessionData));
      this.sessionId = sessionData.sessionId;
      this.threadId = sessionData.threadId;
      console.log('📥 Imported session data');
    } catch (error) {
      console.error('Failed to import session:', error);
    }
  }
}

/**
 * Global session manager instance (singleton per tenant)
 */
const sessionManagers = new Map<string, SessionManager>();

export function getSessionManager(tenantId?: string): SessionManager {
  const key = tenantId || 'default';
  
  if (!sessionManagers.has(key)) {
    sessionManagers.set(key, new SessionManager(tenantId));
  }
  
  return sessionManagers.get(key)!;
}
