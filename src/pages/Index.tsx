import React, { useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import EviaLogo from '@/components/EviaLogo';
import RecordingControls from '@/components/RecordingControls';
import TranscriptPanel from '@/components/TranscriptPanel';
import StatusIndicator from '@/components/StatusIndicator';
import { useToast } from '@/hooks/use-toast';
import { LogIn } from 'lucide-react';

import { RootState, AppDispatch } from '@/store/store';
import { webSocketService } from '@/services/webSocketService';
import useAudioProcessing from '@/hooks/useAudioProcessing';
import { resetWebSocketContext, TranscriptSegment } from '@/store/slices/webSocketSlice';
import { logout } from '@/store/slices/authSlice';

const Index = () => {
  const dispatch: AppDispatch = useDispatch();
  const { toast } = useToast();

  // Auth state
  const { isAuthenticated, accessToken } = useSelector((state: RootState) => state.auth);
  
  // WebSocket and Recording state from Redux
  const {
    isConnected: isWebSocketConnected, // Renamed to avoid conflict with local isConnected
    isRecording,
    transcriptSegments,
    latestSuggestion,
    statusMessage,
    webSocketError,
    audioError,
  } = useSelector((state: RootState) => state.webSocket);

  // Audio processing hook
  const { 
    startAudioCapture, 
    stopAudioCapture, 
    isCapturingAudio, // Indicates if audio capture setup is active/successful
    audioErrorMessage: processingAudioError // Error from the hook itself
  } = useAudioProcessing();

  // Effect for WebSocket connection management based on auth state
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      // Check current WebSocket state before connecting
      if (webSocketService.getSocketInstance() === null || webSocketService.getWebSocketState() === 'CLOSED') {
        console.log('[Index.tsx] Authenticated, attempting to connect WebSocket...');
        webSocketService.connect();
      }
    } else {
      console.log('[Index.tsx] Not authenticated, ensuring WebSocket is disconnected...');
      webSocketService.disconnect();
    }
    // Cleanup on unmount or when auth state changes to not authenticated
    return () => {
      if (!isAuthenticated) {
        console.log('[Index.tsx] Cleaning up WebSocket connection on unmount/auth change.');
        webSocketService.disconnect();
      }
    };
  }, [isAuthenticated, accessToken]);

  // Effect to show toasts for errors
  useEffect(() => {
    if (webSocketError) {
      toast({ title: 'WebSocket Error', description: webSocketError, variant: 'destructive' });
    }
  }, [webSocketError, toast]);

  useEffect(() => {
    if (audioError) {
      toast({ title: 'Audio System Error', description: audioError, variant: 'destructive' });
    }
  }, [audioError, toast]);
  
  useEffect(() => {
    if (processingAudioError) {
      toast({ title: 'Audio Processing Error', description: processingAudioError, variant: 'destructive' });
    }
  }, [processingAudioError, toast]);
  
  // Effect to show status messages (optional, can become noisy)
  // useEffect(() => {
  //   if (statusMessage && statusMessage !== 'Idle') {
  //     toast({ description: statusMessage });
  //   }
  // }, [statusMessage, toast]);

  const handleStartRecording = async () => {
    console.log('[Index.tsx] handleStartRecording called');
    if (!isWebSocketConnected) {
      toast({ title: 'Error', description: 'WebSocket not connected. Please wait or try reconnecting.', variant: 'destructive' });
      // Attempt to reconnect if not connected and authenticated
      if (isAuthenticated) webSocketService.connect();
      return;
    }
    try {
      await startAudioCapture(); // This will eventually dispatch startRecordingState
      // Toast for success is handled by startRecordingState in webSocketSlice if desired
    } catch (error: any) {
      console.error('[Index.tsx] Error starting audio capture:', error);
      toast({ title: 'Recording Error', description: error.message || 'Failed to start audio capture.', variant: 'destructive' });
    }
  };

  const handleStopRecording = () => {
    console.log('[Index.tsx] handleStopRecording called');
    stopAudioCapture(); // This will eventually dispatch stopRecordingState
    // Toast for stop is handled by stopRecordingState in webSocketSlice if desired
  };

  const handleSuggest = () => {
    console.log('[Index.tsx] handleSuggest called');
    if (!isWebSocketConnected) {
      toast({ description: 'Not connected to backend.', variant: 'destructive'});
      return;
    }
    if (transcriptSegments.length === 0 && !isRecording) {
        toast({ description: 'Speak first or ensure recording is active before requesting suggestions.' });
        return;
    }
    webSocketService.sendCommand({ command: 'suggest' });
    toast({ description: 'Suggestion requested.' });
  };

  const handleResetContext = () => {
    console.log('[Index.tsx] handleResetContext called');
    if (isWebSocketConnected) {
      webSocketService.sendCommand({ command: 'reset' });
    }
    dispatch(resetWebSocketContext()); // Also reset client-side state immediately
    toast({ description: 'Context has been reset.' });
  };
  
  const handleLogout = () => {
    dispatch(logout());
    webSocketService.disconnect(); // Ensure WebSocket is closed on logout
    toast({ description: 'You have been logged out.'});
    // Navigation to /login can be handled by a protected route component or an effect elsewhere
  };

  // Combine transcript segments for display
  const fullTranscript = transcriptSegments.map(seg => {
    // Basic formatting, can be enhanced based on TranscriptSegment structure
    let prefix = '';
    if (seg.isNewSpeakerTurn) prefix += '\\n'; // Add newline for new speaker
    if (seg.showSpeakerLabel) prefix += `Speaker ${seg.speaker}: `;
    return prefix + seg.text;
  }).join(' ');

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-black bg-opacity-60 backdrop-blur-md">
        <EviaLogo className="text-white" />
        <div className="flex gap-3">
          {!isAuthenticated ? (
            <>
              <Link to="/login">
                <Button variant="outline" className="border-gray-600 hover:bg-gray-800 text-white">
                  <LogIn className="mr-2 h-4 w-4" /> Sign In
                </Button>
              </Link>
              <Link to="/register">
                <Button variant="default" className="bg-evia-pink hover:bg-pink-700">
                  Sign Up
                </Button>
              </Link>
            </>
          ) : (
            <Button onClick={handleLogout} variant="outline" className="border-gray-600 hover:bg-gray-800 text-white">
              <LogIn className="mr-2 h-4 w-4" /> Sign Out
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-8 text-gradient-to-r from-pink-500 to-evia-pink">
          EVIA Live Transcription & Suggestions
        </h1>
        
        <div className="text-center mb-2 text-sm text-gray-400">
          Status: {statusMessage}
        </div>

        {/* Controls */}
        <div className="mb-8">
          <RecordingControls
            isRecording={isRecording} // This now comes from Redux (webSocketSlice)
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onSuggest={handleSuggest}
            onResetContext={handleResetContext}
            isConnected={isWebSocketConnected && isAuthenticated && !webSocketError && !audioError && !processingAudioError} // Derived connection status
            // Disable controls if not authenticated or critical errors exist
            disabled={!isAuthenticated || !isWebSocketConnected || !!webSocketError || !!audioError || !!processingAudioError}
          />
        </div>

        {/* Status Indicator can show more detailed status */}
        <StatusIndicator 
          isConnected={isWebSocketConnected && !webSocketError && !audioError && !processingAudioError} // Overall health
          hasAccessToken={!!accessToken} 
          // Pass more specific states if StatusIndicator can show them
          // e.g. isWebSocketConnecting={isConnecting} from webSocketSlice
          // isAudioInitializing={isCapturingAudio && !isRecording}
        />
        
        { (webSocketError || audioError || processingAudioError) && (
            <div className="my-4 p-4 bg-red-900 border border-red-700 rounded-md text-center">
                <p className="font-semibold">Encountered an Error:</p>
                {webSocketError && <p>- WebSocket: {webSocketError}</p>}
                {audioError && <p>- Audio System: {audioError}</p>}
                {processingAudioError && <p>- Audio Processing: {processingAudioError}</p>}
                <p className="mt-2 text-xs">Try resetting context or refreshing the page. If issues persist, check console logs.</p>
            </div>
        )}


        {/* Transcription & Suggestion Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-80">
          <TranscriptPanel 
            title="Live Transcript" 
            content={fullTranscript}
            placeholder={isRecording ? "Listening..." : (isWebSocketConnected ? "Ready to record." : "Connect to backend to start...")}
            className="bg-gray-900 bg-opacity-50 border border-gray-800 shadow-lg"
          />
          <TranscriptPanel 
            title="Suggestion" 
            content={latestSuggestion}
            placeholder={isRecording ? "Suggestions will appear after you speak and click 'Suggest'." : "Click 'Suggest' after speaking..."}
            className="bg-gray-900 bg-opacity-50 border border-gray-800 shadow-lg"
          />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="py-6 border-t border-gray-800 bg-black bg-opacity-60 backdrop-blur-md mt-8">
        <div className="container mx-auto text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} EVIA Voice Assistant. All rights reserved.</p>
          {statusMessage && <p className="mt-1">Current Status: {statusMessage}</p>}
        </div>
      </footer>
    </div>
  );
};

export default Index;
