
import { useRef, useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UseAudioProcessorProps {
  onAudioData?: (audioData: ArrayBuffer) => boolean;
}

export const useAudioProcessor = ({
  onAudioData
}: UseAudioProcessorProps = {}) => {
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
      console.log('Creating audio processing pipeline...');
      // Request microphone permission first (permissions already requested by RecordingControls)
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      console.log('Microphone stream obtained:', micStream.getAudioTracks().length, 'audio track(s)');
      
      // Now request screen display permission (permissions already requested by RecordingControls)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      console.log('Display stream obtained:', 
        displayStream.getVideoTracks().length, 'video track(s),',
        displayStream.getAudioTracks().length, 'audio track(s)'
      );
      
      // Store references to the streams for cleanup later
      micStreamRef.current = micStream;
      displayStreamRef.current = displayStream;
      
      // Create AudioContext
      console.log('Creating Audio Context...');
      audioContextRef.current = new AudioContext({
        // Deepgram expects Linear PCM at 16kHz sampling rate for best results
        sampleRate: 16000 
      });
      console.log('Audio Context sample rate:', audioContextRef.current.sampleRate);
      
      // Load the audio worklet
      console.log('Loading audio worklet module...');
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      console.log('Audio worklet module loaded');
      
      // Create the audio worklet node
      console.log('Creating audio worklet node...');
      audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor', {
        processorOptions: {
          // Ensure the worklet knows to output 16-bit PCM for Deepgram
          targetSampleRate: 16000,
          outputFormat: 'int16'
        }
      });
      
      // Create audio destination to collect audio
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      
      // Create a mixer node to combine audio streams
      console.log('Creating audio mixer...');
      const mixerNode = audioContextRef.current.createGain();
      mixerNode.gain.value = 1.0; // Set gain to 1.0 (no amplification)
      
      // Connect microphone to the mixer
      console.log('Connecting microphone source to mixer...');
      const micSource = audioContextRef.current.createMediaStreamSource(micStream);
      micSource.connect(mixerNode);
      
      // If display stream has audio tracks, connect them to the mixer
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log('Connecting display audio to mixer...');
        const displayAudio = new MediaStream(audioTracks);
        const displaySource = audioContextRef.current.createMediaStreamSource(displayAudio);
        displaySource.connect(mixerNode);
      } else {
        console.log('No audio tracks in display stream');
      }
      
      // Connect mixer to worklet
      console.log('Connecting mixer to worklet...');
      mixerNode.connect(audioWorkletNodeRef.current);
      
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
        
        // Forward audio data to websocket if handler is provided
        if (audioData && onAudioData) {
          // Send audio as raw binary data - exactly what Deepgram expects
          const success = onAudioData(audioData);
          if (!success) {
            console.warn('Failed to send audio data to WebSocket');
          }
        }
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
        description: 'Failed to start audio processing. Please try again.',
        variant: 'destructive'
      });
      stopProcessing();
      return false;
    }
  }, [toast, onAudioData]);
  
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
  }, []);
  
  return {
    isProcessing,
    startProcessing,
    stopProcessing
  };
};
