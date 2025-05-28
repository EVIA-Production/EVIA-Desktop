import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { authService } from '@/services/authService';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Mail, User, Shield, Save, Lock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface UserProfile {
  username: string;
  email: string;
  full_name: string;
  disabled: boolean;
  is_admin?: boolean;
}

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  disabled: z.boolean(),
  is_admin: z.boolean()
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
  const [changingPassword, setChangingPassword] = useState(false);
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      full_name: '',
      disabled: false,
      is_admin: false
    }
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      newPassword: '',
      confirmPassword: ''
    }
  });

  useEffect(() => {
    if (username) {
      loadUserDetails(username);
    }
  }, [username]);

  const loadUserDetails = async (username: string) => {
    try {
      // TODO: Implement getUserDetails in authService
      // For now, we'll get all users and find the one we want
      const users = await authService.getAllUsers();
      const userDetails = users.find(u => u.username === username);
      
      if (userDetails) {
        setUser(userDetails);
        form.reset({
          email: userDetails.email,
          full_name: userDetails.full_name,
          disabled: userDetails.disabled,
          is_admin: userDetails.is_admin || false
        });
      } else {
        toast({
          title: "Error",
          description: "User not found",
          variant: "destructive",
        });
        navigate('/admin');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load user details",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: FormData) => {

  };

  const onPasswordSubmit = async (data: PasswordFormData) => {
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button
          variant="ghost"
          className="mb-6"
          onClick={() => navigate('/admin')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Users
        </Button>

        <div className="space-y-6">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">{user.full_name}</h1>
            <p className="text-gray-400">User Details</p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)}>
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
                      {...form.register("email")}
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
                      {...form.register("full_name")}
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
                        onCheckedChange={(checked) => form.setValue("is_admin", checked)}
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
                        onCheckedChange={(checked) => form.setValue("disabled", checked)}
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
                  onClick={() => navigate('/admin')}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
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
        </div>

        <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Password</DialogTitle>
            </DialogHeader>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
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
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  {...passwordForm.register("confirmPassword")}
                />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-red-500">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>

              <div className="text-sm text-gray-500">
                <p>Password requirements:</p>
                <ul className="list-disc list-inside">
                  <li>At least 8 characters</li>
                  <li>At least one uppercase letter</li>
                  <li>At least one lowercase letter</li>
                  <li>At least one number</li>
                  <li>At least one special character</li>
                </ul>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsPasswordDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={changingPassword}
                >
                  {changingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Changing Password...
                    </>
                  ) : (
                    "Change Password"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default UserDetailPage; 