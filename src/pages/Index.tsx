import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import ChatStatus from '@/components/ChatStatus';
import MainContent from '@/components/MainContent';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { chatService } from '@/services/chatService';
import { useRecording } from '@/hooks/useRecording';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
            const showSpeakerNames = true;
            const transcripts = await chatService.getChatTranscripts(chatId);
            const segments = [];
            transcripts.forEach(transcript => {
                const sentences = transcript.content
                    .split(/(?<=[.!?])\s+/)
                    .filter(sentence => sentence.trim().length > 0);
                sentences.forEach((sentence, index) => {
                    segments.push({
                        speaker: 0, // Default for past
                        text: sentence,
                        show_speaker_label: index === 0 ? showSpeakerNames : false,
                        is_new_speaker_turn: index === 0 ? true : false,
                        is_final: true
                    });
                });
            });
            setTranscriptSegments(segments);
            addDebugLog(`Loaded ${segments.length} transcript segments from ${transcripts.length} entries`);
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
}, [chatId, refreshKey, toast]);
  
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
    
    // Check for existing chat ID (guard against string 'undefined'/'null')
    const raw = localStorage.getItem('selectedChatId');
    const existingChatId = (raw && raw !== 'undefined' && raw !== 'null') ? raw : null;
    if (raw && !existingChatId) {
      localStorage.removeItem('selectedChatId');
    }
    if (existingChatId) {
      setChatId(existingChatId);
      addDebugLog(`Using existing chat ID: ${existingChatId}`);
    } else {
      // If no chat is selected, redirect to chat list
      console.log('No chat selected, redirecting to chat list');
      navigate('/chats');
      return;
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Monitor WebSocket connection status when chatId is available
  useEffect(() => {
    if (!chatId) return;
    
    // Close any existing WebSocket connection for the previous chat
    const previousChatId = localStorage.getItem('selectedChatId');
    if (previousChatId && previousChatId !== chatId) {
      closeWebSocketInstance(previousChatId);
    }
    
    const ws = getWebSocketInstance(chatId);
    const cleanup = ws.onConnectionChange((connected) => {
      setIsConnected(connected);
      setRecordingIsConnected(connected);
      addDebugLog(`WebSocket connection status changed: ${connected ? 'Connected' : 'Disconnected'}`);
    });
    
    return () => {
      cleanup();
      // Don't close the WebSocket here as it might be needed for other components
    };
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
  
  const onStartRecordingWrapper = async () => {
    await handleStartRecording(setDebugLog, chatId);
    return () => {
      // Cleanup function
    };
  };

  const onStopRecordingWrapper = () => {
    handleStopRecording(setDebugLog);
    setRefreshKey(prev => prev + 1);
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
