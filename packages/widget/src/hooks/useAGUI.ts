import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSessionManager, StoredMessage } from '../utils/sessionManager';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  message_id: string;
  toolName?: string;
  uiBlock?: {
    type: 'chart';
    spec: any;
  };
}

interface RunAgentInput {
  thread_id: string;
  run_id: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    id: string;
  }>;
  tools: any[];
  context: any[];
  state: any;
  forwardedProps: any;
}

export const useAGUI = (apiUrl: string, apiToken?: string, tenantId?: string, hostActions?: any[], onExecuteHostAction?: (actionName: string, params: any) => Promise<any>) => {
  const sessionManager = getSessionManager(tenantId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const toolCallDataRef = useRef<Record<string, { name: string; args: string; messageId: string }>>({});
  const backendToolResultsRef = useRef<Record<string, string>>({});

  // Load messages from session on mount
  useEffect(() => {
    const storedMessages = sessionManager.loadMessages();
    if (storedMessages.length > 0) {
      setMessages(storedMessages as Message[]);
      console.log(`🔄 Restored ${storedMessages.length} messages from session`);
    }
    setSessionRestored(true);
  }, []);

  // Save messages to session whenever they change
  useEffect(() => {
    if (sessionRestored && messages.length > 0) {
      const storedMessages: StoredMessage[] = messages.map(msg => ({
        ...msg,
        timestamp: Date.now()
      }));
      sessionManager.saveMessages(storedMessages);
    }
  }, [messages, sessionRestored]);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      role: 'user',
      content,
      message_id: uuidv4()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const aguiMessages = [...messages, userMessage].map(msg => {
        const aguiMsg: any = {
          role: msg.role as 'user' | 'assistant' | 'tool',
          content: msg.content,
          id: msg.message_id
        };
        
        // Include toolCallId as top-level property for tool messages per AG-UI spec
        if (msg.role === 'tool' && (msg as any).tool?.toolCallId) {
          aguiMsg.toolCallId = (msg as any).tool.toolCallId;
        }
        
        // Include tool_calls for assistant messages with tool calls
        if (msg.role === 'assistant' && (msg as any).tool_calls) {
          aguiMsg.tool_calls = (msg as any).tool_calls;
        }
        
        return aguiMsg;
      });

      // Debug: log message history being sent
      console.log('📤 Sending message history to backend:');
      aguiMessages.forEach((msg, i) => {
        if (msg.role === 'tool') {
          console.log(`  [${i}] tool: "${msg.content?.substring(0, 60)}..." toolCallId=${msg.toolCallId}`);
        } else if (msg.tool_calls) {
          console.log(`  [${i}] assistant with ${msg.tool_calls.length} tool_calls:`, msg.tool_calls.map((tc: any) => tc.function?.name));
        } else {
          console.log(`  [${i}] ${msg.role}: "${msg.content?.substring(0, 60)}..."`);
        }
      });

      // Don't send host actions as tools to backend - they're handled via state communication now
      const aguiTools: any[] = [];

      const currentThreadId = sessionManager.getThreadId();
      const currentRunId = uuidv4();
      
      const requestBody: RunAgentInput = {
        thread_id: currentThreadId,
        run_id: currentRunId,
        messages: aguiMessages,
        tools: aguiTools,
        context: [],
        state: {
          api_token: apiToken || null,
          pending_host_action: null,
          host_action_result: null
        },
        forwardedProps: {}
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };

      // Add Authorization header if API token is provided
      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      // Add X-Tenant-ID header if tenant ID is provided
      if (tenantId) {
        headers['X-Tenant-ID'] = tenantId;
      }

      const response = await fetch(`${apiUrl}/agent`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      let assistantMessage = '';
      let currentMessageId = uuidv4();

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              
              // Log all events to debug ordering
              if (['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT'].includes(eventData.type)) {
                console.log(`📡 Event: ${eventData.type}`, eventData.toolCallId || eventData.toolCallName);
              }
              
              if (eventData.type === 'TEXT_MESSAGE_CONTENT') {
                assistantMessage += eventData.delta || '';
                
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  
                  if (lastMessage && lastMessage.role === 'assistant' && lastMessage.message_id === currentMessageId) {
                    lastMessage.content = assistantMessage;
                  } else {
                    newMessages.push({
                      role: 'assistant',
                      content: assistantMessage,
                      message_id: currentMessageId
                    });
                  }
                  
                  return newMessages;
                });
              }

              // Handle tool calls (host actions) - collect tool info
              if (eventData.type === 'TOOL_CALL_START' && eventData.toolCallId && eventData.toolCallName) {
                console.log('🔍 TOOL_CALL_START received:', eventData.toolCallName, eventData.toolCallId);
                // Store tool call info for when we get the arguments
                const messageId = uuidv4();
                toolCallDataRef.current[eventData.toolCallId] = {
                  name: eventData.toolCallName,
                  args: '',
                  messageId: messageId
                };

                console.log('🔍 Stored tool data. All tool data now:', Object.keys(toolCallDataRef.current));
                
                // Add tool call message to conversation history
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: '',
                  message_id: messageId,
                  tool_calls: [{
                    id: eventData.toolCallId,
                    type: 'function',
                    function: {
                      name: eventData.toolCallName,
                      arguments: ''
                    }
                  }]
                } as any]);
              }
              
              if (eventData.type === 'TOOL_CALL_ARGS') {
                // Accumulate arguments and update the tool call message
                if (toolCallDataRef.current[eventData.toolCallId]) {
                  toolCallDataRef.current[eventData.toolCallId].args += eventData.delta || '';

                  // Update the assistant message with accumulated arguments
                  const toolData = toolCallDataRef.current[eventData.toolCallId];
                  if (toolData && toolData.messageId) {
                    setMessages(prev => prev.map(msg => {
                      if (msg.message_id === toolData.messageId) {
                        const updatedMsg = { ...msg } as any;
                        if (updatedMsg.tool_calls && updatedMsg.tool_calls[0]) {
                          updatedMsg.tool_calls[0].function.arguments = toolData.args;
                        }
                        return updatedMsg;
                      }
                      return msg;
                    }));
                  }
                }
              }
              
              // Handle backend tool results
              if (eventData.type === 'TOOL_CALL_RESULT') {
                console.log('🔍 TOOL_CALL_RESULT received:', eventData.toolCallId);
                const toolData = toolCallDataRef.current[eventData.toolCallId];

                console.log('🔍 Tool data lookup:', {
                  toolCallId: eventData.toolCallId,
                  hasToolData: !!toolData,
                  toolName: toolData?.name,
                  allToolData: Object.keys(toolCallDataRef.current)
                });

                if (toolData) {
                  // Check if this is a host action
                  const matchingHostAction = hostActions?.find(action => action.name === toolData.name);

                  console.log('🔍 Host action check:', {
                    toolName: toolData.name,
                    isHostAction: !!matchingHostAction,
                    hasHostActions: !!hostActions,
                    hostActionCount: hostActions?.length
                  });

                  if (matchingHostAction && onExecuteHostAction) {
                    // Host action - store backend result for later use in TOOL_CALL_END
                    console.log(`📥 Storing backend result for host action ${toolData.name}`);
                    backendToolResultsRef.current[eventData.toolCallId] = eventData.content || '';
                  } else {
                    // Regular backend tool - add message immediately
                    console.log(`📥 Adding backend tool result for ${toolData.name}`);
                    setMessages(prev => [...prev, {
                      role: 'tool',
                      content: eventData.content || '',
                      message_id: uuidv4(),
                      toolName: toolData.name,
                      tool: {
                        toolCallId: eventData.toolCallId
                      }
                    } as any]);
                  }
                } else {
                  console.warn('⚠️ TOOL_CALL_RESULT received but no tool data found for:', eventData.toolCallId);
                }
                
                // Clean up tool data after processing result
                if (toolCallDataRef.current[eventData.toolCallId]) {
                  delete toolCallDataRef.current[eventData.toolCallId];
                  console.log('🧹 Cleaned up tool data for:', eventData.toolCallId);
                }
              }
              
              if (eventData.type === 'TOOL_CALL_END' && onExecuteHostAction && hostActions) {
                const toolData = toolCallDataRef.current[eventData.toolCallId];
                if (toolData) {
                  // Check if this backend tool name matches any registered host action
                  const matchingHostAction = hostActions.find(action => action.name === toolData.name);
                  
                  if (matchingHostAction && onExecuteHostAction) {
                    try {
                      const toolArgsRaw = JSON.parse(toolData.args || '{}');
                      // Normalize args shape: unwrap { args: [...] } produced by some tool callers
                      let normalizedArgs: any = toolArgsRaw;
                      if (normalizedArgs && Array.isArray(normalizedArgs.args)) {
                        if (normalizedArgs.args.length === 1) {
                          normalizedArgs = normalizedArgs.args[0];
                        } else {
                          normalizedArgs = { args: normalizedArgs.args };
                        }
                      }

                      // Auto-map legacy chart arg shapes to { spec } for render_chart
                      if (toolData.name === 'render_chart') {
                        const buildSpecFromLegacy = (obj: any) => {
                          if (!obj || typeof obj !== 'object') return null;
                          // Case A: { spec } wrapper
                          if (obj.spec && typeof obj.spec === 'object') return obj.spec;
                          // Case B: already the documented shape — { type, data: [{x,y}] }
                          if ((obj.type === 'bar' || obj.type === 'line') && Array.isArray(obj.data) && obj.data.length > 0 &&
                              obj.data[0] && typeof obj.data[0] === 'object' && 'x' in obj.data[0] && 'y' in obj.data[0]) {
                            return obj;
                          }
                          return null;
                        };

                        const legacySpec = buildSpecFromLegacy(normalizedArgs);
                        if (!normalizedArgs.spec && legacySpec) {
                          normalizedArgs = { spec: legacySpec };
                        }
                      }
                      
                      console.log(`🔧 useAGUI: Executing host action: ${toolData.name}`, normalizedArgs);
                      const result = await onExecuteHostAction(toolData.name, normalizedArgs);
                      console.log(`🔧 useAGUI: Host action ${toolData.name} completed:`, result);
                      
                      // Send host action result back to backend
                      try {
                        console.log(`Sending host action result to backend: ${eventData.toolCallId}`, result);
                        await fetch(`${apiUrl}/host-action-result`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            ...(apiToken ? { 'Authorization': `Bearer ${apiToken}` } : {}),
                            ...(tenantId ? { 'X-Tenant-ID': tenantId } : {})
                          },
                          body: JSON.stringify({
                            toolCallId: eventData.toolCallId,
                            toolName: toolData.name,
                            result: result,
                            success: true
                          })
                        });
                      } catch (error) {
                        console.error('Failed to send host action result to backend:', error);
                      }
                      
                      // Determine if the result requests a custom UI block (chart)
                      const tryGetChartSpec = (res: any) => {
                        if (!res || typeof res !== 'object') return null;
                        // Flatten common nesting: { success, result: {...} }
                        const eff = (res.success && res.result && typeof res.result === 'object') ? res.result : res;
                        // Shape 1: { type: 'chart', spec: {...} }
                        if (eff.type === 'chart' && eff.spec) return eff.spec;
                        // Shape 2: { ui: { type: 'chart', spec: {...} } }
                        if (eff.ui && eff.ui.type === 'chart' && eff.ui.spec) return eff.ui.spec;
                        // Shape 3: already the documented shape — { type: 'bar'|'line', data: [{x,y}] }
                        if ((eff.type === 'bar' || eff.type === 'line') && Array.isArray(eff.data) && eff.data.length > 0 &&
                            eff.data[0] && typeof eff.data[0] === 'object' && 'x' in eff.data[0] && 'y' in eff.data[0]) {
                          return eff;
                        }
                        return null;
                      };

                      const chartSpec = tryGetChartSpec(result);

                      if (chartSpec) {
                        console.log('🧪 useAGUI: recognized chart spec, adding UI block:', chartSpec);

                        // Use backend's TOOL_CALL_RESULT content (required by Gemini for conversation history)
                        const backendContent = backendToolResultsRef.current[eventData.toolCallId];
                        delete backendToolResultsRef.current[eventData.toolCallId];

                        // Fallback to chart summary if backend result not available
                        const toolContent = backendContent || (() => {
                          const title = chartSpec.title ? `Chart: ${chartSpec.title}` : 'Chart rendered';
                          const dataCount = chartSpec.data?.length || 0;
                          return `${title} (${dataCount} data points, type: ${chartSpec.type || 'bar'})`;
                        })();
                        
                        console.log(`📊 Creating tool message with content: "${toolContent?.substring(0, 100)}..."`);
                        
                        // Add tool message with chart UI block
                        const toolMsg = {
                          role: 'tool' as const,
                          content: toolContent,  // Backend result content for LLM
                          message_id: uuidv4(),
                          toolName: toolData.name,
                          uiBlock: { type: 'chart', spec: chartSpec },  // UI block for visual rendering
                          tool: {
                            toolCallId: eventData.toolCallId
                          }
                        };
                        
                        console.log('📊 Tool message created:', { 
                          role: toolMsg.role, 
                          content: toolMsg.content?.substring(0, 80),
                          toolCallId: toolMsg.tool.toolCallId,
                          hasUiBlock: !!toolMsg.uiBlock,
                          usedBackendContent: !!backendContent
                        });
                        
                        setMessages(prev => [...prev, toolMsg as any]);
                      } else {
                        // Plain tool message — the widget renders it as a tool card,
                        // so content must be a clean string (prefer the backend's result text).
                        const backendContent = backendToolResultsRef.current[eventData.toolCallId];
                        delete backendToolResultsRef.current[eventData.toolCallId];
                        const summary = (result && typeof result === 'object')
                          ? (result.message || JSON.stringify(result))
                          : String(result ?? '');
                        setMessages(prev => [...prev, {
                          role: 'tool',
                          content: backendContent || summary,
                          message_id: uuidv4(),
                          toolName: toolData.name,
                          tool: {
                            toolCallId: eventData.toolCallId
                          }
                        }]);
                      }
                      
                    } catch (error) {
                      console.error(`Host action ${toolData.name} failed:`, error);
                      // Add error message for UI display
                      setMessages(prev => [...prev, {
                        role: 'tool',
                        content: `Failed: ${error instanceof Error ? error.message : String(error)}`,
                        message_id: uuidv4(),
                        toolName: toolData.name,
                        tool: {
                          toolCallId: eventData.toolCallId
                        }
                      }]);
                    }
                  }
                  
                  // Don't clean up yet - TOOL_CALL_RESULT comes after this and needs the data
                }
              }
              
              if (eventData.type === 'TEXT_MESSAGE_START') {
                currentMessageId = eventData.messageId || uuidv4();
                assistantMessage = '';
              }
              
              if (eventData.type === 'RUN_FINISHED') {
                setIsLoading(false);
              }
              
              if (eventData.type === 'RUN_ERROR') {
                console.error('AG-UI Error:', eventData.message);
                setIsLoading(false);
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
    }
  }, [apiUrl, apiToken, tenantId, messages]);

  const clearSession = useCallback(() => {
    sessionManager.clearSession();
    setMessages([]);
    console.log('🗑️ Session cleared');
  }, []);

  const startNewSession = useCallback(() => {
    sessionManager.startNewSession();
    setMessages([]);
    console.log('🆕 Started new session');
  }, []);

  const getSessionInfo = useCallback(() => {
    return sessionManager.getSessionMetadata();
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    clearSession,
    startNewSession,
    getSessionInfo,
    sessionId: sessionManager.getSessionId(),
    threadId: sessionManager.getThreadId()
  };
};
