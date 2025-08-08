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
  total_errors?: number;
  avg_transcription_latency?: number;
  avg_suggestion_latency?: number;
  total_token_usage?: number;
  avg_sessions_per_week?: number;
  feature_usage?: Record<string, number>;
  avg_time_to_first?: number;
  avg_error_rate?: number;
  avg_deepgram_time?: number;
  avg_groq_time?: number;
  avg_tokens_per_suggestion?: number;
  retention_rate?: number;
  total_api_cost?: number;
  total_deepgram_calls?: number;
  total_groq_calls?: number;
}

const DEFAULT_METRICS: MetricsData = {
  total_sessions: 0,
  avg_duration: 0,
  total_suggestions: 0,
  avg_suggestions: 0,
  total_errors: 0,
  avg_transcription_latency: 0,
  avg_suggestion_latency: 0,
  total_token_usage: 0,
  avg_sessions_per_week: 0,
  feature_usage: {},
  avg_time_to_first: 0,
  avg_error_rate: 0,
  avg_deepgram_time: 0,
  avg_groq_time: 0,
  avg_tokens_per_suggestion: 0,
  retention_rate: 0,
  total_api_cost: 0,
  total_deepgram_calls: 0,
  total_groq_calls: 0,
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
          <>
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

            <Card>
              <CardHeader>
                <CardTitle>Total Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_errors ?? 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Transcription Latency</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_transcription_latency?.toFixed(2) ?? '0.00'} ms</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Suggestion Latency</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_suggestion_latency?.toFixed(2) ?? '0.00'} ms</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total Token Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_token_usage ?? 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Sessions / Week</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_sessions_per_week?.toFixed(2) ?? '0.00'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Time to First Suggestion</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_time_to_first?.toFixed(2) ?? '0.00'} s</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Error Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_error_rate?.toFixed(2) ?? '0.00'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Deepgram Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_deepgram_time?.toFixed(2) ?? '0.00'} s</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Groq Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_groq_time?.toFixed(2) ?? '0.00'} s</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg. Tokens / Suggestion</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.avg_tokens_per_suggestion?.toFixed(2) ?? '0.00'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Retention Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.retention_rate?.toFixed(2) ?? '0.00'}%</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total API Cost (est.)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">${metrics.total_api_cost?.toFixed(2) ?? '0.00'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total Deepgram Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_deepgram_calls ?? 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total Groq Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metrics.total_groq_calls ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          {metrics.feature_usage && Object.keys(metrics.feature_usage).length > 0 && (
            <div className="mt-6">
              <h2 className="text-xl font-bold mb-2">Feature Usage</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(metrics.feature_usage).map(([k, v]) => (
                  <Card key={k}>
                    <CardHeader>
                      <CardTitle>{k}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{v}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default AdminMetrics; 