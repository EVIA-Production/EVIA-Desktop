
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

// API URL - update to match the correct backend URL
const API_URL = "https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io";

export const authService = {
  async login(credentials: LoginCredentials): Promise<boolean> {
    try {
      console.log("Attempting to login with:", credentials);
      const response = await fetch(`${API_URL}/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add CORS headers
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        mode: "cors", // Explicitly set CORS mode
        credentials: "same-origin", // Use 'include' only if the API expects cookies
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
      // Convert frontend camelCase to backend snake_case
      const apiData = {
        username: userData.username,
        email: userData.email,
        full_name: userData.fullName, // Convert fullName to full_name as expected by the API
        password: userData.password
      };

      console.log("Registering user with:", apiData);
      
      const response = await fetch(`${API_URL}/signup/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add CORS headers
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        mode: "cors", // Explicitly set CORS mode
        credentials: "same-origin", // Use 'include' only if the API expects cookies
        body: JSON.stringify(apiData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Registration API error response:", errorData);
        throw new Error(errorData.detail || "Registration failed");
      }

      console.log("Registration successful, API response:", await response.json());
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
          // Add CORS headers
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        mode: "cors", // Explicitly set CORS mode
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
