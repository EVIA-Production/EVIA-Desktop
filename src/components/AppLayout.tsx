import React from 'react';
import { Button } from '@/components/ui/button';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import EviaLogo from '@/components/EviaLogo';
import { LogIn, MessageSquare, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { isAuthenticated, logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background text-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-border bg-black bg-opacity-60 backdrop-blur-md">
        <EviaLogo className="text-white" />
        {!isAuthenticated ? (
          <div className="flex gap-3">
            <Link to="/login">
              <Button 
                variant="outline" 
                className="border-border bg-transparent hover:bg-accent text-muted-foreground">
                <LogIn className="mr-2 h-4 w-4" /> Sign In
              </Button>
            </Link>
            <Link to="/register">
              <Button 
                variant="default" 
                className="bg-primary text-primary-foreground hover:bg-primary/90">
                Sign Up
                </Button>
            </Link>
          </div>
        ) : (
          <div className="flex gap-3">
            {isAuthenticated && user?.is_admin && location.pathname === '/chats' && (
              <Link to="/admin">
                <Button 
                  variant="outline" 
                  className="border-border bg-transparent hover:bg-accent text-muted-foreground">
                  Admin
                </Button>
              </Link>
            )}
            {location.pathname !== '/chats' && (
              <Link to="/chats">
                <Button 
                  variant="outline" 
                  className="border-border bg-transparent hover:bg-accent text-muted-foreground">
                  <MessageSquare className="mr-2 h-4 w-4" /> My Chats
                </Button>
              </Link>
            )}
            <Button 
              onClick={handleLogout}
              variant="outline" 
              className="border-border bg-transparent hover:bg-accent text-muted-foreground">
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </Button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-gradient-to-br from-black via-black to-purple-950/20 p-4 min-h-0">
        {children}
      </div>
      
      {/* Footer */}
      <footer className="py-6 border-t border-border bg-black bg-opacity-60 backdrop-blur-md mt-8">
        <div className="container mx-auto text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} EVIA Voice Assistant. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
