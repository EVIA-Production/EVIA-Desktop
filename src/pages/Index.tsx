import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import ChatStatus from '@/components/ChatStatus';
import MainContent from '@/components/MainContent';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { chatService, Transcript as ApiTranscript } from '@/services/chatService';
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
    renderedLines,
    suggestion, 
    handleStartRecording, 
    handleStopRecording, 
    handleSuggest, 
    handleResetContext,
    setSuggestion,
    setIsConnected: setRecordingIsConnected,
    setTranscriptLines,
    loadSpeakerLabels,
    applyLabelToAll,
    applyLabelToLine
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
            // Fold past transcripts as a single running line per speaker turn; map speaker numbers if present
            const lines = (transcripts as ApiTranscript[])
              .map((t: ApiTranscript) => ({ speaker: (typeof t.speaker === 'number' ? (t.speaker as number) : 0), text: t.content }))
              .reduce((acc: { speaker: number; text: string }[], cur) => {
              if (acc.length > 0 && acc[acc.length - 1].speaker === cur.speaker) {
                acc[acc.length - 1].text = acc[acc.length - 1].text + ' ' + cur.text;
              } else {
                acc.push({ speaker: cur.speaker, text: cur.text });
              }
              return acc;
            }, [] as { speaker: number; text: string }[]);
            // Seed live transcript with historical lines for the selected chat
            setTranscriptLines(lines);
            addDebugLog(`Loaded ${transcripts.length} transcript entries`);
            // Load speaker labels mapping from backend
            await loadSpeakerLabels(chatId);
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
}, [chatId, refreshKey, toast, loadSpeakerLabels, setTranscriptLines]);
  
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

  // Manage follow-live defaults: ON when recording, OFF when stopped
  const [followLive, setFollowLive] = useState<boolean>(false);
  useEffect(() => {
    setFollowLive(isRecording ? true : false);
  }, [isRecording]);

  const handleRenameLabel = (mode: 'current' | 'all', lineIndex: number, speaker: number, newLabel: string) => {
    if (!chatId) return;
    if (mode === 'all') {
      applyLabelToAll(chatId, speaker, newLabel);
    } else {
      applyLabelToLine(lineIndex, newLabel);
    }
  };

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
          renderedLines={renderedLines}
          suggestion={suggestion}
          onStartRecording={onStartRecordingWrapper}
          onStopRecording={onStopRecordingWrapper}
          onSuggest={onSuggestWrapper}
          onResetContext={onResetContextWrapper}
          isConnected={isConnected}
          chatId={chatId}
          hasAccessToken={hasAccessToken}
          followLive={followLive}
          onToggleFollow={setFollowLive}
          onRenameLabel={handleRenameLabel}
        />
      </div>
    </AppLayout>
  );
};

export default Index;
