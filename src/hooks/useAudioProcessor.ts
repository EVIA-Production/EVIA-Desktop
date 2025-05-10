
import { useRef, useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useAudioProcessor = () => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const { toast } = useToast();
  
  // Function to start audio processing
  const startProcessing = useCallback(async () => {
    try {
      // Request microphone permission first
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Now request screen display permission
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Store references to the streams for cleanup later
      micStreamRef.current = micStream;
      displayStreamRef.current = displayStream;
      
      // Create AudioContext
      audioContextRef.current = new AudioContext();
      
      // Load the audio worklet
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      
      // Create the audio worklet node
      audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      // Create audio destination to collect audio
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      
      // Connect microphone to the audio worklet
      const micSource = audioContextRef.current.createMediaStreamSource(micStream);
      micSource.connect(audioWorkletNodeRef.current);
      
      // If display stream has audio tracks, connect them too
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const displayAudio = new MediaStream(audioTracks);
        const displaySource = audioContextRef.current.createMediaStreamSource(displayAudio);
        displaySource.connect(audioWorkletNodeRef.current);
      }
      
      // Connect worklet to destination
      audioWorkletNodeRef.current.connect(audioDestinationRef.current);
      
      // Set up message handling from the audio worklet
      audioWorkletNodeRef.current.port.onmessage = (event) => {
        const audioData = event.data;
        // Here you would send the audio data to your backend or process it further
        console.log('Received audio data from worklet:', audioData.byteLength, 'bytes');
      };
      
      setIsProcessing(true);
      toast({
        description: "Audio processing started",
      });
      
      return true;
    } catch (error) {
      console.error('Error starting audio processing:', error);
      toast({
        title: 'Error',
        description: 'Failed to start audio processing. Please check permissions.',
        variant: 'destructive'
      });
      stopProcessing();
      return false;
    }
  }, [toast]);
  
  // Function to stop audio processing
  const stopProcessing = useCallback(() => {
    // Stop audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Stop audio worklet node
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    
    // Stop microphone stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    
    // Stop display stream
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach(track => track.stop());
      displayStreamRef.current = null;
    }
    
    // Reset audio destination
    if (audioDestinationRef.current) {
      audioDestinationRef.current = null;
    }
    
    setIsProcessing(false);
    toast({
      description: "Audio processing stopped",
    });
  }, [toast]);
  
  return {
    isProcessing,
    startProcessing,
    stopProcessing
  };
};
