import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { isPlatformRole } from "@/lib/platformRoles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AuthLayout } from "@/components/AuthLayout";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  // 2026-05-03 first-login race fix (client-navigation half): instead of
  // calling `setLocation(...)` synchronously after `await login(...)`, we
  // stash the role-aware destination here and let the effect below
  // navigate ONLY once the AuthProvider's `user` context value reflects
  // the freshly-logged-in identity. This guarantees ProtectedRoute mounts
  // on the new route with a non-null `user` already visible — no stale-
  // null-then-bounce-back-to-/login race. `pendingDestination` is null
  // by default and only set by a successful submit, so we preserve the
  // 2026-04-10 Phase-2 Fix D invariant: this Login page never bounces a
  // mounting user into the protected app on the strength of a stale
  // truthy `user` alone. Both gates (intent + committed user) must hold.
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    // Wait for BOTH: (a) the user explicitly submitted login this session
    // (pendingDestination set by onSubmit on success) AND (b) AuthProvider
    // has committed the new user identity into context. Only then navigate.
    // Clearing `pendingDestination` immediately after the call prevents
    // double-navigation if React fires the effect again (e.g., StrictMode
    // dev double-mount or a follow-up data refresh re-rendering AuthProvider).
    if (!pendingDestination || !user) return;
    const dest = pendingDestination;
    setPendingDestination(null);
    setLocation(dest);
  }, [user, pendingDestination, setLocation]);

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const userData = await login(data.email, data.password);
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo");
      // Role-aware destination, computed at the moment of success. The
      // value flows through `pendingDestination` so the effect above can
      // navigate AFTER AuthProvider commits `user`. Behavior preserved
      // from the prior synchronous implementation — only the dispatch
      // mechanism changed.
      let destination: string;
      if (userData.role === "technician") {
        // Honor returnTo only when it's a /tech/* path — prevents a tech
        // session-expiry from the tech app losing context (e.g., an open
        // visit detail) on re-auth. Office returnTo values are ignored so
        // techs don't land in pages they have no permission to view.
        destination = (returnTo && returnTo.startsWith("/tech/")) ? returnTo : "/tech/today";
      } else if (isPlatformRole(userData.role)) {
        // Platform roles land in the Ops Portal — never the tenant shell.
        destination = "/platform/tenants";
      } else {
        destination = (returnTo && returnTo.startsWith("/")) ? returnTo : "/";
      }
      setPendingDestination(destination);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Invalid email or password",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-xl">Login</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
                        placeholder="Enter your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                data-testid="button-login"
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            <button
              data-testid="link-forgot-password"
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/request-reset")}
            >
              Forgot password?
            </button>
          </div>
          <div className="mt-2 text-center text-sm">
            Don't have an account?{" "}
            <button
              data-testid="link-signup"
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/signup")}
            >
              Sign up
            </button>
          </div>
          {/* 2026-04-22 Phase 1 Platform Auth Separation: platform admins
              authenticate via a separate surface. */}
          <div className="mt-3 text-center text-xs text-muted-foreground">
            Platform admin?{" "}
            <button
              data-testid="link-platform-login"
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/platform/login")}
            >
              Log in here
            </button>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
