import React from 'react';
import ChatInterface from './components/ChatInterface';

interface AppProps {
  apiUrl?: string;
  sessionId?: string;
  theme?: 'light' | 'dark';
  primaryColor?: string;
  apiToken?: string;
  tenantId?: string;
  showNewConversationButton?: boolean;
  agentName?: string;
  welcomeMessage?: string;
  toolDisplay?: 'minimal' | 'detailed';
  toolLabel?: string | ((toolName: string) => string);
  suggestions?: string[];
  onWidgetEvent?: (type: string, data: any) => void;
  hostActions?: any[];
  onExecuteHostAction?: (actionName: string, params: any) => Promise<any>;
}

function App({ apiUrl = 'http://localhost:8001', sessionId, theme = 'dark', primaryColor, apiToken, tenantId, showNewConversationButton = true, agentName, welcomeMessage, toolDisplay, toolLabel, suggestions, onWidgetEvent, hostActions, onExecuteHostAction }: AppProps) {
  return (
    <ChatInterface
      apiUrl={apiUrl}
      sessionId={sessionId}
      theme={theme}
      primaryColor={primaryColor}
      apiToken={apiToken}
      tenantId={tenantId}
      showNewConversationButton={showNewConversationButton}
      agentName={agentName}
      welcomeMessage={welcomeMessage}
      toolDisplay={toolDisplay}
      toolLabel={toolLabel}
      suggestions={suggestions}
      onWidgetEvent={onWidgetEvent}
      hostActions={hostActions}
      onExecuteHostAction={onExecuteHostAction}
    />
  );
}

export default App;
