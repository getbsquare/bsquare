import React, { useState, useEffect, useRef } from 'react';
import { useAGUI } from '../hooks/useAGUI';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import InlineChart from './InlineChart';

// ---- Brand mark + icons (Lucide-style, inherit currentColor) -------------
const BrandMark = ({ size = 30, className }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="7" y="17" width="38" height="38" rx="11" fill="currentColor" />
    <rect x="17.5" y="27.5" width="17" height="17" rx="5" stroke="var(--mark-cut, #0b0f15)" strokeWidth="3.2" />
    <rect x="44" y="9" width="13" height="13" rx="4" fill="currentColor" fillOpacity="0.55" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2L11 13"></path>
    <path d="M22 2L15 22L11 13L2 9L22 2z"></path>
  </svg>
);

const MinimizeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const NewConversationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" />
  </svg>
);

const BoltIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" /></svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);

// An agent turn: small brand avatar + content bubble.
// Declared at module scope so its component identity is stable across renders —
// if it were defined inside ChatInterface, every keystroke would remount these
// rows and replay the fade-in animation.
const AgentRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bsquare-widget-message assistant">
    <span className="bsquare-widget-avatar sm" aria-hidden="true">B</span>
    <div className="bsquare-widget-bubble">{children}</div>
  </div>
);

