import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import analyticsService from '@/services/analyticsService';

interface MetricsData {
  total_sessions?: number;
  avg_duration?: number;
  total_suggestions?: number;
  avg_suggestions?: number;
  // Add other metrics as needed
}

const DEFAULT_METRICS = {
  total_sessions: 0,
  avg_duration: 0,
  total_suggestions: 0,
  avg_suggestions: 0,
};

const AdminMetrics = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const data = await analyticsService.getOverallMetrics();
        console.log('Fetched metrics:', data); // Log the fetched data
        setMetrics({ ...DEFAULT_METRICS, ...data });
      } catch (error) {
        console.error('Error fetching metrics:', error);
        toast({ title: 'Error', description: 'Failed to load metrics', variant: 'destructive' });
        setMetrics(DEFAULT_METRICS); // Use defaults on error
      } finally {
        setLoading(false);
      }
    };
    
    fetchMetrics();
  }, [toast]);

  if (loading) return <div className="p-6">Loading metrics...</div>;

  return (
    <AppLayout>
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/admin')} className="mb-4"><ArrowLeft /> Back</Button>
        <h1 className="text-2xl font-bold mb-6">Overall Metrics</h1>
        
        {!metrics ? (
          <div>No metrics available.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Total Sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_sessions ?? 0}</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Average Duration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_duration?.toFixed(2) ?? '0.00'} seconds</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Total Suggestions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_suggestions ?? 0}</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Average Suggestions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_suggestions?.toFixed(2) ?? '0.00'}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminMetrics; 