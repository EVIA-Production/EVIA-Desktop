import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';
import { chatService } from '@/services/chatService';

type WsMessage = { type?: string; data?: unknown };
export const useAudioCapture = (onWebSocketMessage?: (message: WsMessage) => void) => {
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
    if (!chatId) {
      addDebugLog('No chat ID provided, cannot start recording', setDebugLog);
      return;
    }

    try {
      // Update chat's last_used_at timestamp
      await chatService.updateLastUsed(chatId);
      addDebugLog('Updated chat last used timestamp', setDebugLog);

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
      
      // Create destination for optional local monitoring/analysis
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
      
      // Connect two WebSockets: one for mic (source=mic), one for system (source=system)
      const wsMic = getWebSocketInstance(chatId, 'mic');
      wsMic.connect();
      const wsSys = getWebSocketInstance(chatId, 'system');
      wsSys.connect();
      setIsConnected(true);
      
      // Register message handler if provided (attach to both)
      if (onWebSocketMessage) {
        const detachMic = wsMic.onMessage(onWebSocketMessage);
        const detachSys = wsSys.onMessage(onWebSocketMessage);
        messageHandlerRef.current = () => { detachMic(); detachSys(); };
      }
      
      addDebugLog('WebSocket connections initiated (mic + system)', setDebugLog);
      
      // Create dedicated processors per source and send to the corresponding WS only
      // Mic processor
      const micProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      micGain.connect(micProcessor);
      micProcessor.connect(audioContext.destination);
      micProcessor.onaudioprocess = (e) => {
        const wsMicConn = getWebSocketInstance(chatId, 'mic');
        if (!wsMicConn.isConnected()) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
        }
        audioFrameCountRef.current += 1;
        if (audioFrameCountRef.current % 50 === 0) {
          console.log(`[Audio Logger][MIC] Frame #${audioFrameCountRef.current}, size: ${int16Data.length}`);
        }
        wsMicConn.sendBinaryData(int16Data.buffer);
      };
      
      // System processor (only if system audio available)
      if (sysSourceRef.current) {
        const sysProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        sysGain.connect(sysProcessor);
        sysProcessor.connect(audioContext.destination);
        sysProcessor.onaudioprocess = (e) => {
          const wsSysConn = getWebSocketInstance(chatId, 'system');
          if (!wsSysConn.isConnected()) return;
          const inputData = e.inputBuffer.getChannelData(0);
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
          }
          wsSysConn.sendBinaryData(int16Data.buffer);
        };
      }
      
      addDebugLog('Audio processing pipeline established (separate mic/system streams)', setDebugLog);
    } catch (error) {
      console.error('Error starting recording:', error);
      addDebugLog(`Error starting recording: ${error}`, setDebugLog);
      toast({
        title: "Error",
        description: "Failed to start recording. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleStopRecording = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    try {
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

      // Close WS instances for this chat
      const selectedId = localStorage.getItem('selectedChatId') || undefined;
      if (selectedId) {
        closeWebSocketInstance(selectedId, 'mic');
        closeWebSocketInstance(selectedId, 'system');
      }
      
      // Close WebSocket connection
      const chatId = localStorage.getItem('selectedChatId');
      if (chatId) {
        setTimeout(() => {
          closeWebSocketInstance(chatId);
          addDebugLog('WebSocket connection closed after delay', setDebugLog);
        }, 2000);
        addDebugLog('Scheduled WebSocket close in 2 seconds to receive pending messages', setDebugLog);
      }
      
      toast({
        description: "Recording stopped",
      });
    } catch (error) {
      console.error('Error stopping recording:', error);
      addDebugLog(`Error stopping recording: ${error}`, setDebugLog);
    }
  };

  return {
    isRecording,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    setIsConnected
  };
}; 