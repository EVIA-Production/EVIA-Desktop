
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
      console.log('Requesting microphone permissions...');
      // Request microphone permission first
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      console.log('Microphone permissions granted:', micStream.getAudioTracks().length, 'audio track(s)');
      
      // Now request screen display permission
      console.log('Requesting screen display permissions...');
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      console.log('Screen permissions granted:', 
        displayStream.getVideoTracks().length, 'video track(s),',
        displayStream.getAudioTracks().length, 'audio track(s)'
      );
      
      // Store references to the streams for cleanup later
      micStreamRef.current = micStream;
      displayStreamRef.current = displayStream;
      
      // Create AudioContext
      console.log('Creating Audio Context...');
      audioContextRef.current = new AudioContext();
      console.log('Audio Context sample rate:', audioContextRef.current.sampleRate);
      
      // Load the audio worklet
      console.log('Loading audio worklet module...');
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      console.log('Audio worklet module loaded');
      
      // Create the audio worklet node
      console.log('Creating audio worklet node...');
      audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      // Create audio destination to collect audio
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      
      // Connect microphone to the audio worklet
      console.log('Connecting microphone source to audio worklet...');
      const micSource = audioContextRef.current.createMediaStreamSource(micStream);
      micSource.connect(audioWorkletNodeRef.current);
      
      // If display stream has audio tracks, connect them too
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log('Connecting display audio to worklet...');
        const displayAudio = new MediaStream(audioTracks);
        const displaySource = audioContextRef.current.createMediaStreamSource(displayAudio);
        displaySource.connect(audioWorkletNodeRef.current);
      } else {
        console.log('No audio tracks in display stream');
      }
      
      // Connect worklet to destination
      console.log('Connecting worklet to destination...');
      audioWorkletNodeRef.current.connect(audioDestinationRef.current);
      
      // Set up message handling from the audio worklet
      audioWorkletNodeRef.current.port.onmessage = (event) => {
        const audioData = event.data;
        console.log('Received audio data from worklet:', 
          audioData ? `${audioData.byteLength} bytes` : 'No data',
          'timestamp:', new Date().toISOString()
        );
        // Here you would send the audio data to your backend or process it further
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
    console.log('Stopping audio processing...');
    
    // Stop audio context
    if (audioContextRef.current) {
      console.log('Closing Audio Context...');
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Stop audio worklet node
    if (audioWorkletNodeRef.current) {
      console.log('Disconnecting Audio Worklet Node...');
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    
    // Stop microphone stream
    if (micStreamRef.current) {
      console.log('Stopping microphone tracks...');
      const micTracks = micStreamRef.current.getTracks();
      console.log(`Stopping ${micTracks.length} microphone track(s)`);
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    
    // Stop display stream
    if (displayStreamRef.current) {
      console.log('Stopping display tracks...');
      const displayTracks = displayStreamRef.current.getTracks();
      console.log(`Stopping ${displayTracks.length} display track(s)`);
      displayStreamRef.current.getTracks().forEach(track => track.stop());
      displayStreamRef.current = null;
    }
    
    // Reset audio destination
    if (audioDestinationRef.current) {
      console.log('Resetting audio destination...');
      audioDestinationRef.current = null;
    }
    
    setIsProcessing(false);
    console.log('Audio processing stopped completely');
  }, [toast]);
  
  return {
    isProcessing,
    startProcessing,
    stopProcessing
  };
};
