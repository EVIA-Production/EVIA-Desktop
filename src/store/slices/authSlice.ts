import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface User {
  username: string;
  email?: string;
  fullName?: string;
  // Add any other relevant user fields
}

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  user: User | null;
  error: string | null;
  isLoading: boolean;
}

// Attempt to load token from localStorage for initial state
const loadTokenFromStorage = (): string | null => {
  try {
    const token = localStorage.getItem('accessToken');
    return token;
  } catch (e) {
    console.error("Could not load token from localStorage", e);
    return null;
  }
};

const initialState: AuthState = {
  accessToken: loadTokenFromStorage(),
  isAuthenticated: !!loadTokenFromStorage(), // True if token exists
  user: null, // User info can be fetched after login
  error: null,
  isLoading: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginStart(state) {
      state.isLoading = true;
      state.error = null;
    },
    loginSuccess(state, action: PayloadAction<{ token: string; user?: User }>) {
      state.accessToken = action.payload.token;
      state.isAuthenticated = true;
      state.user = action.payload.user || null;
      state.isLoading = false;
      state.error = null;
      try {
        localStorage.setItem('accessToken', action.payload.token);
      } catch (e) {
        console.error("Could not save token to localStorage", e);
        // Potentially dispatch an error action or set an error state here
      }
    },
    loginFailure(state, action: PayloadAction<string>) {
      state.accessToken = null;
      state.isAuthenticated = false;
      state.user = null;
      state.error = action.payload;
      state.isLoading = false;
      try {
        localStorage.removeItem('accessToken');
      } catch (e) {
        console.error("Could not remove token from localStorage", e);
      }
    },
    logout(state) {
      state.accessToken = null;
      state.isAuthenticated = false;
      state.user = null;
      state.error = null;
      state.isLoading = false;
      try {
        localStorage.removeItem('accessToken');
      } catch (e) {
        console.error("Could not remove token from localStorage", e);
      }
    },
    setUser(state, action: PayloadAction<User | null>) {
      state.user = action.payload;
    },
    clearAuthError(state) {
      state.error = null;
    }
  },
});

export const { 
  loginStart, 
  loginSuccess, 
  loginFailure, 
  logout,
  setUser,
  clearAuthError
} = authSlice.actions;

export default authSlice.reducer; 