interface ChatInterfaceProps {
  apiUrl: string;
  sessionId?: string;
  theme?: 'light' | 'dark';
  primaryColor?: string;
  apiToken?: string;
  tenantId?: string;
  onWidgetEvent?: (type: string, data: any) => void;
  hostActions?: any[];
  onExecuteHostAction?: (actionName: string, params: any) => Promise<any>;
  showNewConversationButton?: boolean;
  agentName?: string;
  welcomeMessage?: string;
  toolDisplay?: 'minimal' | 'detailed';
  toolLabel?: string | ((toolName: string) => string);
  suggestions?: string[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ apiUrl, sessionId, theme = 'dark', primaryColor, apiToken, tenantId, onWidgetEvent, hostActions, onExecuteHostAction, showNewConversationButton = true, agentName = 'Assistant', welcomeMessage, toolDisplay = 'minimal', toolLabel, suggestions }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [showNewConversationConfirm, setShowNewConversationConfirm] = useState(false);
  const { messages, sendMessage, isLoading, startNewSession } = useAGUI(apiUrl, apiToken, tenantId, hostActions, onExecuteHostAction);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showChartModal, setShowChartModal] = useState(false);
  const [modalChartSpec, setModalChartSpec] = useState<any | null>(null);
  const [modalChartTitle, setModalChartTitle] = useState<string | null>(null);

  // Generate hover color (slightly darker version of primary color)
  const generateHoverColor = (color: string): string => {
    // Convert hex to RGB, darken by 10%, then back to hex
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - 25);
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - 25);
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - 25);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Create dynamic styles for color customization
  const customStyles = primaryColor ? {
    '--accent-primary': primaryColor,
    '--accent-primary-hover': generateHoverColor(primaryColor),
  } as React.CSSProperties : {};

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(scrollToBottom, 10);
  }, [messages, isLoading]);

  // Additional effect to ensure scrolling happens when messages change,
  // especially for async tool results that might be added after loading completes
  useEffect(() => {
    setTimeout(scrollToBottom, 50);
  }, [messages]);

  // Auto-focus input when it becomes active again
  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  const handleSendMessage = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || isLoading) return;

    // Notify host about message being sent
    onWidgetEvent?.('message-sending', { content });

    await sendMessage(content);
    if (override === undefined) setInput('');

    // Notify host about message sent
    onWidgetEvent?.('message-sent', { content });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    onWidgetEvent?.('widget-minimized', { timestamp: Date.now() });
  };

  const handleMaximize = () => {
    setIsMinimized(false);
    onWidgetEvent?.('widget-maximized', { timestamp: Date.now() });
  };

  // Notify host when widget mounts
  useEffect(() => {
    onWidgetEvent?.('widget-mounted', {
      theme,
      apiUrl,
      timestamp: Date.now()
    });

    return () => {
      onWidgetEvent?.('widget-unmounting', { timestamp: Date.now() });
    };
  }, []);

  // Notify host when messages change
  useEffect(() => {
    if (messages.length > 0) {
      onWidgetEvent?.('messages-updated', {
        messageCount: messages.length,
        lastMessage: messages[messages.length - 1]
      });
    }
  }, [messages]);

  // Chart modal helpers
  const openChartModal = (spec: any, title?: string) => {
    setModalChartSpec(spec);
    setModalChartTitle(title || spec?.title || null);
    setShowChartModal(true);
  };

  const closeChartModal = () => {
    setShowChartModal(false);
  };

  if (isMinimized) {
    return (
      <div className="bsquare-widget-container minimized" data-theme={theme} style={customStyles}>
        <button
          className="bsquare-widget-toggle-button"
          onClick={handleMaximize}
          title="Open BSquare Assistant"
        >
          <span className="bsquare-widget-ping" aria-hidden="true" />
          <BrandMark size={30} className="bsquare-widget-launch-mark" />
          <span className="bsquare-widget-online" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="bsquare-widget-container" data-theme={theme} style={customStyles}>
      <div className="bsquare-widget-header">
        <span className="bsquare-widget-avatar" aria-hidden="true">B</span>
        <div className="bsquare-widget-head-meta">
          <div className="bsquare-widget-name">{agentName}</div>
          <div className="bsquare-widget-status"><span className="dot" /> Online · acts on this page</div>
        </div>
        <div className="bsquare-widget-header-buttons">
          {showNewConversationButton && (
            <button
              className="bsquare-widget-header-button"
              onClick={() => setShowNewConversationConfirm(true)}
              title="New Conversation"
            >
              <NewConversationIcon />
            </button>
          )}
          <button
            className="bsquare-widget-header-button"
            onClick={handleMinimize}
            title="Minimize"
          >
            <MinimizeIcon />
          </button>
        </div>
      </div>

      <div className="bsquare-widget-chat-area">
        <div className="bsquare-widget-messages">
          {showNewConversationConfirm && (
            <div className="bsquare-widget-confirmation-overlay">
              <div className="bsquare-widget-confirmation-dialog">
                <div className="bsquare-widget-confirmation-title">Start New Conversation?</div>
                <div className="bsquare-widget-confirmation-message">
                  This will clear your current chat history and start fresh.
                </div>
                <div className="bsquare-widget-confirmation-buttons">
                  <button
                    className="bsquare-widget-confirmation-button cancel"
                    onClick={() => setShowNewConversationConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="bsquare-widget-confirmation-button confirm"
                    onClick={() => {
                      setShowNewConversationConfirm(false);
                      startNewSession();
                      if (onWidgetEvent) {
                        onWidgetEvent('new_conversation', { timestamp: Date.now() });
                      }
                    }}
                  >
                    Start New
                  </button>
                </div>
              </div>
            </div>
          )}

          {messages.length === 0 && (
            <AgentRow>{welcomeMessage || "Hi — I'm your BSquare assistant. Ask me anything, or tell me what to do on this page."}</AgentRow>
          )}

          {messages
            .filter(message => {
              // Filter out empty assistant messages that are only for tool call tracking
              if (message.role === 'assistant' && (!message.content || message.content.trim() === '') && (message as any).tool_calls) {
                return false;
              }
              return true;
            })
            .map((message) => {
              if (message.role === 'tool') {
                const m: any = message as any;
                if (m.uiBlock && m.uiBlock.type === 'chart') {
                  return (
                    <AgentRow key={message.message_id}>
                      {m.toolName ? <div className="tool-action-name">{m.toolName}</div> : null}
                      <div className="bsquare-widget-chart-wrapper" onClick={() => openChartModal(m.uiBlock.spec, m.uiBlock.spec?.title)}>
                        <InlineChart spec={m.uiBlock.spec} />
                        <div className="bsquare-widget-chart-hint">Click to enlarge</div>
                      </div>
                    </AgentRow>
                  );
                }
                // Host-action / tool indicator rendered as a mono tool card.
                // Label is configurable (string, function, or the raw tool name);
                // `detailed` mode also shows the tool's result row.
                const toolText = typeof toolLabel === 'function'
                  ? toolLabel(m.toolName || '')
                  : (toolLabel || m.toolName || 'action');
                return (
                  <AgentRow key={message.message_id}>
                    <div className="bsquare-widget-tool">
                      <div className="top">
                        <span className="ic"><BoltIcon /></span>
                        <span className="fn">{toolText}</span>
                        <span className="ok"><CheckIcon /></span>
                      </div>
                      {toolDisplay === 'detailed' && m.content ? (
                        <div className="res"><span className="arrow">→</span> {m.content}</div>
                      ) : null}
                    </div>
                  </AgentRow>
                );
              }
              if (message.role === 'user') {
                return (
                  <div key={message.message_id} className="bsquare-widget-message user">
                    {message.content}
                  </div>
                );
              }
              return (
                <AgentRow key={message.message_id}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
                      code: ({ children }) => <code className="bsquare-widget-inline-code">{children}</code>,
                      pre: ({ children }) => <pre className="bsquare-widget-pre">{children}</pre>
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </AgentRow>
              );
            })}

          {isLoading && (
            <AgentRow>
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </AgentRow>
          )}
          <div ref={messagesEndRef} />
        </div>
        {showChartModal && (
          <div className="bsquare-widget-modal-overlay" onClick={closeChartModal}>
            <div className="bsquare-widget-modal" onClick={(e) => e.stopPropagation()}>
              <div className="bsquare-widget-modal-header">
                <div className="bsquare-widget-modal-title">{modalChartTitle || 'Chart'}</div>
                <button className="bsquare-widget-modal-close" onClick={closeChartModal} aria-label="Close">×</button>
              </div>
              <div className="bsquare-widget-modal-body">
                {modalChartSpec && (
                  <InlineChart spec={{
                    ...modalChartSpec,
                    width: modalChartSpec.width || 880,
                    height: modalChartSpec.height || 420
                  }} />
                )}
              </div>
            </div>
          </div>
        )}

        {suggestions && suggestions.length > 0 && messages.length === 0 && !isLoading && (
          <div className="bsquare-widget-suggestions">
            {suggestions.map((s, i) => (
              <button key={i} className="bsquare-widget-chip" onClick={() => handleSendMessage(s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="bsquare-widget-input-form">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask anything, or tell me what to do…"
            className="bsquare-widget-input"
            disabled={isLoading}
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={isLoading || !input.trim()}
            className="bsquare-widget-send-button"
            title="Send Message"
          >
            <SendIcon />
          </button>
        </div>
        <div className="bsquare-widget-powered">
          <BrandMark size={11} /> Powered by BSquare
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
