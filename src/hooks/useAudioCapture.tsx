import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';
import { chatService } from '@/services/chatService';

export const useAudioCapture = (onWebSocketMessage?: (message: any) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  
  // Refs to maintain audio processing objects between renders
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sysSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const sysGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sysStreamRef = useRef<MediaStream | null>(null);
  const audioFrameCountRef = useRef<number>(0);
  const messageHandlerRef = useRef<(() => void) | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const analyserIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const addDebugLog = (message: string, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  const handleStartRecording = async (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>, chatId: string | null) => {
    console.log('handleStartRecording called');
    
    try {
      // Update chat's last_used_at timestamp
      if (chatId) {
        await chatService.updateLastUsed(chatId);
        addDebugLog('Updated chat last used timestamp', setDebugLog);
      }

      // Request both audio and screen capture permissions
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      micStreamRef.current = micStream;
      
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          displaySurface: "monitor" 
        },
        audio: true 
      });
      sysStreamRef.current = displayStream;
      
      // Create audio context
      const audioContext = new AudioContext({
        sampleRate: 16000 // Match server requirements
      });
      audioContextRef.current = audioContext;
      
      // Create sources for both streams
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;
      
      // Create gain nodes for volume control
      const micGain = audioContext.createGain();
      const sysGain = audioContext.createGain();
      const masterGain = audioContext.createGain();
      
      micGainRef.current = micGain;
      sysGainRef.current = sysGain;
      masterGainRef.current = masterGain;
      
      // Set initial gain values (adjust these as needed)
      micGain.gain.value = 1.0;    // Microphone at full volume
      sysGain.gain.value = 0.5;    // System audio at half volume
      masterGain.gain.value = 1.0; // Master volume at full
      
      // Check if display stream has audio tracks
      const hasSystemAudio = displayStream.getAudioTracks().length > 0;
      if (hasSystemAudio) {
        try {
          const sysSource = audioContext.createMediaStreamSource(displayStream);
          sysSourceRef.current = sysSource;
          
          // Connect system audio through its gain node
          sysSource.connect(sysGain);
          sysGain.connect(masterGain);
          addDebugLog('System audio capture enabled', setDebugLog);
        } catch (error) {
          console.warn('Failed to create system audio source:', error);
          addDebugLog('System audio capture not available', setDebugLog);
        }
      } else {
        addDebugLog('System audio capture not available', setDebugLog);
      }
      
      // Connect microphone through its gain node
      micSource.connect(micGain);
      micGain.connect(masterGain);
      
      // Create destination for the mixed audio
      const destination = audioContext.createMediaStreamDestination();
      masterGain.connect(destination);
      
      // Create analyser node for monitoring audio levels
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserNodeRef.current = analyser;
      masterGain.connect(analyser);
      
      // Start monitoring audio levels
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyserIntervalRef.current = setInterval(() => {
        if (analyserNodeRef.current) {
          analyserNodeRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const averageLevel = sum / dataArray.length;
          console.log(`Audio Level: ${averageLevel.toFixed(2)}`);
        }
      }, 500);
      
      // If we get here, permissions were granted
      setIsRecording(true);
      addDebugLog('Permissions granted. Recording started.', setDebugLog);
      
      // Connect to WebSocket if we have a chatId
      if (chatId) {
        const ws = getWebSocketInstance(chatId);
        ws.connect();
        setIsConnected(true);
        
        // Register message handler if provided
        if (onWebSocketMessage) {
          messageHandlerRef.current = ws.onMessage(onWebSocketMessage);
        }
        
        addDebugLog('WebSocket connection initiated', setDebugLog);
        
        // Create audio processor for the mixed stream
        const source = audioContext.createMediaStreamSource(destination.stream);
        
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
      }
      
      // Clean up function to remove message handler and stop audio processing when unmounted
      return () => {
        if (messageHandlerRef.current) {
          messageHandlerRef.current();
          messageHandlerRef.current = null;
        }
        
        if (processorRef.current && source && audioContextRef.current) {
          processorRef.current.disconnect();
          source.disconnect();
          audioContextRef.current.close().catch(console.error);
          processorRef.current = null;
          source = null;
          audioContextRef.current = null;
        }
        
        // Stop all tracks
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach(track => track.stop());
          micStreamRef.current = null;
        }
        
        if (sysStreamRef.current) {
          sysStreamRef.current.getTracks().forEach(track => track.stop());
          sysStreamRef.current = null;
        }
        
        // Clear analyser interval
        if (analyserIntervalRef.current) {
          clearInterval(analyserIntervalRef.current);
          analyserIntervalRef.current = null;
        }
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
    if (processorRef.current && audioContextRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    // Disconnect and clean up gain nodes
    if (micGainRef.current) {
      micGainRef.current.disconnect();
      micGainRef.current = null;
    }
    
    if (sysGainRef.current) {
      sysGainRef.current.disconnect();
      sysGainRef.current = null;
    }
    
    if (masterGainRef.current) {
      masterGainRef.current.disconnect();
      masterGainRef.current = null;
    }
    
    // Disconnect and clean up sources
    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    
    if (sysSourceRef.current) {
      sysSourceRef.current.disconnect();
      sysSourceRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    
    // Stop all tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    
    if (sysStreamRef.current) {
      sysStreamRef.current.getTracks().forEach(track => track.stop());
      sysStreamRef.current = null;
    }
    
    // Clear analyser interval
    if (analyserIntervalRef.current) {
      clearInterval(analyserIntervalRef.current);
      analyserIntervalRef.current = null;
    }
    
    // Remove message handler if it exists
    if (messageHandlerRef.current) {
      messageHandlerRef.current();
      messageHandlerRef.current = null;
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