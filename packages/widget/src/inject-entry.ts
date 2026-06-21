import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

interface HostAction {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: string;
      description: string;
      required?: boolean;
    };
  };
  handler: (params: any) => Promise<any> | any;
}

interface HostMessageHandler {
  type: string;
  description?: string;
  handler: (data: any) => void;
}

export interface BSquareAssistantConfig {
  apiUrl?: string;
  sessionId?: string;
  theme?: 'light' | 'dark';
  primaryColor?: string;
  apiToken?: string;
  tenantId?: string;
  containerId?: string;
  showNewConversationButton?: boolean;
  agentName?: string;
  welcomeMessage?: string;
  toolDisplay?: 'minimal' | 'detailed';
  toolLabel?: string | ((toolName: string) => string);
  suggestions?: string[];
  onHostMessage?: (data: any) => void;
  hostActions?: HostAction[];
  hostMessageHandlers?: HostMessageHandler[];
}

interface HostMessage {
  type: string;
  data?: any;
  timestamp: number;
}

class BSquareAssistant {
  private config: BSquareAssistantConfig;
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private root: any | null = null;
  private hostMessageHandlers: Map<string, (data: any) => void> = new Map();
  private hostActions: Map<string, HostAction> = new Map();
  private isDestroyed: boolean = false;

  constructor(config: BSquareAssistantConfig = {}) {
    this.config = {
      apiUrl: 'http://localhost:8001',
      theme: 'dark',
      containerId: 'bsquare-container',
      ...config
    };

    // Register host actions
    if (this.config.hostActions) {
      this.config.hostActions.forEach(action => {
        this.hostActions.set(action.name, action);
      });
    }

    // Register host message handlers
    if (this.config.hostMessageHandlers) {
      this.config.hostMessageHandlers.forEach(handler => {
        this.hostMessageHandlers.set(handler.type, handler.handler);
      });
    }
  }

  async mount(containerId?: string): Promise<void> {
    const targetId = containerId || this.config.containerId || 'bsquare-container';

    // Load the BSquare brand fonts into the host document (once)
    this.injectFontLink();

    // Find or create container
    this.container = document.getElementById(targetId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = targetId;
      this.container.className = 'bsquare-widget-container-root';
      document.body.appendChild(this.container);
    }

    // Create Shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });
    
    // Create a div inside shadow DOM for React mounting
    const reactContainer = document.createElement('div');
    reactContainer.className = 'bsquare-react-root';
    
    // Append React container to shadow DOM first
    this.shadowRoot.appendChild(reactContainer);
    
    // Inject CSS styles into Shadow DOM
    this.injectStyles();

    // Create React root and render inside Shadow DOM
    this.root = createRoot(reactContainer);
    this.root.render(
      React.createElement(React.StrictMode, null,
        React.createElement(App, {
          apiUrl: this.config.apiUrl,
          sessionId: this.config.sessionId,
          theme: this.config.theme,
          primaryColor: this.config.primaryColor,
          apiToken: this.config.apiToken,
          tenantId: this.config.tenantId,
          showNewConversationButton: this.config.showNewConversationButton !== undefined ? this.config.showNewConversationButton : true,
          agentName: this.config.agentName,
          welcomeMessage: this.config.welcomeMessage,
          toolDisplay: this.config.toolDisplay,
          toolLabel: this.config.toolLabel,
          suggestions: this.config.suggestions,
          onWidgetEvent: (type: string, data: any) => this.sendToHost(type, data),
          hostActions: this.getHostActionsForAgent(),
          onExecuteHostAction: (actionName: string, params: any) => this.executeHostAction(actionName, params),
        })
      )
    );

    // Set up host-to-widget communication
    this.setupHostCommunication();
  }

