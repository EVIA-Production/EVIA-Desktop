import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import UserDetailPage from '../UserDetailPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import authService from '@/services/authService';
import analyticsService from '@/services/analyticsService';

// Mock services
vi.mock('@/services/authService');
vi.mock('@/services/analyticsService');

test('renders user metrics with defaults', async () => {
  authService.getUserDetails.mockResolvedValueOnce({
    username: 'testuser',
    email: 'test@example.com',
    full_name: 'Test User',
    disabled: false,
    is_admin: false
  });
  
  analyticsService.getUserMetrics.mockResolvedValueOnce({});  // Empty response
  
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
    // Add assertions for all metrics
  });
});

test('renders user metrics with data', async () => {
  authService.getUserDetails.mockResolvedValueOnce({
    username: 'testuser',
    email: 'test@example.com',
    full_name: 'Test User',
    disabled: false,
    is_admin: false
  });
  
  analyticsService.getUserMetrics.mockResolvedValueOnce({
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