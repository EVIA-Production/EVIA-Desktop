import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';

const AdminPage = () => {
  const { isAuthenticated, user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect if not authenticated or not admin after loading state
    if (!isLoading && (!isAuthenticated || !user?.is_admin)) {
      navigate('/'); // Redirect to home or login page
    }
  }, [isAuthenticated, user, isLoading, navigate]);

  // Show loading or nothing while authentication state is loading
  if (isLoading || !isAuthenticated || !user?.is_admin) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black to-gray-900">
            <div className="text-white text-xl">{isLoading ? "Loading user data..." : "Access Denied"}</div>
        </div>
    );
  }

  // Render admin content only if authenticated and is admin
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-6">Admin Dashboard</h1>
        <p className="text-gray-400">Welcome, Admin! This is your exclusive access page.</p>
        {/* Add admin-specific content here */}
      </div>
    </AppLayout>
  );
};

export default AdminPage; 