import { toast } from "@/hooks/use-toast";

interface LoginCredentials {
  username: string;
  password: string;
}

interface RegisterCredentials {
  username: string;
  email: string;
  fullName: string;
  password: string;
}

interface AuthResponse {
  access_token: string;
  token_type: string;
}

interface UserProfile {
  username: string;
  email: string;
  full_name: string;
  disabled: boolean;
}

// API URL - replace with your actual backend URL
const API_URL = "http://localhost:8000"; // Updated to use standard local development URL

export const authService = {
  async login(credentials: LoginCredentials): Promise<boolean> {
    try {
      console.log("Attempting to login with:", credentials);
      const response = await fetch(`${API_URL}/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Login failed");
      }

      const data: AuthResponse = await response.json();
      console.log("Login successful, received token:", data.access_token);
      
      // Store token in localStorage
      localStorage.setItem("auth_token", data.access_token);
      localStorage.setItem("token_type", data.token_type);
      
      return true;
    } catch (error) {
      console.error("Login error:", error);
      if (error instanceof Error) {
        toast({
          title: "Login Failed",
          description: error.message || "Failed to connect to server. Please check your network connection.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Login Failed",
          description: "Failed to connect to server. Please check your network connection.",
          variant: "destructive",
        });
      }
      return false;
    }
  },

  async register(userData: RegisterCredentials): Promise<boolean> {
    try {
      const response = await fetch(`${API_URL}/signup/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(userData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Registration failed");
      }

      return true;
    } catch (error) {
      console.error("Registration error:", error);
      if (error instanceof Error) {
        toast({
          title: "Registration Failed",
          description: error.message,
          variant: "destructive",
        });
      }
      return false;
    }
  },

  async getCurrentUser(): Promise<UserProfile | null> {
    const token = localStorage.getItem("auth_token");
    const tokenType = localStorage.getItem("token_type");
    
    if (!token || !tokenType) {
      return null;
    }

    try {
      const response = await fetch(`${API_URL}/users/me/`, {
        headers: {
          Authorization: `${tokenType} ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid, clear localStorage
          this.logout();
          return null;
        }
        throw new Error("Failed to get user profile");
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
  },

  logout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("token_type");
  },

  isAuthenticated(): boolean {
    return localStorage.getItem("auth_token") !== null;
  }
};
