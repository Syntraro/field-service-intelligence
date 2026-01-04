import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, resetCsrf } from "@/lib/queryClient";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2 } from "lucide-react";

const signupSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

export default function Signup() {
  const [location, setLocation] = useLocation();
  const { signup } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  // Extract invitation token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const invitationToken = urlParams.get('token');

  // Fetch invitation details if token exists
  const { data: invitationData, isLoading: isLoadingInvitation, error: invitationError } = useQuery<any>({
    queryKey: ['/api/invitations', invitationToken],
    enabled: !!invitationToken,
    retry: false,
  });

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
  });

  // Pre-fill email from invitation
  useEffect(() => {
    if (invitationData?.email) {
      form.setValue('email', invitationData.email);
    }
  }, [invitationData, form]);

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true);
    try {
      // Best long-term: use centralized apiRequest() which auto-handles CSRF + credentials
      const userData = await apiRequest<any>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: data.email,
          firstName: data.firstName || undefined,
          lastName: data.lastName || undefined,
          password: data.password,
          invitationToken: invitationToken || undefined,
        }),
      });

      // Session likely changed; force CSRF token refresh on next write request
      resetCsrf();

toast({
        title: "Account created",
        description: invitationToken 
          ? `Welcome to ${invitationData?.companyName || 'the team'}!`
          : "Welcome! Your free trial has started.",
      });

      // Redirect based on role
      if (userData.role === 'technician') {
        setLocation("/technician");
      } else {
        setLocation("/");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Signup failed",
        description: error.message || "Could not create account",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingInvitation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading invitation...</div>
      </div>
    );
  }

  if (invitationToken && invitationError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>This invitation link is invalid or has expired.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              data-testid="button-back-to-login"
              onClick={() => setLocation("/login")}
              className="w-full"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{invitationToken ? "Join Team" : "Sign Up"}</CardTitle>
          <CardDescription>
            {invitationToken 
              ? `You've been invited to join a team`
              : "Create a new account to get started"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitationToken && invitationData && (
            <Alert className="mb-4" data-testid="alert-invitation-info">
              <Building2 className="h-4 w-4" />
              <AlertDescription>
                You're joining <strong>{invitationData.companyName}</strong> as a{" "}
                <strong>{invitationData.role || "technician"}</strong>
              </AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {invitationToken && (
                <>
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-first-name"
                            placeholder="Enter your first name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-last-name"
                            placeholder="Enter your last name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-email"
                        type="email"
                        placeholder="Enter your email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-password"
                        type="password"
                        placeholder="Choose a password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-confirm-password"
                        type="password"
                        placeholder="Confirm your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                data-testid="button-signup"
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Creating account..." : "Sign Up"}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{" "}
            <button
              data-testid="link-login"
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/login")}
            >
              Login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
