import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Corresponds to the structure from the old Reflex project's AudioState
export interface TranscriptSegment {
  speaker: number;
  text: string;
  isFinal: boolean; // To know if it's a partial or final segment from Deepgram
  showSpeakerLabel?: boolean; // For UI rendering logic
  isNewSpeakerTurn?: boolean; // For UI rendering logic
  timestamp?: number; // Optional: if backend provides it
}

interface WebSocketState {
  isConnecting: boolean;
  isConnected: boolean;
  isRecording: boolean; // True if actively sending audio via WebSocket
  transcriptSegments: TranscriptSegment[];
  latestSuggestion: string;
  webSocketError: string | null; // General WebSocket errors
  audioError: string | null; // Errors related to audio capture/processing
  // Reflects connection_status from old AudioState more broadly
  statusMessage: string; 
}

const initialState: WebSocketState = {
  isConnecting: false,
  isConnected: false,
  isRecording: false,
  transcriptSegments: [],
  latestSuggestion: '',
  webSocketError: null,
  audioError: null,
  statusMessage: 'Idle',
};

const webSocketSlice = createSlice({
  name: 'webSocket',
  initialState,
  reducers: {
    // Connection Actions
    connectStart(state) {
      state.isConnecting = true;
      state.isConnected = false;
      state.isRecording = false;
      state.webSocketError = null;
      state.audioError = null;
      state.transcriptSegments = []; // Clear transcript on new connection attempt
      state.latestSuggestion = '';
      state.statusMessage = 'Connecting to backend...';
    },
    connectSuccess(state) {
      state.isConnecting = false;
      state.isConnected = true;
      // isRecording will be set by a separate action once audio is flowing
      state.webSocketError = null;
      state.statusMessage = 'Connected to backend. Ready to record.';
    },
    connectFailure(state, action: PayloadAction<string>) {
      state.isConnecting = false;
      state.isConnected = false;
      state.isRecording = false;
      state.webSocketError = action.payload;
      state.statusMessage = `Connection failed: ${action.payload}`;
    },
    disconnect(state) {
      state.isConnecting = false;
      state.isConnected = false;
      state.isRecording = false;
      // Optionally keep or clear transcript/suggestion based on requirements
      // state.transcriptSegments = [];
      // state.latestSuggestion = '';
      state.statusMessage = 'Disconnected.';
    },

    // Recording State Actions
    startRecordingState(state) {
      state.isRecording = true;
      state.transcriptSegments = []; // Clear previous transcript
      state.latestSuggestion = '';
      state.statusMessage = 'Recording started...';
    },
    stopRecordingState(state) {
      state.isRecording = false;
      state.statusMessage = 'Recording stopped.';
    },

    // Data-related Actions
    addTranscriptSegment(state, action: PayloadAction<TranscriptSegment>) {
      // Simple append, can be made more sophisticated (e.g. replacing interim results)
      state.transcriptSegments.push(action.payload);
      state.statusMessage = 'Receiving transcription...';
    },
    clearTranscript(state) {
      state.transcriptSegments = [];
      state.statusMessage = 'Transcript cleared.';
    },
    setSuggestion(state, action: PayloadAction<string>) {
      state.latestSuggestion = action.payload;
      state.statusMessage = 'Suggestion received.';
    },
    clearSuggestion(state) {
      state.latestSuggestion = '';
    },

    // Error Actions
    setWebSocketError(state, action: PayloadAction<string | null>) {
      state.webSocketError = action.payload;
      if (action.payload) state.statusMessage = `WebSocket Error: ${action.payload}`;
    },
    setAudioError(state, action: PayloadAction<string | null>) {
      state.audioError = action.payload;
      if (action.payload) {
        state.isRecording = false; // Stop recording if audio error occurs
        state.statusMessage = `Audio Error: ${action.payload}`;
      }
    },
    clearErrors(state) {
      state.webSocketError = null;
      state.audioError = null;
    },
    
    // Generic Status Update
    setStatusMessage(state, action: PayloadAction<string>) {
      state.statusMessage = action.payload;
    },

    // Reset Context Action (combines clearing relevant parts of state)
    resetWebSocketContext(state) {
      state.transcriptSegments = [];
      state.latestSuggestion = '';
      state.webSocketError = null;
      state.audioError = null;
      // state.isRecording = false; // Decide if reset should also stop recording
      state.statusMessage = 'Context reset.';
    },
  },
});

export const {
  connectStart,
  connectSuccess,
  connectFailure,
  disconnect,
  startRecordingState,
  stopRecordingState,
  addTranscriptSegment,
  clearTranscript,
  setSuggestion,
  clearSuggestion,
  setWebSocketError,
  setAudioError,
  clearErrors,
  setStatusMessage,
  resetWebSocketContext,
} = webSocketSlice.actions;

export default webSocketSlice.reducer; 