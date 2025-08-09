import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { authService } from '@/services/authService';
import analyticsService from '@/services/analyticsService';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Mail, User, Shield, Save, Lock, Trash2, BarChart } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

interface UserProfile {
  username: string;
  email: string;
  full_name: string;
  disabled: boolean;
  is_admin?: boolean;
}

interface UserMetrics {
  session_count?: number;
  avg_duration?: number;
  total_suggestions?: number;
  avg_suggestions?: number;
  total_errors?: number;
  avg_transcription_latency?: number;
  avg_suggestion_latency?: number;
  total_token_usage?: number;
  sessions_per_week?: number;
  feature_usage?: Record<string, number>;
  avg_time_to_first?: number;
  error_rate?: number;
  avg_deepgram_time?: number;
  avg_groq_time?: number;
  avg_tokens_per_suggestion?: number;
  total_api_cost?: number;
  deepgram_calls?: number;
  groq_calls?: number;
}

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  disabled: z.boolean().default(false),
  is_admin: z.boolean().default(false)
});

const passwordSchema = z.object({
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof formSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

const UserDetailPage = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      full_name: '',
      disabled: false,
      is_admin: false
    },
    mode: "onChange"
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      newPassword: '',
      confirmPassword: ''
    }
  });

  // Load user details and metrics once callbacks are defined to avoid TDZ
  useEffect(() => {
    if (!username) return;
    loadUserDetails(username);
    loadUserMetrics(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  

  // useEffect is placed after callback definitions to avoid TDZ issues

  const loadUserDetails = useCallback(async (username: string) => {
    try {
      // TODO: Implement getUserDetails in authService
      // For now, we'll get all users and find the one we want
      const users = await authService.getAllUsers();
      const userDetails = users.find(u => u.username === username);
      
      if (userDetails) {
        setUser(userDetails);
        
        // Set form default values
        form.reset({
          email: userDetails.email,
          full_name: userDetails.full_name,
          disabled: userDetails.disabled,
          is_admin: userDetails.is_admin || false
        });
      } else {
        toast({
          title: "User not found",
          description: "Could not find user details",
          variant: "destructive"
        });
        navigate('/admin/users');
      }
    } catch (error) {
      console.error("Error loading user details:", error);
      toast({
        title: "Error",
        description: "Failed to load user details",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [form, navigate, toast]);

  const loadUserMetrics = useCallback(async (username: string) => {
    setLoadingMetrics(true);
    try {
      const userMetrics = await analyticsService.getUserMetrics(username);
      console.log('User metrics loaded:', userMetrics);
      setMetrics(userMetrics);
    } catch (error) {
      console.error('Error loading user metrics:', error);
      toast({
        title: "Error",
        description: "Failed to load user metrics",
        variant: "destructive"
      });
      // Set default metrics on error
      setMetrics({
        session_count: 0,
        avg_duration: 0,
        total_suggestions: 0,
        avg_suggestions: 0,
        total_errors: 0,
        avg_transcription_latency: 0,
        avg_suggestion_latency: 0,
        total_token_usage: 0,
        feature_usage: {},
        sessions_per_week: 0,
        avg_time_to_first: 0,
        error_rate: 0,
        avg_deepgram_time: 0,
        avg_groq_time: 0,
        avg_tokens_per_suggestion: 0,
        total_api_cost: 0,
        deepgram_calls: 0,
        groq_calls: 0
      });
    } finally {
      setLoadingMetrics(false);
    }
  }, [toast]);

  const onSubmit = async (data: FormData) => {
    if (!user) return;
    
    setSaving(true);
    try {
      const updatedUser = await authService.updateUser(user.username, {
        email: data.email,
        full_name: data.full_name,
        disabled: data.disabled,
        is_admin: data.is_admin
      });
      
      setUser(updatedUser);
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      
      // Reset form state to mark it as "not dirty"
      form.reset({
        email: updatedUser.email,
        full_name: updatedUser.full_name,
        disabled: updatedUser.disabled,
        is_admin: updatedUser.is_admin || false
      });
    } catch (error) {
      console.error("Error updating user:", error);
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordFormData) => {
    if (!user) return;
    
    setChangingPassword(true);
    try {
      await authService.changePassword(user.username, data.newPassword);
      
      toast({
        title: "Success",
        description: "Password changed successfully",
      });
      
      setIsPasswordDialogOpen(false);
      passwordForm.reset();
    } catch (error) {
      console.error("Error changing password:", error);
      toast({
        title: "Error",
        description: "Failed to change password",
        variant: "destructive"
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    
    setDeleting(true);
    try {
      await authService.deleteUser(user.username);
      
      toast({
        title: "Success",
        description: "User deleted successfully",
      });
      
      navigate('/admin/users');
    } catch (error) {
      console.error("Error deleting user:", error);
      toast({
        title: "Error",
        description: "Failed to delete user",
        variant: "destructive"
      });
      setDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  const handleAdminChange = (checked: boolean) => {
    form.setValue("is_admin", checked, { 
      shouldDirty: true,
      shouldValidate: true
    });
  };

  const handleDisabledChange = (checked: boolean) => {
    form.setValue("disabled", checked, { 
      shouldDirty: true,
      shouldValidate: true
    });
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!user) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-full">
          <h1 className="text-2xl font-bold mb-4">User not found</h1>
          <Button onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Users
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {user.username}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  {...passwordForm.register("newPassword")}
                />
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-sm text-red-500">{passwordForm.formState.errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  {...passwordForm.register("confirmPassword")}
                />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-red-500">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPasswordDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={changingPassword}>
                {changingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Changing...
                  </>
                ) : (
                  "Change Password"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {user.username}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="container mx-auto py-6 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/admin/users')}
              className="mr-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">User: {user.username}</h1>
          </div>
          <div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete User
                </>
              )}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="mb-4">
            <TabsTrigger value="profile">Profile Information</TabsTrigger>
            <TabsTrigger value="metrics">User Metrics</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <form onSubmit={(e) => {
              form.handleSubmit(onSubmit)(e);
            }}>
              <Card className="bg-card/50 border-border">
                <CardHeader>
                  <CardTitle>Profile Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center space-x-4">
                    <User className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <Label htmlFor="username" className="text-sm text-gray-400">Username</Label>
                      <Input
                        id="username"
                        value={user.username}
                        disabled
                        className="mt-1 bg-card/50"
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Mail className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <Label htmlFor="email" className="text-sm text-gray-400">Email</Label>
                      <Input
                        id="email"
                        {...form.register("email", {
                          onChange: (e) => {
                            form.setValue("email", e.target.value, { shouldDirty: true });
                          }
                        })}
                        className="mt-1 bg-card/50"
                      />
                      {form.formState.errors.email && (
                        <p className="text-sm text-red-500 mt-1">{form.formState.errors.email.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <User className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <Label htmlFor="full_name" className="text-sm text-gray-400">Full Name</Label>
                      <Input
                        id="full_name"
                        {...form.register("full_name", {
                          onChange: (e) => {
                            form.setValue("full_name", e.target.value, { shouldDirty: true });
                          }
                        })}
                        className="mt-1 bg-card/50"
                      />
                      {form.formState.errors.full_name && (
                        <p className="text-sm text-red-500 mt-1">{form.formState.errors.full_name.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Shield className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="is_admin" className="text-sm text-gray-400">Admin Access</Label>
                        <Switch
                          id="is_admin"
                          checked={form.watch("is_admin")}
                          onCheckedChange={handleAdminChange}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Shield className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="disabled" className="text-sm text-gray-400">Account Status</Label>
                        <Switch
                          id="disabled"
                          checked={form.watch("disabled")}
                          onCheckedChange={handleDisabledChange}
                        />
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {form.watch("disabled") ? "Disabled" : "Active"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Lock className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsPasswordDialogOpen(true)}
                        className="w-full"
                      >
                        Change Password
                      </Button>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/admin/users')}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving || !form.formState.isDirty}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </TabsContent>

          <TabsContent value="metrics">
            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <BarChart className="h-5 w-5 mr-2" />
                  User Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingMetrics ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : !metrics ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No metrics available for this user.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Top KPIs */}
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-3">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Sessions</h3>
                      <p className="text-3xl font-bold">{metrics.session_count ?? 0}</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-3">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Session Duration</h3>
                      <p className="text-3xl font-bold">{metrics.avg_duration?.toFixed(2) ?? '0.00'} s</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-3">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Time to First</h3>
                      <p className="text-3xl font-bold">{metrics.avg_time_to_first?.toFixed(2) ?? '0.00'} s</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-3">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Error Rate</h3>
                      <p className="text-3xl font-bold">{metrics.error_rate?.toFixed(2) ?? '0.00'}</p>
                    </div>

                    {/* Usage and cost */}
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Suggestions</h3>
                      <p className="text-3xl font-bold">{metrics.total_suggestions ?? 0}</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Suggestions / Session</h3>
                      <p className="text-3xl font-bold">{metrics.avg_suggestions?.toFixed(2) ?? '0.00'}</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Total API Cost (est.)</h3>
                      <p className="text-3xl font-bold">${metrics.total_api_cost?.toFixed(2) ?? '0.00'}</p>
                    </div>

                    {/* Performance */}
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-6">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Suggestion Latency</h3>
                      <p className="text-3xl font-bold">{metrics.avg_suggestion_latency?.toFixed(2) ?? '0.00'} ms</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-6">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Transcription Latency</h3>
                      <p className="text-3xl font-bold">{metrics.avg_transcription_latency?.toFixed(2) ?? '0.00'} ms</p>
                    </div>

                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Deepgram Time</h3>
                      <p className="text-3xl font-bold">{metrics.avg_deepgram_time?.toFixed(2) ?? '0.00'} s</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Groq Time</h3>
                      <p className="text-3xl font-bold">{metrics.avg_groq_time?.toFixed(2) ?? '0.00'} s</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-4">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Avg. Tokens / Suggestion</h3>
                      <p className="text-3xl font-bold">{metrics.avg_tokens_per_suggestion?.toFixed(2) ?? '0.00'}</p>
                    </div>

                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-6">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Token Usage</h3>
                      <p className="text-3xl font-bold">{metrics.total_token_usage ?? 0}</p>
                    </div>
                    <div className="bg-background/50 p-4 rounded-lg border border-border lg:col-span-6">
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Sessions / Week</h3>
                      <p className="text-3xl font-bold">{metrics.sessions_per_week?.toFixed(2) ?? '0.00'}</p>
                    </div>
                  </div>
                )}

                {metrics && metrics.feature_usage && Object.keys(metrics.feature_usage).length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-2">Feature Usage</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.entries(metrics.feature_usage).map(([k, v]) => (
                        <div key={k} className="bg-background/50 p-4 rounded-lg border border-border">
                          <h4 className="text-sm font-medium text-muted-foreground mb-2">{k}</h4>
                          <p className="text-2xl font-bold">{v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default UserDetailPage;