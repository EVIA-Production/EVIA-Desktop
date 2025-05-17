import { useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useAudioProcessing } from '@/hooks/useAudioProcessing';

export const useRecording = () => {
  const {
    isRecording,
    startRecording,
    stopRecording,
    addDebugLog: addCaptureDebugLog
  } = useAudioCapture();

  const {
    transcript,
    suggestion,
    isConnected,
    setIsConnected,
    startProcessing,
    stopProcessing,
    handleSuggest,
    handleResetContext,
    processAudioData,
    setTranscript,
    setSuggestion
  } = useAudioProcessing();

  const { toast } = useToast();
  
  const addDebugLog = (message: string, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  const handleStartRecording = async (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>, chatId: string | null) => {
    const cleanupCapture = await startRecording(setDebugLog, processAudioData);
    const cleanupProcessing = startProcessing(chatId, setDebugLog);

    return () => {
      cleanupCapture?.();
      cleanupProcessing?.();
    };
  };

  const handleStopRecording = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    stopRecording(setDebugLog);
    stopProcessing(setDebugLog);
  };

  return {
    isRecording,
    transcript,
    suggestion,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    handleSuggest,
    handleResetContext,
    setTranscript,
    setSuggestion,
    setIsConnected
  };
};