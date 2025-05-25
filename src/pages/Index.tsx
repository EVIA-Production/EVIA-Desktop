import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import ChatStatus from '@/components/ChatStatus';
import MainContent from '@/components/MainContent';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { chatService } from '@/services/chatService';
import { useRecording } from '@/hooks/useRecording';
import { getWebSocketInstance } from '@/services/websocketService';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
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
    setSuggestion,
    setIsConnected: setRecordingIsConnected,
    setTranscriptSegments
  } = useRecording();
  
  // Add a debug logging function
  const addDebugLog = (message: string) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  // Load past transcripts when chat is selected
  useEffect(() => {
    if (!chatId) return;

    const loadPastTranscripts = async () => {
      try {
        const transcripts = await chatService.getChatTranscripts(chatId);
        if (transcripts.length > 0) {
          // Convert transcripts to segments format
          const segments = transcripts.map(transcript => ({
            speaker: 0, // Default speaker for past transcripts
            text: transcript.content,
            show_speaker_label: true,
            is_new_speaker_turn: true
          }));
          setTranscriptSegments(segments);
          addDebugLog(`Loaded ${transcripts.length} past transcripts`);
        }
      } catch (error) {
        console.error('Error loading past transcripts:', error);
        toast({
          title: "Error",
          description: "Failed to load past transcripts",
          variant: "destructive"
        });
      }
    };

    loadPastTranscripts();
  }, [chatId, toast]);
  
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
    const existingChatId = localStorage.getItem('selectedChatId');
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

  // Monitor WebSocket connection status when chatId is available
  useEffect(() => {
    if (!chatId) return;
    
    const ws = getWebSocketInstance(chatId);
    const cleanup = ws.onConnectionChange((connected) => {
      setIsConnected(connected);
      setRecordingIsConnected(connected);
      addDebugLog(`WebSocket connection status changed: ${connected ? 'Connected' : 'Disconnected'}`);
    });
    
    return cleanup;
  }, [chatId, setRecordingIsConnected]);

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black to-gray-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }
  
  // If not authenticated or no chat selected, don't render the content (will be redirected)
  if (!isAuthenticated || !chatId) {
    return null;
  }
  
  const onStartRecordingWrapper = () => {
    const cleanup = handleStartRecording(setDebugLog, chatId);
    return cleanup;
  };

  const onStopRecordingWrapper = () => {
    handleStopRecording(setDebugLog);
  };

  const onSuggestWrapper = () => {
    handleSuggest(setDebugLog);
  };

  const onResetContextWrapper = () => {
    handleResetContext(setDebugLog);
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <MainContent
          isRecording={isRecording}
          transcript={transcript}
          suggestion={suggestion}
          onStartRecording={onStartRecordingWrapper}
          onStopRecording={onStopRecordingWrapper}
          onSuggest={onSuggestWrapper}
          onResetContext={onResetContextWrapper}
          isConnected={isConnected}
          chatId={chatId}
          hasAccessToken={hasAccessToken}
        />
      </div>
    </AppLayout>
  );
};

export default Index;
