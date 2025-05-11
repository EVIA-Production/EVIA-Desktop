
import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { authService } from '@/services/authService';
import { useToast } from '@/hooks/use-toast';

interface UserProfile {
  username: string;
  email: string;
  full_name: string;
  disabled: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  register: (userData: {
    username: string;
    email: string;
    fullName: string;
    password: string;
  }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const loadUser = async () => {
      setIsLoading(true);
      try {
        const user = await authService.getCurrentUser();
        setUser(user);
      } catch (error) {
        console.error("Error loading user:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = async (username: string, password: string) => {
    setIsLoading(true);
    try {
      console.log("AuthContext: Logging in with:", { username });
      const success = await authService.login({ username, password });
      if (success) {
        const user = await authService.getCurrentUser();
        setUser(user);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login error in AuthContext:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: {
    username: string;
    email: string;
    fullName: string;
    password: string;
  }) => {
    setIsLoading(true);
    try {
      const success = await authService.register(userData);
      if (success) {
        return true;
      }
      return false;
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registration Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    register,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
