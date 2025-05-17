import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useAudioCapture = () => {
  const [isRecording, setIsRecording] = useState(false);
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

  const startRecording = async (
    setDebugLog: React.Dispatch<React.SetStateAction<string[]>>,
    onAudioData: (data: Int16Array) => void
  ) => {
    console.log('startRecording called');
    
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
      
      // Create audio processor for the combined stream
      const source = audioContext.createMediaStreamSource(destination.stream);
      sourceRef.current = source;
      
      // ScriptProcessorNode is deprecated but widely supported
      // Consider migrating to AudioWorklet in the future
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      // Process audio data
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert float32 to int16 (better compression for transmission)
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
        }
        
        // Log audio frame count for debugging
        audioFrameCountRef.current += 1;
        if (audioFrameCountRef.current % 50 === 0) { // Log every 50 frames to avoid console spam
          console.log(`[Audio Logger] Processing audio frame #${audioFrameCountRef.current}, size: ${int16Data.length} samples`);
        }
        
        // Send audio data through callback
        onAudioData(int16Data);
      };
      
      // Connect the audio processing nodes
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      addDebugLog('Audio processing pipeline established', setDebugLog);
      
      // Return cleanup function
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

  const stopRecording = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('stopRecording called');
    setIsRecording(false);
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
    
    toast({
      description: "Recording stopped",
    });
  };

  return {
    isRecording,
    startRecording,
    stopRecording,
    addDebugLog
  };
}; 