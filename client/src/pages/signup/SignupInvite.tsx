import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2 } from "lucide-react";

/**
 * 2026-04-19 staged-signup refactor: the invite flow was extracted from
 * the prior combined Signup.tsx into its own component. The orchestrator
 * short-circuits to this component when `?token=XYZ` is present, so invite
 * users never touch the staged credentials → identity flow.
 *
 * Submit path now routes through `useAuth().signup(payload)` — same shape
 * as the pre-refactor payload, but the mutation's `onSuccess` in
 * AuthProvider performs the atomic `setUser` + cache seed so
 * ProtectedRoute never sees a stale null after navigation. The server
 * contract (POST /api/auth/signup with `invitationToken`) is unchanged.
 */
const inviteSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type InviteFormData = z.infer<typeof inviteSchema>;

export function SignupInvite({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { signup } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const {
    data: invitationData,
    isLoading: isLoadingInvitation,
    error: invitationError,
  } = useQuery<any>({
    queryKey: ["/api/invitations", token],
    enabled: Boolean(token),
    retry: false,
  });

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (invitationData?.email) form.setValue("email", invitationData.email);
  }, [invitationData, form]);

  const onSubmit = async (data: InviteFormData) => {
    setIsLoading(true);
    try {
      // Same atomic-setUser fix as the staged public path — route
      // through useAuth().signup() so ProtectedRoute sees the new
      // session on the first render after navigation.
      await signup({
        email: data.email,
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
        password: data.password,
        invitationToken: token,
      });

      toast({
        title: "Account created",
        description: `Welcome to ${invitationData?.companyName || "the team"}!`,
      });
      setLocation("/");
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
    return <div className="text-lg">Loading invitation...</div>;
  }

  if (invitationError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid Invitation</CardTitle>
          <CardDescription>
            This invitation link is invalid or has expired.
          </CardDescription>
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
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-xl">Join Team</CardTitle>
        <CardDescription>You've been invited to join a team</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {invitationData && (
          <Alert className="mb-3" data-testid="alert-invitation-info">
            <Building2 className="h-4 w-4" />
            <AlertDescription>
              You're joining <strong>{invitationData.companyName}</strong> as a{" "}
              <strong>{invitationData.role || "technician"}</strong>
            </AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
              {isLoading ? "Creating account..." : "Join Team"}
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
  );
}
