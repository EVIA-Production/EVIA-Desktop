import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useAudioCapture = () => {
  const [isRecording, setIsRecording] = useState(false);
  const { toast } = useToast();
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const analyserIntervalRef = useRef<number | null>(null);
  
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
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = micStream;
      addDebugLog('Got microphone stream', setDebugLog);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          displaySurface: "monitor" 
        },
        audio: true 
      });
      displayStreamRef.current = displayStream;
      addDebugLog('Got display stream', setDebugLog);

      // Handle display stream ending
      const displayAudioTrack = displayStream.getAudioTracks()[0];
      if (displayAudioTrack) {
        displayAudioTrack.onended = () => {
          console.log('Display media track ended');
          stopRecording(setDebugLog);
        };
      }

      // Create audio context
      const audioContext = new AudioContext({
        sampleRate: 16000 // Match server requirements
      });
      audioContextRef.current = audioContext;
      addDebugLog(`AudioContext created. Sample rate: ${audioContext.sampleRate}Hz`, setDebugLog);

      // Create sources
      const micSource = audioContext.createMediaStreamSource(micStream);
      let sysSource: MediaStreamAudioSourceNode | null = null;
      
      if (displayStream.getAudioTracks().length > 0) {
        try {
          sysSource = audioContext.createMediaStreamSource(displayStream);
          addDebugLog('System audio capture enabled', setDebugLog);
        } catch (error) {
          console.warn('Failed to create system audio source:', error);
          addDebugLog('System audio capture not available', setDebugLog);
        }
      }

      // Create destination to mix streams
      const destination = audioContext.createMediaStreamDestination();
      
      // Connect sources
      micSource.connect(destination);
      if (sysSource) {
        sysSource.connect(destination);
      }

      // Load and setup AudioWorklet
      await audioContext.audioWorklet.addModule('/audio_processor.js');
      addDebugLog('AudioWorklet module loaded', setDebugLog);

      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      workletNodeRef.current = workletNode;
      addDebugLog('AudioWorkletNode created', setDebugLog);

      // Handle worklet messages
      workletNode.port.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) {
          const data = event.data;
          const int16Array = new Int16Array(data);
          onAudioData(int16Array);
        }
      });

      workletNode.port.onmessageerror = (event) => {
        console.error('Error receiving message from AudioWorklet:', event);
        toast({
          title: "Error",
          description: "Audio processing error",
          variant: "destructive"
        });
      };

      workletNode.onprocessorerror = (event) => {
        console.error('Error inside AudioWorkletProcessor:', event);
        toast({
          title: "Error",
          description: "Audio processing error",
          variant: "destructive"
        });
        stopRecording(setDebugLog);
      };

      // Send init ack to worklet
      workletNode.port.postMessage('INIT_ACK');

      // Connect combined stream to worklet
      const combinedSource = audioContext.createMediaStreamSource(destination.stream);
      combinedSource.connect(workletNode);

      // Setup audio level monitoring
      analyserNodeRef.current = audioContext.createAnalyser();
      analyserNodeRef.current.fftSize = 256;
      const bufferLength = analyserNodeRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      combinedSource.connect(analyserNodeRef.current);

      // Start level monitoring
      if (analyserIntervalRef.current) {
        clearInterval(analyserIntervalRef.current);
      }
      analyserIntervalRef.current = window.setInterval(() => {
        if (analyserNodeRef.current) {
          analyserNodeRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          let averageLevel = sum / bufferLength;
          console.log(`Combined Stream Avg Level: ${averageLevel.toFixed(2)}`);
        }
      }, 500);

      setIsRecording(true);
      addDebugLog('Recording started', setDebugLog);

      // Return cleanup function
      return () => {
        stopRecording(setDebugLog);
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

    // Stop analyser
    if (analyserIntervalRef.current) {
      clearInterval(analyserIntervalRef.current);
      analyserIntervalRef.current = null;
    }
    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
    }

    // Cleanup worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.port.close();
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
    }
    audioContextRef.current = null;

    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach(track => track.stop());
      displayStreamRef.current = null;
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