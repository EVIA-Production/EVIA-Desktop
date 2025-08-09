import { test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UserDetailPage from '../UserDetailPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import * as authService from '@/services/authService';
import * as analyticsService from '@/services/analyticsService';
import { toBeInTheDocument } from '@testing-library/jest-dom/extend-expect';

// Mock localStorage
global.localStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// Mock services
vi.mock('@/services/authService', () => ({
  __esModule: true,
  authService: {
    logout: vi.fn(),
    getAllUsers: vi.fn().mockResolvedValue([{
      username: 'testuser',
      email: 'test@example.com',
      full_name: 'Test User',
      disabled: false,
      is_admin: false,
    }])
  }
}));
vi.mock('@/services/analyticsService', () => ({
  __esModule: true,
  default: {
    getUserMetrics: vi.fn()
  }
}));

test('renders user metrics with defaults', async () => {
  analyticsService.default.getUserMetrics.mockResolvedValueOnce({});  // Empty response
  
  render(
    <MemoryRouter initialEntries={['/admin/users/testuser']}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/users/:username" element={<UserDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  
  await waitFor(() => {
    expect(screen.getAllByText(/User: testuser/).length).toBeGreaterThan(0);
  });
});

test('renders user metrics with data', async () => {
  analyticsService.default.getUserMetrics.mockResolvedValueOnce({
    session_count: 5,
    avg_duration: 123.45,
    total_suggestions: 20,
    avg_suggestions: 4.0
  });
  
  render(
    <MemoryRouter initialEntries={['/admin/users/testuser']}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/users/:username" element={<UserDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  
  await waitFor(() => {
    expect(screen.getAllByText(/User: testuser/).length).toBeGreaterThan(0);
  });
});