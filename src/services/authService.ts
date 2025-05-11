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

// Set API URL to the known working backend endpoint
const API_URL = "http://localhost:5001";

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
        // Remove credentials: 'include' as we're using JWT
      });

      console.log("Login response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Login error response:", errorText);
        throw new Error(errorText || `HTTP error! Status: ${response.status}`);
      }

      // Parse JSON directly from response
      const data: AuthResponse = await response.json();
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
      
      // Create request options with explicit CORS settings
      const response = await fetch(`${API_URL}/signup/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": window.location.origin
        },
        body: JSON.stringify(apiData),
        mode: 'cors',
      });

      console.log("Registration response status:", response.status);
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error("Registration error response:", errorData);
        
        // Try to parse as JSON if possible
        let errorMessage = `HTTP error! Status: ${response.status}`;
        try {
          const parsedError = JSON.parse(errorData);
          errorMessage = parsedError.detail || parsedError.message || errorMessage;
        } catch (e) {
          // If it's not JSON (could be HTML), use a generic error
          if (errorData.includes("<!DOCTYPE html>")) {
            errorMessage = `Server error (${response.status}). Please try again later.`;
          } else {
            errorMessage = errorData || errorMessage;
          }
        }
        
        throw new Error(errorMessage);
      }

      let responseData;
      const responseText = await response.text();
      console.log("Registration response body:", responseText);
      
      // Try to parse JSON if the response is not empty
      if (responseText.trim()) {
        try {
          responseData = JSON.parse(responseText);
          console.log("Registration successful, API response:", responseData);
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
          "Accept": "application/json",
          "Origin": window.location.origin
        },
        mode: 'cors'
        // Removed credentials: 'include' as we're using JWT
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
