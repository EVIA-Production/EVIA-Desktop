import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

export const useAudioCapture = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  
  // Refs to maintain audio processing objects between renders
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioFrameCountRef = useRef<number>(0);

  const addDebugLog = (message: string, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  const handleStartRecording = async (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>, chatId: string | null) => {
    console.log('handleStartRecording called');
    
    try {
      // Request both audio and screen capture permissions
      const audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          displaySurface: "monitor" 
        },
        audio: true 
      });
      
      // Create audio context
      const audioContext = new AudioContext({
        sampleRate: 16000 // Match server requirements
      });
      audioContextRef.current = audioContext;
      
      // Create source for microphone stream
      const micSource = audioContext.createMediaStreamSource(audioStream);
      
      // Check if display stream has audio tracks
      const hasSystemAudio = displayStream.getAudioTracks().length > 0;
      let sysSource: MediaStreamAudioSourceNode | null = null;
      
      if (hasSystemAudio) {
        try {
          sysSource = audioContext.createMediaStreamSource(displayStream);
          addDebugLog('System audio capture enabled', setDebugLog);
        } catch (error) {
          console.warn('Failed to create system audio source:', error);
          addDebugLog('System audio capture not available', setDebugLog);
        }
      } else {
        addDebugLog('System audio capture not available', setDebugLog);
      }
      
      const destination = audioContext.createMediaStreamDestination();
      
      // Connect microphone source
      micSource.connect(destination);
      
      // Connect system audio source if available
      if (sysSource) {
        sysSource.connect(destination);
      }
      
      // Save combined stream to ref for later cleanup
      streamRef.current = destination.stream;
      
      // If we get here, permissions were granted
      setIsRecording(true);
      addDebugLog('Permissions granted. Recording started.', setDebugLog);
      
      // Connect to WebSocket if we have a chatId
      if (chatId) {
        const ws = getWebSocketInstance(chatId);
        ws.connect();
        setIsConnected(true);
        
        addDebugLog('WebSocket connection initiated', setDebugLog);
        
        // Create audio processor for the combined stream
        const source = audioContext.createMediaStreamSource(destination.stream);
        sourceRef.current = source;
        
        // ScriptProcessorNode is deprecated but widely supported
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        
        // Process audio data and send to WebSocket
        processor.onaudioprocess = (e) => {
          if (ws.isConnected()) {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert float32 to int16 (better compression for transmission)
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
            }
            
            // Log audio frame count for debugging
            audioFrameCountRef.current += 1;
            if (audioFrameCountRef.current % 50 === 0) {
              console.log(`[Audio Logger] Processing audio frame #${audioFrameCountRef.current}, size: ${int16Data.length} samples`);
            }
            
            // Send audio data through WebSocket
            ws.sendBinaryData(int16Data.buffer);
          }
        };
        
        // Connect the audio processing nodes
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        addDebugLog('Audio processing pipeline established', setDebugLog);
        
        // Clean up function to remove message handler and stop audio processing when unmounted
        return () => {
          if (processorRef.current && sourceRef.current && audioContextRef.current) {
            processorRef.current.disconnect();
            sourceRef.current.disconnect();
            audioContextRef.current.close().catch(console.error);
            processorRef.current = null;
            sourceRef.current = null;
            audioContextRef.current = null;
          }
          
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          
          // Stop all tracks from both streams
          audioStream.getTracks().forEach(track => track.stop());
          displayStream.getTracks().forEach(track => track.stop());
        };
      }
      
      // Clean up function to stop tracks when recording is stopped
      return () => {
        audioStream.getTracks().forEach(track => track.stop());
        displayStream.getTracks().forEach(track => track.stop());
      };
    } catch (error) {
      console.error('Error getting media permissions:', error);
      addDebugLog(`Permission error: ${error}`, setDebugLog);
      toast({
        title: "Permission Error",
        description: "Could not access microphone or screen. Please grant permissions and try again.",
        variant: "destructive"
      });
    }
  };

  const handleStopRecording = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleStopRecording called');
    setIsRecording(false);
    setIsConnected(false);
    addDebugLog('Recording stopped', setDebugLog);
    
    // Clean up audio processing
    if (processorRef.current && sourceRef.current && audioContextRef.current) {
      processorRef.current.disconnect();
      sourceRef.current.disconnect();
      audioContextRef.current.close().catch(console.error);
      processorRef.current = null;
      sourceRef.current = null;
      audioContextRef.current = null;
    }
    
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close WebSocket connection when recording is stopped
    closeWebSocketInstance();
    addDebugLog('WebSocket connection closed', setDebugLog);
    
    toast({
      description: "Recording stopped",
    });
  };

  return {
    isRecording,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    setIsConnected
  };
}; 