  private injectFontLink(): void {
    if (typeof document === 'undefined') return;
    const id = 'bsquare-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }

  private injectStyles(): void {
    if (!this.shadowRoot) return;
    
    // Create style element with complete CSS
    const style = document.createElement('style');
    
    // Inject all widget CSS directly into Shadow DOM
    style.textContent = this.getWidgetCSS();
    this.shadowRoot.appendChild(style);
  }

  private getWidgetCSS(): string {
    return `
/* Global Styles */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Brand font stack (loaded into the host document head on mount) */
:host {
  font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  all: initial;
  display: block;
}

/* ============================================================
   BSquare design tokens — dark-first brand, scoped to the widget.
   Vars live on the mount root (inherited by the container + children);
   the LIGHT override is keyed on the container's data-theme attribute.
   ============================================================ */
.bsquare-react-root {
  --font-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Space Grotesk', 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', 'Menlo', monospace;

  /* brand palette + signature treatments */
  --blue-300: #86a9f6;
  --blue-400: #5285ec;
  --blue-500: #2a6fdb;
  --green-400: #34c77f;
  --brand-gradient: linear-gradient(135deg, #2a6fdb 0%, #5285ec 100%);
  --shadow-widget: 0 24px 60px -18px rgba(2, 5, 12, 0.7), 0 4px 14px -4px rgba(2, 5, 12, 0.5);
  --radius-md: 9px;
  --radius-lg: 13px;
  --radius-xl: 18px;
  --radius-pill: 999px;

  /* DARK theme (brand default) mapped onto the widget's structural vars */
  --bg-primary: #11161e;
  --bg-secondary: #171d26;
  --text-primary: #f5f8fc;
  --text-secondary: #c7d0db;
  --border-primary: #ffffff1f;
  --accent-primary: #2a6fdb;
  --accent-primary-hover: #5285ec;
  --accent-soft: #2a6fdb24;
  --accent-soft-border: #2a6fdb52;
  --accent-text: #ffffff;
  --shadow-xl: var(--shadow-widget);
}

/* LIGHT theme override (data-theme lives on .bsquare-widget-container) */
.bsquare-widget-container[data-theme='light'] {
  --bg-primary: #ffffff;
  --bg-secondary: #f4f6f9;
  --text-primary: #0d1422;
  --text-secondary: #475467;
  --border-primary: #0d14221f;
  --accent-primary: #2a6fdb;
  --accent-primary-hover: #1f57bb;
  --accent-soft: #2a6fdb14;
  --accent-soft-border: #2a6fdb3d;
  --shadow-xl: 0 24px 60px -18px rgba(13, 20, 34, 0.22), 0 4px 14px -4px rgba(13, 20, 34, 0.1);
}

/* Main Widget Container */
.bsquare-widget-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 400px;
  max-width: calc(100vw - 40px);
  height: 600px;
  max-height: calc(100vh - 40px);
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-primary);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--font-sans);
  transition: width 0.3s ease, height 0.3s ease, opacity 0.3s ease;
  opacity: 1;
}

.bsquare-widget-container.minimized {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-xl);
  cursor: pointer;
  overflow: visible;
}

/* Minimized launcher — brand-gradient squircle with online dot */
.bsquare-widget-toggle-button {
  position: relative;
  background: var(--brand-gradient);
  color: var(--accent-text);
  border: none;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-xl);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-widget);
  transition: transform 0.22s cubic-bezier(0.34, 1.32, 0.5, 1), box-shadow 0.22s ease;
}

.bsquare-widget-launch-mark {
  color: #ffffff;
  --mark-cut: #1f57bb;
}

.bsquare-widget-online {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--green-400);
  border: 3px solid #0b0f15;
}

.bsquare-widget-ping {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-xl);
  border: 2px solid var(--blue-400);
  animation: bsquare-ping 2.4s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
}

@keyframes bsquare-ping {
  0% { transform: scale(1); opacity: 0.5; }
  70%, 100% { transform: scale(1.5); opacity: 0; }
}

.bsquare-widget-toggle-button:hover {
  transform: translateY(-2px) scale(1.04);
}

/* Widget Header — avatar + name/status + actions */
.bsquare-widget-header {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid var(--border-primary);
  background: linear-gradient(180deg, rgba(42, 111, 219, 0.07), transparent);
  flex-shrink: 0;
}

.bsquare-widget-avatar {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--brand-gradient);
  color: #ffffff;
  border: 1px solid var(--border-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  user-select: none;
}

.bsquare-widget-avatar.sm {
  width: 24px;
  height: 24px;
  font-size: 11px;
}

.bsquare-widget-head-meta {
  flex: 1;
  min-width: 0;
}

.bsquare-widget-name {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  line-height: 1.1;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.bsquare-widget-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.bsquare-widget-status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green-400);
}

.bsquare-widget-header-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bsquare-widget-header-button {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;
}

.bsquare-widget-header-button:hover {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.bsquare-widget-header-button:active {
  transform: scale(0.95);
}

/* Chat Area */
.bsquare-widget-chat-area {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bsquare-widget-messages {
  flex-grow: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  scrollbar-width: thin;
  scrollbar-color: var(--border-primary) transparent;
}

/* Themed scrollbar (WebKit) — replaces the OS-native one */
.bsquare-widget-messages::-webkit-scrollbar {
  width: 8px;
}

.bsquare-widget-messages::-webkit-scrollbar-track {
  background: transparent;
}

.bsquare-widget-messages::-webkit-scrollbar-thumb {
  background: var(--border-primary);
  border-radius: var(--radius-pill);
}

.bsquare-widget-messages::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* Confirmation Dialog */
.bsquare-widget-confirmation-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.bsquare-widget-confirmation-dialog {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: 24px;
  max-width: 320px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-primary);
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.bsquare-widget-confirmation-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.bsquare-widget-confirmation-message {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
}

.bsquare-widget-confirmation-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.bsquare-widget-confirmation-button {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bsquare-widget-confirmation-button.cancel {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.bsquare-widget-confirmation-button.cancel:hover {
  background: var(--border-primary);
}

.bsquare-widget-confirmation-button.confirm {
  background: var(--accent-primary);
  color: var(--accent-text);
}

.bsquare-widget-confirmation-button.confirm:hover {
  background: var(--accent-primary-hover);
}

.bsquare-widget-confirmation-button:active {
  transform: scale(0.95);
}

/* Chart Modal */
.bsquare-widget-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  animation: fadeIn 0.2s ease;
}

.bsquare-widget-modal {
  background: var(--bg-primary);
  border-radius: 12px;
  border: 1px solid var(--border-primary);
  box-shadow: var(--shadow-xl);
  width: min(920px, calc(100vw - 80px));
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bsquare-widget-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}

.bsquare-widget-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.bsquare-widget-modal-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.bsquare-widget-modal-close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.bsquare-widget-modal-body {
  padding: 12px 16px 16px 16px;
  overflow: auto;
  background: var(--bg-primary);
}

.bsquare-widget-chart-wrapper {
  cursor: zoom-in;
}

.bsquare-widget-chart-hint {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  text-align: right;
  opacity: 0.8;
}

/* Individual Messages */
.bsquare-widget-message {
  max-width: 85%;
  line-height: 1.55;
  word-wrap: break-word;
  font-size: 14px;
  animation: bsquare-msg-in 0.22s cubic-bezier(0.22, 0.61, 0.36, 1);
}

@keyframes bsquare-msg-in {
  from { transform: translateY(6px); opacity: 0.4; }
  to { transform: none; opacity: 1; }
}

/* user = accent-soft bubble, right-aligned */
.bsquare-widget-message.user {
  background: var(--accent-soft);
  border: 1px solid var(--accent-soft-border);
  color: var(--text-primary);
  align-self: flex-end;
  padding: 9px 13px;
  border-radius: 14px 14px 4px 14px;
}

/* agent turn = small brand avatar + plain content bubble */
.bsquare-widget-message.assistant {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  align-self: flex-start;
  max-width: 100%;
  background: none;
  border: none;
  padding: 0;
}

.bsquare-widget-bubble {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.bsquare-widget-bubble > :first-child { margin-top: 0; }
.bsquare-widget-bubble > :last-child { margin-bottom: 0; }
.bsquare-widget-bubble strong { color: var(--text-primary); font-weight: 600; }

.bsquare-widget-inline-code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--blue-300);
}

.bsquare-widget-pre {
  background: #0a0e14;
  border: 1px solid var(--border-primary);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  color: #c7d0db;
}

/* host-action / tool card (mono) */
.bsquare-widget-tool {
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  overflow: hidden;
  max-width: 100%;
}

.bsquare-widget-tool .top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.bsquare-widget-tool .ic { display: flex; color: var(--blue-300); }
.bsquare-widget-tool .fn { color: var(--text-primary); }
.bsquare-widget-tool .ok { margin-left: auto; display: flex; color: var(--green-400); }

.bsquare-widget-tool .res {
  border-top: 1px solid var(--border-primary);
  padding: 8px 11px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-secondary);
  background: #0a0e14;
  white-space: pre-wrap;
  word-break: break-word;
}

.bsquare-widget-tool .res .arrow { color: var(--green-400); margin-right: 4px; }

.tool-action-name {
  font-family: var(--font-mono);
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.8;
}

.bsquare-widget-message em {
  color: var(--text-secondary);
  font-style: italic;
}

/* Starter-prompt suggestion chips (shown above the composer until the chat starts) */
.bsquare-widget-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 0 16px 10px;
  flex-shrink: 0;
}

.bsquare-widget-chip {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--accent-primary);
  background: var(--accent-soft);
  border: 1px solid var(--accent-soft-border);
  padding: 6px 11px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.bsquare-widget-chip:hover {
  border-color: var(--accent-primary);
}

.bsquare-widget-chip:active {
  transform: scale(0.97);
}

/* "Powered by BSquare" footer */
.bsquare-widget-powered {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 0 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  opacity: 0.7;
  flex-shrink: 0;
}

/* Input Form */
.bsquare-widget-input-form {
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.bsquare-widget-input {
  flex-grow: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  outline: none;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.bsquare-widget-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.bsquare-widget-input:disabled {
  background-color: var(--bg-secondary);
  cursor: not-allowed;
}

.bsquare-widget-send-button {
  background: var(--accent-primary);
  color: var(--accent-text);
  border: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.bsquare-widget-send-button:hover {
  background: var(--accent-primary-hover);
}

.bsquare-widget-send-button:active {
  transform: scale(0.95);
}

.bsquare-widget-send-button:disabled {
  background: var(--border-primary);
  color: var(--text-secondary);
  cursor: not-allowed;
  transform: scale(1);
}

/* Typing Indicator Animation */
.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
}

.typing-indicator span {
  height: 8px;
  width: 8px;
  background-color: var(--text-secondary);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {
  0%, 80%, 100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
`;
  }

  private async loadExternalCSS(): Promise<void> {
    if (!this.shadowRoot) return;
    
    // Try to find the CSS file that was built with the widget
    const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .filter(link => (link as HTMLLinkElement).href.includes('ltc-ally-assistant'));
    
    if (cssLinks.length > 0) {
      const cssLink = cssLinks[0] as HTMLLinkElement;
      
      try {
        const response = await fetch(cssLink.href);
        const cssText = await response.text();
        
        const style = document.createElement('style');
        style.textContent = cssText;
        this.shadowRoot.appendChild(style);
      } catch (error) {
        console.warn('Failed to fetch external CSS:', error);
      }
    }
  }

  // Host Communication Methods
  private setupHostCommunication(): void {
    if (!this.container) return;

    // Listen for messages from host to widget
    const messageHandler = (event: CustomEvent) => {
      if (this.isDestroyed) return;
      
      const message = event.detail as HostMessage;
      this.handleHostMessage(message);
    };

    this.container.addEventListener('bsquare-host-message', messageHandler as EventListener);
  }

  private handleHostMessage(message: HostMessage): void {
    const { type, data } = message;

    // Call registered handler for this message type
    const handler = this.hostMessageHandlers.get(type);
    if (handler) {
      handler(data);
    }

    // Call global callback if provided
    if (this.config.onHostMessage) {
      this.config.onHostMessage({ type, data });
    }
  }

  public sendToHost(type: string, data?: any): void {
    if (!this.container || this.isDestroyed) return;

    const event = new CustomEvent('bsquare-widget-message', {
      bubbles: true,
      composed: true,
      detail: {
        type,
        data,
        timestamp: Date.now()
      }
    });

    this.container.dispatchEvent(event);
  }

  public onHostMessage(type: string, handler: (data: any) => void): void {
    this.hostMessageHandlers.set(type, handler);
  }

  public sendMessageToWidget(type: string, data?: any): void {
    if (!this.container || this.isDestroyed) return;

    const event = new CustomEvent('bsquare-host-message', {
      detail: {
        type,
        data,
        timestamp: Date.now()
      }
    });

    this.container.dispatchEvent(event);
  }

  // Host Actions Methods
  private getHostActionsForAgent(): any[] {
    return Array.from(this.hostActions.values()).map(action => ({
      name: action.name,
      description: action.description,
      parameters: action.parameters
    }));
  }

  private async executeHostAction(actionName: string, params: any): Promise<any> {
    const action = this.hostActions.get(actionName);
    if (!action) {
      throw new Error(`Host action '${actionName}' not found`);
    }

    try {
      // Log the action execution
      this.sendToHost('host-action-executing', { 
        action: actionName, 
        params 
      });

      const result = await action.handler(params);
      
      // Log successful completion
      this.sendToHost('host-action-completed', { 
        action: actionName, 
        params, 
        result 
      });

      return result;
    } catch (error) {
      // Log error
      this.sendToHost('host-action-error', { 
        action: actionName, 
        params, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  public registerHostAction(action: HostAction): void {
    this.hostActions.set(action.name, action);
    
    // Notify widget about new action availability
    this.sendToHost('host-actions-updated', {
      actions: this.getHostActionsForAgent()
    });
  }

  public unregisterHostAction(actionName: string): void {
    this.hostActions.delete(actionName);
    
    // Notify widget about action removal
    this.sendToHost('host-actions-updated', {
      actions: this.getHostActionsForAgent()
    });
  }

  public getAvailableHostActions(): string[] {
    return Array.from(this.hostActions.keys());
  }

  public getWidgetInfo(): any {
    return {
      mounted: !!this.root,
      config: { ...this.config, onHostMessage: undefined, hostActions: undefined }, // Exclude functions
      containerId: this.container?.id,
      isDestroyed: this.isDestroyed,
      availableHostActions: this.getAvailableHostActions()
    };
  }

  unmount(): void {
    this.isDestroyed = true;
    this.hostMessageHandlers.clear();
    
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
    this.shadowRoot = null;
  }

  updateConfig(newConfig: Partial<BSquareAssistantConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.root && this.container) {
      // Re-render with new config
      this.root.render(
        React.createElement(React.StrictMode, null,
          React.createElement(App, {
            apiUrl: this.config.apiUrl,
            sessionId: this.config.sessionId,
            theme: this.config.theme
          })
        )
      );
    }
  }
}

// Export for UMD build
declare global {
  interface Window {
    BSquareAssistant: typeof BSquareAssistant;
  }
}

// Directly assign to window and export as default
if (typeof window !== 'undefined') {
  window.BSquareAssistant = BSquareAssistant;
}

// Export as both default and named export to ensure webpack picks it up correctly
export { BSquareAssistant };
export default BSquareAssistant;
