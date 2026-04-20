import { useState } from "react";
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
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // 2026-04-10 Phase-2 Fix D: explicit post-login navigation. The previous
  // implementation used a `useEffect(() => if (user) setLocation(returnTo))`
  // which caused the session-expired loop — a stale truthy `user` from the
  // pre-expiration session would fire that effect on Login mount and
  // immediately bounce the user back into the protected app, where the
  // 401 storm would reopen the modal. Now we navigate ONLY after a fresh
  // `await login()` resolves successfully — explicit beats reactive.
  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const userData = await login(data.email, data.password);
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo");
      // Role-aware destination, computed at the moment of success.
      if (userData.role === "technician") {
        // Honor returnTo only when it's a /tech/* path — prevents a tech
        // session-expiry from the tech app losing context (e.g., an open
        // visit detail) on re-auth. Office returnTo values are ignored so
        // techs don't land in pages they have no permission to view.
        if (returnTo && returnTo.startsWith("/tech/")) {
          setLocation(returnTo);
          return;
        }
        setLocation("/tech/today");
        return;
      }
      // Platform roles land in the Ops Portal — never the tenant shell.
      if (isPlatformRole(userData.role)) {
        setLocation("/platform/tenants");
        return;
      }
      setLocation(returnTo && returnTo.startsWith("/") ? returnTo : "/");
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
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
