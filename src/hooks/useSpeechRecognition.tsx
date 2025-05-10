
import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UseSpeechRecognitionProps {
  onResult?: (text: string) => void;
  onEnd?: () => void;
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
}

const useSpeechRecognition = ({
  onResult,
  onEnd,
  continuous = true,
  interimResults = true,
  lang = 'en-US'
}: UseSpeechRecognitionProps = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const { toast } = useToast();
  
  // Using refs to hold instances that don't need to trigger re-renders
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Initialize speech recognition
  useEffect(() => {
    // Check if browser supports speech recognition
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognitionAPI();
      
      if (recognitionRef.current) {
        recognitionRef.current.continuous = continuous;
        recognitionRef.current.interimResults = interimResults;
        recognitionRef.current.lang = lang;
        setIsSupported(true);
      }
    } else {
      console.error('Speech Recognition is not supported in this browser.');
    }

    // Cleanup on unmount
    return () => {
      if (recognitionRef.current && isRecording) {
        recognitionRef.current.stop();
      }
    };
  }, [continuous, interimResults, lang, isRecording]);

  // Set up event handlers
  useEffect(() => {
    if (!recognitionRef.current) return;

    const handleResult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        }
      }

      if (finalTranscript) {
        setTranscript(prev => prev + finalTranscript);
        if (onResult) onResult(finalTranscript);
      }
    };

    const handleEnd = () => {
      setIsRecording(false);
      if (onEnd) onEnd();
      console.log('Speech recognition ended');
    };

    const handleError = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setPermissionGranted(false);
        toast({
          title: 'Permission denied',
          description: 'Microphone access was denied. Please allow access to use speech recognition.',
          variant: 'destructive'
        });
      }
    };

    recognitionRef.current.onresult = handleResult;
    recognitionRef.current.onend = handleEnd;
    recognitionRef.current.onerror = handleError;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
      }
    };
  }, [onResult, onEnd, toast]);

  // Request microphone permission
  const requestMicrophonePermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the tracks immediately as we only needed to request permission
      stream.getTracks().forEach(track => track.stop());
      setPermissionGranted(true);
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setPermissionGranted(false);
      toast({
        title: 'Microphone access denied',
        description: 'You need to allow microphone access to use speech recognition.',
        variant: 'destructive'
      });
      return false;
    }
  };

  const startRecording = useCallback(async () => {
    if (!recognitionRef.current) {
      console.error('Speech recognition is not initialized');
      return;
    }

    try {
      // First request microphone permission
      const permissionGranted = await requestMicrophonePermission();
      if (!permissionGranted) return;

      console.log('Starting speech recognition...');
      recognitionRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current && isRecording) {
      console.log('Stopping speech recognition...');
      try {
        recognitionRef.current.stop();
      } catch (error) {
        console.error('Error stopping speech recognition:', error);
      }
      setIsRecording(false);
    }
  }, [isRecording]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return {
    isRecording,
    transcript,
    startRecording,
    stopRecording,
    resetTranscript,
    isSupported,
    permissionGranted
  };
};

export default useSpeechRecognition;
