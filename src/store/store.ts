import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import webSocketReducer from './slices/webSocketSlice';

// We'll import the reducers here later
// import authReducer from './slices/authSlice';
// import webSocketReducer from './slices/webSocketSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    webSocket: webSocketReducer,
    // Add other reducers here as they are created
  },
  // Middleware can be added here if needed, e.g., for handling async actions
  // or logging. Redux Toolkit includes some default middleware like thunk.
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {auth: AuthState, webSocket: WebSocketState, ...}
export type AppDispatch = typeof store.dispatch; 