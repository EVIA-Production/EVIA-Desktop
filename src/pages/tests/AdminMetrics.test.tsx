// AdminMetrics.test.tsx
import { test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminMetrics from '../AdminMetrics';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { toBeInTheDocument } from '@testing-library/jest-dom/extend-expect';

// Mock dependencies with jsdom environment
vi.mock('@/services/analyticsService', () => ({
  __esModule: true,
  default: {
    getOverallMetrics: vi.fn()
  }
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn().mockReturnValue({
    toast: vi.fn()
  })
}));

// Mock localStorage
global.localStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// Import the mocked service
import analyticsService from '@/services/analyticsService';

// Helper to render component with router
const renderWithRouter = (ui: React.ReactElement) => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        {ui}
      </AuthProvider>
    </BrowserRouter>
  );
};

// Test default rendering when no data
test('renders default metrics when API returns empty data', async () => {
  vi.mocked(analyticsService.getOverallMetrics).mockResolvedValueOnce({});
  
  renderWithRouter(<AdminMetrics />);
  
  await waitFor(() => {
    expect(screen.getAllByText('Total Sessions').length).toBeGreaterThan(0);
  });
});

// Test rendering with sample data
test('renders key metrics with API data', async () => {
  const mockMetrics = {
    total_sessions: 5,
    avg_time_to_first: 2.34,
    total_suggestions: 20,
    avg_suggestions: 4.0,
    retention_rate: 50.0
  } as any;

  vi.mocked(analyticsService.getOverallMetrics).mockResolvedValueOnce(mockMetrics);

  renderWithRouter(<AdminMetrics />);

  await waitFor(() => {
    expect(screen.getAllByText('Total Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Avg. Time to First').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total Suggestions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Retention Rate').length).toBeGreaterThan(0);
  });
});

// Test error handling
test('handles API errors gracefully', async () => {
  vi.mocked(analyticsService.getOverallMetrics).mockRejectedValueOnce(new Error('API Error'));
  
  renderWithRouter(<AdminMetrics />);
  
  await waitFor(() => {
    expect(screen.getAllByText('Overall Metrics').length).toBeGreaterThan(0);
    expect(useToast().toast).toHaveBeenCalled();
  });
});