
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

// When in development use localhost URL, in production use absolute URL
const API_URL = window.location.hostname === 'localhost' 
  ? "http://localhost:5001"
  : "http://localhost:5001"; // Change this to your actual backend URL in production

export const authService = {
  async login(credentials: LoginCredentials): Promise<boolean> {
    try {
      console.log("Attempting to login with:", credentials);
      const response = await fetch(`${API_URL}/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        mode: 'cors',
        body: JSON.stringify(credentials),
      });

      // Log the actual response for debugging
      console.log("Login response status:", response.status);
      const responseText = await response.text();
      console.log("Login response body:", responseText);

      // If not JSON, handle accordingly
      if (!response.ok) {
        throw new Error(responseText || "Login failed");
      }

      // Try to parse the response as JSON
      let data: AuthResponse;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse JSON response:", e);
        throw new Error("Invalid response format from server");
      }
      
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
          "Accept": "application/json",
        },
        mode: 'cors',
        body: JSON.stringify(apiData),
      });

      // Log the actual response for debugging
      console.log("Registration response status:", response.status);
      const responseText = await response.text();
      console.log("Registration response body:", responseText);

      if (!response.ok) {
        throw new Error(responseText || "Registration failed");
      }

      // Try to parse JSON if possible
      try {
        const jsonData = JSON.parse(responseText);
        console.log("Registration successful, API response:", jsonData);
      } catch (e) {
        console.warn("Response is not JSON format, but registration may still be successful");
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
          "Authorization": `${tokenType} ${token}`,
          "Accept": "application/json",
        },
        mode: 'cors',
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid, clear localStorage
          this.logout();
          return null;
        }
        const responseText = await response.text();
        console.error("Failed to get user profile:", responseText);
        throw new Error("Failed to get user profile");
      }

      const responseText = await response.text();
      
      try {
        return JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse user profile response:", e);
        return null;
      }
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
