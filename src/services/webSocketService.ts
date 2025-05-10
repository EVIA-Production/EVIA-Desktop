import { store } from '../store/store';
import {
  connectStart,
  connectSuccess,
  connectFailure,
  disconnect as dispatchDisconnect,
  addTranscriptSegment,
  setSuggestion,
  setWebSocketError,
  setStatusMessage,
  TranscriptSegment
} from '../store/slices/webSocketSlice';
import { logout } from '../store/slices/authSlice'; // For handling auth errors

const WS_BASE_URL = 'ws://localhost:5001/ws/transcribe'; // As per your requirements

let socket: WebSocket | null = null;

interface WebSocketCommand {
  command: 'suggest' | 'reset' | 'history'; // Add other commands as needed
  // payload?: any; // If commands need additional data
}

const connect = () => {
  const { dispatch, getState } = store;
  const token = getState().auth.accessToken;

  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('[WebSocketService] Already connected.');
    // dispatch(connectSuccess()); // Optionally re-dispatch success if needed
    return;
  }

  if (!token) {
    console.error('[WebSocketService] No access token found. Cannot connect.');
    dispatch(connectFailure('Authentication token not found.'));
    // Potentially dispatch a logout action or redirect to login
    return;
  }

  dispatch(connectStart());
  
  const wsUrlWithToken = `${WS_BASE_URL}?token=${token}`;
  console.log(`[WebSocketService] Connecting to: ${wsUrlWithToken}`);

  try {
    socket = new WebSocket(wsUrlWithToken);
  } catch (error: any) {
    console.error('[WebSocketService] WebSocket instantiation failed:', error);
    dispatch(connectFailure(error.message || 'Failed to create WebSocket connection.'));
    return;
  }

  socket.onopen = () => {
    console.log('[WebSocketService] WebSocket Connected.');
    dispatch(connectSuccess());
  };

  socket.onmessage = (event) => {
    console.log('[WebSocketService] Message received:', event.data);
    try {
      const message = JSON.parse(event.data as string);
      const { type, data } = message;

      switch (type) {
        case 'transcript_segment':
          // Assuming data structure matches TranscriptSegment
          // Add validation/transformation if necessary
          dispatch(addTranscriptSegment(data as TranscriptSegment));
          break;
        case 'suggestion':
          dispatch(setSuggestion(data as string)); // Assuming data is the suggestion string
          break;
        case 'status':
          dispatch(setStatusMessage(data as string));
          break;
        case 'error': // Backend originated error message
          console.error('[WebSocketService] Backend error:', data);
          dispatch(setWebSocketError(data as string)); 
          break;
        // Add cases for other message types like 'history' if needed
        default:
          console.warn('[WebSocketService] Unknown message type received:', type);
      }
    } catch (e) {
      console.error('[WebSocketService] Error parsing message:', e);
      dispatch(setWebSocketError('Invalid message format from server.'));
    }
  };

  socket.onerror = (event) => {
    console.error('[WebSocketService] WebSocket Error:', event);
    // The event itself is not very descriptive, might need more specific error handling
    dispatch(connectFailure('WebSocket connection error.'));
    // If the error is due to auth (e.g. 401/403 implicitly via close code), handle logout
    // This often comes via onClose, check event.code there.
  };

  socket.onclose = (event) => {
    console.log('[WebSocketService] WebSocket Closed:', event.code, event.reason, event.wasClean);
    dispatch(dispatchDisconnect()); // Use the aliased dispatcher

    if (event.code === 4001 || event.code === 4003 || event.code === 1008) { // Example: Custom auth error codes or policy violation
        console.warn('[WebSocketService] Connection closed due to auth error or policy violation. Logging out.', event.reason);
        dispatch(setWebSocketError(`Connection closed: ${event.reason || 'Authentication/Policy Issue'} (Code: ${event.code})`));
        dispatch(logout()); // Dispatch logout action from authSlice
    } else if (!event.wasClean) {
        dispatch(setWebSocketError(`WebSocket disconnected unexpectedly (Code: ${event.code}). Check backend/network.`));
    }
    // socket = null; // Ensure socket is nulled out for reconnect logic
  };
};

const sendAudioData = (data: ArrayBuffer) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  } else {
    console.warn('[WebSocketService] WebSocket not open. Cannot send audio data.');
    // Optionally dispatch an error or attempt reconnect if appropriate
    // store.dispatch(setWebSocketError('Cannot send audio: Connection not open.'));
  }
};

const sendCommand = (command: WebSocketCommand) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(command));
      console.log('[WebSocketService] Command sent:', command);
    } catch (error) {
        console.error('[WebSocketService] Failed to send command:', error);
        store.dispatch(setWebSocketError('Failed to send command to server.'));
    }
  } else {
    console.warn('[WebSocketService] WebSocket not open. Cannot send command.', command);
    store.dispatch(setWebSocketError('Cannot send command: Connection not open.'));
  }
};

const disconnect = () => {
  if (socket) {
    console.log('[WebSocketService] Disconnecting WebSocket explicitly...');
    socket.close(1000, 'Client requested disconnect'); // Normal closure
    // State updates are handled by onclose
  }
  socket = null; // Clear the socket reference immediately
};

const getWebSocketState = () => {
    if (!socket) return 'CLOSED'; // Or 'NONE' or similar
    switch (socket.readyState) {
        case WebSocket.CONNECTING: return 'CONNECTING';
        case WebSocket.OPEN: return 'OPEN';
        case WebSocket.CLOSING: return 'CLOSING';
        case WebSocket.CLOSED: return 'CLOSED';
        default: return 'UNKNOWN';
    }
};

export const webSocketService = {
  connect,
  disconnect,
  sendAudioData,
  sendCommand,
  getWebSocketState,
  getSocketInstance: () => socket // Expose for potential direct inspection if ever needed, use sparingly
}; 