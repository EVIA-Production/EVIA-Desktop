import { useState, useRef, useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { webSocketService } from '../services/webSocketService';
import {
  setAudioError,
  startRecordingState,
  stopRecordingState,
  setStatusMessage,
} from '../store/slices/webSocketSlice';
import { RootState } from '../store/store';

const AUDIO_PROCESSOR_PATH = '/audio_processor.js'; // Path relative to public folder

interface UseAudioProcessingReturn {
  isCapturingAudio: boolean; // Different from WebSocket isRecording, this is specific to audio capture setup
  startAudioCapture: () => Promise<void>;
  stopAudioCapture: () => void;
  audioErrorMessage: string | null; // Local error state for this hook
}

const useAudioProcessing = (): UseAudioProcessingReturn => {
  const dispatch = useDispatch();
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sysSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<AudioWorkletNode | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);
  const [audioErrorMessage, setLocalAudioErrorMessage] = useState<string | null>(null);

  const isWebSocketConnected = useSelector((state: RootState) => state.webSocket.isConnected);

  const cleanupAudioResources = useCallback(() => {
    console.log('[useAudioProcessing] Cleaning up audio resources...');
    
    processorNodeRef.current?.port.close();
    processorNodeRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    sysSourceRef.current?.disconnect();

    processorNodeRef.current = null;
    micSourceRef.current = null;
    sysSourceRef.current = null;

    userStreamRef.current?.getTracks().forEach(track => track.stop());
    displayStreamRef.current?.getTracks().forEach(track => track.stop());
    userStreamRef.current = null;
    displayStreamRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().then(() => {
        console.log('[useAudioProcessing] AudioContext closed.');
        audioContextRef.current = null;
      }).catch(e => console.error('[useAudioProcessing] Error closing AudioContext:', e));
    } else {
      audioContextRef.current = null;
    }
    setIsCapturingAudio(false);
    // Note: dispatch(stopRecordingState()) should be called when WS stops or explicitly by UI
  }, []);

  const startAudioCapture = useCallback(async () => {
    if (isCapturingAudio) {
      console.warn('[useAudioProcessing] Audio capture already in progress.');
      return;
    }
    if (!isWebSocketConnected) {
      console.error('[useAudioProcessing] WebSocket not connected. Cannot start audio capture.');
      dispatch(setAudioError('WebSocket not connected. Please connect first.'));
      setLocalAudioErrorMessage('WebSocket not connected.');
      return;
    }

    dispatch(setAudioError(null)); // Clear previous errors
    setLocalAudioErrorMessage(null);
    setIsCapturingAudio(true);
    dispatch(setStatusMessage('Requesting audio permissions...'));

    try {
      // Request Microphone access
      userStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      console.log('[useAudioProcessing] Microphone access granted.');
      dispatch(setStatusMessage('Microphone ready.'));

      // Request System Audio (Screen capture with audio)
      // Note: This will usually show a screen sharing permission prompt.
      // The user needs to select to share their entire screen or a specific application window/tab that plays audio.
      try {
        displayStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
          video: true, // Required to get audio for screen sharing
          audio: true,
        });
        console.log('[useAudioProcessing] System audio access granted.');
        dispatch(setStatusMessage('System audio ready.'));

        // Handle case where screen sharing is stopped by browser UI
        const displayVideoTrack = displayStreamRef.current.getVideoTracks()[0];
        if (displayVideoTrack) {
            displayVideoTrack.onended = () => {
                console.log('[useAudioProcessing] Display media stream ended (e.g., user stopped sharing).');
                // This will trigger cleanup if system audio was essential
                // Or, you might want a more graceful handling, e.g. continue with mic only
                stopAudioCapture(); // Full stop for now
                dispatch(setStatusMessage('Screen sharing ended.'));
            };
        }

      } catch (err: any) {
        console.warn('[useAudioProcessing] Could not get system audio, proceeding with microphone only.', err);
        dispatch(setStatusMessage('System audio not available or permission denied. Using microphone only.'));
        // displayStreamRef.current will remain null
      }

      // Setup AudioContext
      let context;
      try {
        context = new AudioContext({ sampleRate: 16000 });
        console.log('[useAudioProcessing] AudioContext created with 16kHz sample rate.');
      } catch (e) {
        console.warn('[useAudioProcessing] 16kHz sample rate not supported for AudioContext, using browser default.', e);
        context = new AudioContext(); // Fallback to browser default
      }
      audioContextRef.current = context;

      if (context.state === 'suspended') {
        await context.resume();
      }

      // Load AudioWorklet Processor
      try {
        await context.audioWorklet.addModule(AUDIO_PROCESSOR_PATH);
        console.log('[useAudioProcessing] AudioWorklet module loaded from:', AUDIO_PROCESSOR_PATH);
      } catch (e: any) {
        console.error('[useAudioProcessing] Error loading AudioWorklet module:', e);
        dispatch(setAudioError(`Failed to load audio processor: ${e.message}`))
        setLocalAudioErrorMessage(`Failed to load audio processor: ${e.message}`);
        cleanupAudioResources();
        return;
      }

      processorNodeRef.current = new AudioWorkletNode(context, 'audio-processor');
      console.log('[useAudioProcessing] Audio processor node created.');

      // Connect Microphone Source
      if (userStreamRef.current) {
        micSourceRef.current = context.createMediaStreamSource(userStreamRef.current);
        micSourceRef.current.connect(processorNodeRef.current);
        console.log('[useAudioProcessing] Microphone source connected to processor.');
      }

      // Connect System Audio Source (if available)
      if (displayStreamRef.current && displayStreamRef.current.getAudioTracks().length > 0) {
        sysSourceRef.current = context.createMediaStreamSource(displayStreamRef.current);
        sysSourceRef.current.connect(processorNodeRef.current);
        console.log('[useAudioProcessing] System audio source connected to processor.');
      } else {
        console.warn('[useAudioProcessing] No system audio track available to connect.');
      }
      
      // If neither mic nor system audio is available (should be caught earlier, but as a safeguard)
      if (!micSourceRef.current && !sysSourceRef.current) {
        console.error('[useAudioProcessing] No audio sources available to connect to processor.');
        dispatch(setAudioError('No audio input sources available.'));
        setLocalAudioErrorMessage('No audio input sources available.');
        cleanupAudioResources();
        return;
      }

      // Handle messages from AudioWorklet (processed audio data)
      processorNodeRef.current.port.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          if (webSocketService.getWebSocketState() === 'OPEN') {
            webSocketService.sendAudioData(event.data);
          } else {
            // console.warn('[useAudioProcessing] WebSocket not open, discarding audio data.');
            // Potentially buffer or handle this case if needed, for now, we discard.
          }
        } else if (event.data.error) {
            console.error('[useAudioProcessing] Error from audio-processor:', event.data.error);
            dispatch(setAudioError(`Audio processing error: ${event.data.error}`))
            setLocalAudioErrorMessage(`Audio processing error: ${event.data.error}`);
            // Consider stopping capture or other error handling
        }
      };
      processorNodeRef.current.port.onmessageerror = (err) => {
          console.error('[useAudioProcessing] onmessageerror in AudioWorklet port:', err);
          dispatch(setAudioError('Error receiving message from audio processor.'));
          setLocalAudioErrorMessage('Error receiving message from audio processor.');
      };

      dispatch(startRecordingState()); // Signal that recording has effectively started
      dispatch(setStatusMessage('Audio capture started.'));
      setLocalAudioErrorMessage(null);

    } catch (err: any) {
      console.error('[useAudioProcessing] Error during audio capture setup:', err);
      const errMsg = err.message || 'Failed to start audio capture.';
      dispatch(setAudioError(errMsg));
      setLocalAudioErrorMessage(errMsg);
      cleanupAudioResources();
      // Ensure isCapturingAudio is false if setup fails mid-way
      setIsCapturingAudio(false); 
      dispatch(stopRecordingState()); // Ensure Redux state reflects stoppage
    }
  }, [isCapturingAudio, isWebSocketConnected, dispatch, cleanupAudioResources]);

  const stopAudioCapture = useCallback(() => {
    console.log('[useAudioProcessing] Stopping audio capture explicitly...');
    cleanupAudioResources();
    dispatch(stopRecordingState()); // Ensure Redux state is updated
    dispatch(setStatusMessage('Audio capture stopped.'));
    setLocalAudioErrorMessage(null);
  }, [cleanupAudioResources, dispatch]);

  // Effect to clean up resources when the component unmounts or hook dependencies change in a way that stops capture
  useEffect(() => {
    return () => {
      // This cleanup runs if the component using the hook unmounts
      console.log('[useAudioProcessing] Hook unmounting, ensuring audio cleanup.');
      cleanupAudioResources();
    };
  }, [cleanupAudioResources]); // Ensure cleanup is tied to the memoized version

  return {
    isCapturingAudio,
    startAudioCapture,
    stopAudioCapture,
    audioErrorMessage
  };
};

export default useAudioProcessing; 