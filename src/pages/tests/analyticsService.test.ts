import { describe, it, expect, vi } from 'vitest';
import analyticsService from '@/services/analyticsService';

// Mock localStorage
global.localStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

describe('analyticsService', () => {
  it('fetches overall metrics successfully', async () => {
    const mockMetrics = { total_sessions: 5 };
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics)
    });
    
    const result = await analyticsService.getOverallMetrics();
    expect(result).toEqual(mockMetrics);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/admin/metrics/'), expect.any(Object));
  });

  it('handles fetch errors', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    
    await expect(analyticsService.getOverallMetrics()).rejects.toThrow('Error fetching metrics');
  });

  it('fetches user metrics successfully', async () => {
    const mockMetrics = { session_count: 3 };
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics)
    });
    
    const result = await analyticsService.getUserMetrics('testuser');
    expect(result).toEqual(mockMetrics);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/admin/users/testuser/metrics/'), expect.any(Object));
  });
});