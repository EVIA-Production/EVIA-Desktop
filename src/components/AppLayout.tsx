
import React from 'react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import EviaLogo from '@/components/EviaLogo';
import { LogIn } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-black bg-opacity-60 backdrop-blur-md">
        <EviaLogo className="text-white" />
        <div className="flex gap-3">
          <Link to="/login">
            <Button variant="outline" className="border-gray-600 hover:bg-gray-800 text-white">
              <LogIn className="mr-2 h-4 w-4" /> Sign In
            </Button>
          </Link>
          <Link to="/register">
            <Button variant="default" className="bg-evia-pink hover:bg-pink-700">
              Sign Up
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      {children}
      
      {/* Footer */}
      <footer className="py-6 border-t border-gray-800 bg-black bg-opacity-60 backdrop-blur-md mt-8">
        <div className="container mx-auto text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} EVIA Voice Assistant. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
