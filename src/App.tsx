import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ChatList from "./pages/ChatList";
import NotFound from "./pages/NotFound";
import AdminPage from "./pages/AdminPage";
import UserDetailPage from "./pages/UserDetailPage";
import ProtectedAdminRoute from "./components/ProtectedAdminRoute";
import AdminDashboard from "./pages/AdminDashboard";
import UserManagement from "./pages/Admin";
import PromptsManagement from "./pages/PromptsManagement";
import About from "./pages/About";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import AdminMetrics from "./pages/AdminMetrics";
import Welcome from "./pages/Welcome";
import Desktop from "./pages/Desktop";
import Download from "./pages/Download";

const queryClient = new QueryClient();

const App = () => {
  // Add dark mode class to html element
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/chats" element={<ChatList />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/desktop" element={<Desktop />} />
              <Route path="/download" element={<Download />} />
              <Route
                path="/admin"
                element={
                  <ProtectedAdminRoute>
                    <AdminDashboard />
                  </ProtectedAdminRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedAdminRoute>
                    <UserManagement />
                  </ProtectedAdminRoute>
                }
              />
              <Route
                path="/admin/prompts"
                element={
                  <ProtectedAdminRoute>
                    <PromptsManagement />
                  </ProtectedAdminRoute>
                }
              />
              <Route
                path="/admin/metrics"
                element={
                  <ProtectedAdminRoute>
                    <AdminMetrics />
                  </ProtectedAdminRoute>
                }
              />
              <Route
                path="/prompts"
                element={<PromptsManagement />}
              />
              <Route 
                path="/admin/users/:username" 
                element={
                  <ProtectedAdminRoute>
                    <UserDetailPage />
                  </ProtectedAdminRoute>
                } 
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
