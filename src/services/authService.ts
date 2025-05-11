
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
const API_URL = import.meta.env.DEV 
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
        },
        body: JSON.stringify(credentials),
        credentials: 'include',
      });

      console.log("Login response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Login error response:", errorText);
        throw new Error(errorText || `HTTP error! Status: ${response.status}`);
      }

      // Try to parse the response as JSON
      const responseText = await response.text();
      console.log("Login response body:", responseText);
      
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
      throw error;
    }
  },

  async register(userData: RegisterCredentials): Promise<boolean> {
    try {
      // Convert frontend camelCase to backend snake_case
      const apiData = {
        username: userData.username,
        email: userData.email,
        full_name: userData.fullName,
        password: userData.password
      };

      console.log("Registering user with:", apiData);
      
      const response = await fetch(`${API_URL}/signup/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
        credentials: 'include',
      });

      console.log("Registration response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Registration error response:", errorText);
        throw new Error(errorText || `HTTP error! Status: ${response.status}`);
      }

      const responseText = await response.text();
      console.log("Registration response body:", responseText);
      
      // Try to parse JSON if the response is not empty
      if (responseText.trim()) {
        try {
          const jsonData = JSON.parse(responseText);
          console.log("Registration successful, API response:", jsonData);
        } catch (e) {
          console.warn("Response is not JSON format, but registration may still be successful");
        }
      }
      
      return true;
    } catch (error) {
      console.error("Registration error:", error);
      throw error;
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
        },
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid, clear localStorage
          this.logout();
          return null;
        }
        const errorText = await response.text();
        console.error("Failed to get user profile:", errorText);
        throw new Error("Failed to get user profile");
      }

      const responseText = await response.text();
      console.log("User profile response:", responseText);
      
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
