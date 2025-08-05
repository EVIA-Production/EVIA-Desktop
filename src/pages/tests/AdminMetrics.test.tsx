// AdminMetrics.test.tsx
import { test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminMetrics from '../AdminMetrics';
import { BrowserRouter } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { toBeInTheDocument } from '@testing-library/jest-dom/extend-expect';

// Mock dependencies
vi.mock('@/services/analyticsService', () => ({
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
      {ui}
    </BrowserRouter>
  );
};

// Test default rendering when no data
test('renders default metrics when API returns empty data', async () => {
  vi.mocked(analyticsService.getOverallMetrics).mockResolvedValueOnce({});
  
  renderWithRouter(<AdminMetrics />);
  
  await waitFor(() => {
    expect(screen.getByText('Total Sessions')).toBeInTheDocument();
    // Look for "0" in the document - this is the default value
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
  });
});

// Test rendering with sample data
test('renders metrics with API data', async () => {
  const mockMetrics = {
    total_sessions: 5,
    avg_duration: 123.45,
    total_suggestions: 20,
    avg_suggestions: 4.0
  };
  
  vi.mocked(analyticsService.getOverallMetrics).mockResolvedValueOnce(mockMetrics);
  
  renderWithRouter(<AdminMetrics />);
  
  await waitFor(() => {
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('123.45 seconds')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('4.00')).toBeInTheDocument();
  });
});

// Test error handling
test('handles API errors gracefully', async () => {
  vi.mocked(analyticsService.getOverallMetrics).mockRejectedValueOnce(new Error('API Error'));
  
  renderWithRouter(<AdminMetrics />);
  
  await waitFor(() => {
    expect(screen.getByText('Total Sessions')).toBeInTheDocument();
    // Should fall back to defaults
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
    
    // Toast should be called with error message
    expect(useToast().toast).toHaveBeenCalled();
  });
});