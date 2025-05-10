
import { useState, useEffect, useCallback } from 'react';

interface UseSpeechRecognitionProps {
  onResult?: (transcript: string) => void;
  onEnd?: () => void;
}

interface UseSpeechRecognitionReturn {
  isRecording: boolean;
  transcript: string;
  startRecording: () => void;
  stopRecording: () => void;
  resetTranscript: () => void;
  isSupported: boolean;
}

const useSpeechRecognition = ({ 
  onResult, 
  onEnd 
}: UseSpeechRecognitionProps = {}): UseSpeechRecognitionReturn => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // Check if speech recognition is supported
  useEffect(() => {
    const SpeechRecognition = 
      window.SpeechRecognition || 
      window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      setIsSupported(true);
      const instance = new SpeechRecognition();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = 'en-US';
      
      setRecognition(instance);
    } else {
      console.error('Speech recognition not supported in this browser');
      setIsSupported(false);
    }

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, []);

  // Set up recognition event handlers
  useEffect(() => {
    if (!recognition) return;

    const handleResult = (event: SpeechRecognitionEvent) => {
      let currentTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        currentTranscript += event.results[i][0].transcript;
      }

      setTranscript(currentTranscript);
      if (onResult) onResult(currentTranscript);
    };

    const handleEnd = () => {
      if (isRecording) {
        // Auto restart if it was interrupted but we want to continue
        recognition.start();
      } else if (onEnd) {
        onEnd();
      }
    };

    recognition.onresult = handleResult;
    recognition.onend = handleEnd;
    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      setIsRecording(false);
    };

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
    };
  }, [recognition, isRecording, onResult, onEnd]);

  const startRecording = useCallback(() => {
    if (recognition && !isRecording) {
      try {
        recognition.start();
        setIsRecording(true);
      } catch (error) {
        console.error('Error starting speech recognition:', error);
      }
    }
  }, [recognition, isRecording]);

  const stopRecording = useCallback(() => {
    if (recognition && isRecording) {
      recognition.stop();
      setIsRecording(false);
    }
  }, [recognition, isRecording]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return {
    isRecording,
    transcript,
    startRecording,
    stopRecording,
    resetTranscript,
    isSupported
  };
};

export default useSpeechRecognition;
