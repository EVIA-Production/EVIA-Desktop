import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, Users, BarChart } from 'lucide-react';

const AdminDashboard = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isLoading) return;
    
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!user?.is_admin) {
      navigate('/');
      return;
    }
  }, [isAuthenticated, isLoading, user, navigate]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Admin Dashboard</h1>
          <p className="text-gray-400">Choose an option to manage</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Button
            variant="outline"
            className="h-32 flex flex-col items-center justify-center gap-4 hover:bg-card/50"
            onClick={() => navigate('/admin/users')}
          >
            <Users className="h-8 w-8" />
            <span className="text-lg">User Management</span>
          </Button>
          <Button
            variant="outline"
            className="h-32 flex flex-col items-center justify-center gap-4 hover:bg-card/50"
            onClick={() => navigate('/admin/metrics')}
          >
            <BarChart className="h-8 w-8" />
            <span className="text-lg">Metrics Dashboard</span>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default AdminDashboard; 