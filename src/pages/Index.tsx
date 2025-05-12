
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import ChatStatus from '@/components/ChatStatus';
import MainContent from '@/components/MainContent';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { chatService } from '@/services/chatService';
import { useRecording } from '@/hooks/useRecording';
import { ChatWebSocket } from '@/services/websocketService';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<ChatWebSocket | null>(null);
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const { 
    isRecording, 
    transcript, 
    suggestion, 
    handleStartRecording, 
    handleStopRecording, 
    handleSuggest, 
    handleResetContext,
    setTranscript,
    setSuggestion 
  } = useRecording();
  
  // Add a debug logging function
  const addDebugLog = (message: string) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };
  
  // Connect to WebSocket when chatId is available
  useEffect(() => {
    if (chatId && isAuthenticated) {
      addDebugLog(`Connecting to WebSocket with chat ID: ${chatId}`);
      const ws = chatService.connectToWebSocket(chatId);
      
      // Set up WebSocket message handlers
      const removeMessageHandler = ws.onMessage(message => {
        if (message.transcript) {
          setTranscript(message.transcript);
        }
        if (message.suggestion) {
          setSuggestion(message.suggestion);
        }
        if (message.error) {
          toast({
            title: "Error",
            description: message.error,
            variant: "destructive"
          });
        }
      });
      
      // Set up connection state handler
      const removeConnectionHandler = ws.onConnectionChange(connected => {
        setIsConnected(connected);
        if (connected) {
          addDebugLog('WebSocket connected');
        } else {
          addDebugLog('WebSocket disconnected');
        }
      });
      
      setWsConnection(ws);
      
      // Clean up WebSocket connection on unmount
      return () => {
        removeMessageHandler();
        removeConnectionHandler();
        chatService.disconnectFromWebSocket();
      };
    }
  }, [chatId, isAuthenticated, toast, setTranscript, setSuggestion]);
  
  useEffect(() => {
    console.log('Index component mounted');
    
    // Don't redirect while still loading authentication state
    if (isLoading) {
      console.log('Authentication state loading...');
      return;
    }
    
    // Redirect to login if not authenticated
    if (!isAuthenticated) {
      console.log('User not authenticated, redirecting to login');
      navigate('/login');
      return;
    }
    
    // Check for existing chat ID
    const existingChatId = chatService.getCurrentChatId();
    if (existingChatId) {
      setChatId(existingChatId);
      addDebugLog(`Using existing chat ID: ${existingChatId}`);
    } else {
      // Create a new chat when the user is authenticated
      const createNewChat = async () => {
        try {
          addDebugLog('Creating new chat session...');
          const newChatId = await chatService.createChat();
          setChatId(newChatId);
          addDebugLog(`Chat created successfully with ID: ${newChatId}`);
          toast({
            description: "Chat session created",
          });
        } catch (error) {
          console.error('Failed to create chat:', error);
          addDebugLog(`Failed to create chat: ${error instanceof Error ? error.message : String(error)}`);
          toast({
            title: "Error",
            description: "Failed to create chat session",
            variant: "destructive"
          });
        }
      };
      
      createNewChat();
    }
  }, [isAuthenticated, isLoading, navigate, toast]);

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black to-gray-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }
  
  // If the redirect is happening, don't render the full content
  if (!isAuthenticated) {
    return <div>Redirecting to login...</div>;
  }
  
  const onStartRecordingWrapper = () => {
    if (wsConnection && wsConnection.isConnected()) {
      wsConnection.sendMessage({ type: "start_recording" });
    }
    const cleanup = handleStartRecording(setDebugLog);
    return cleanup;
  };

  const onStopRecordingWrapper = () => {
    if (wsConnection && wsConnection.isConnected()) {
      wsConnection.sendMessage({ type: "stop_recording" });
    }
    handleStopRecording(setDebugLog);
  };

  const onSuggestWrapper = () => {
    if (wsConnection && wsConnection.isConnected()) {
      wsConnection.sendMessage({ type: "suggest" });
    }
    handleSuggest(setDebugLog);
  };

  const onResetContextWrapper = () => {
    if (wsConnection && wsConnection.isConnected()) {
      wsConnection.sendMessage({ type: "reset_context" });
    }
    handleResetContext(setDebugLog);
  };
  
  return (
    <AppLayout>
      <main className="flex-1 flex flex-col">
        <ChatStatus chatId={chatId} />
        
        <MainContent 
          isRecording={isRecording}
          transcript={transcript}
          suggestion={suggestion}
          isConnected={isConnected}
          chatId={chatId}
          onStartRecording={onStartRecordingWrapper}
          onStopRecording={onStopRecordingWrapper}
          onSuggest={onSuggestWrapper}
          onResetContext={onResetContextWrapper}
          hasAccessToken={hasAccessToken}
        />
      </main>
    </AppLayout>
  );
};

export default Index;
