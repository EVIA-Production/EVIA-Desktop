import { test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UserDetailPage from '../UserDetailPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
vi.mock('@/services/authService');
vi.mock('@/services/analyticsService');

test('renders user metrics with defaults', async () => {
  authService.default.getUserDetails.mockResolvedValueOnce({
    username: 'testuser',
    email: 'test@example.com',
    full_name: 'Test User',
    disabled: false,
    is_admin: false
  });
  
  analyticsService.default.getUserMetrics.mockResolvedValueOnce({});  // Empty response
  
  render(
    <MemoryRouter initialEntries={['/admin/users/testuser']}>
      <Routes>
        <Route path="/admin/users/:username" element={<UserDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  
  await waitFor(() => {
    expect(screen.getByText('Session Count: 0')).toBeInTheDocument();
    expect(screen.getByText('Average Duration: 0.00 seconds')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // Add assertions for all metrics
  });
});

test('renders user metrics with data', async () => {
  authService.default.getUserDetails.mockResolvedValueOnce({
    username: 'testuser',
    email: 'test@example.com',
    full_name: 'Test User',
    disabled: false,
    is_admin: false
  });
  
  analyticsService.default.getUserMetrics.mockResolvedValueOnce({
    session_count: 5,
    avg_duration: 123.45,
    total_suggestions: 20,
    avg_suggestions: 4.0
  });
  
  render(
    <MemoryRouter initialEntries={['/admin/users/testuser']}>
      <Routes>
        <Route path="/admin/users/:username" element={<UserDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  
  await waitFor(() => {
    expect(screen.getByText('Session Count: 5')).toBeInTheDocument();
    expect(screen.getByText('Average Duration: 123.45 seconds')).toBeInTheDocument();
    // Add for others
  });
});