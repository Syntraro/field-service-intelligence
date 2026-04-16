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
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      // Role-aware destination, computed at the moment of success.
      if (userData.role === "technician") {
        setLocation("/tech/today");
        return;
      }
      // Platform roles land in the Ops Portal — never the tenant shell.
      if (isPlatformRole(userData.role)) {
        setLocation("/platform/tenants");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo");
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
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertDescription className="text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-semibold mb-2">Beta Test Mode</p>
            <p className="mb-2">This is a beta app in test mode, functions are being updated daily.</p>
            <p className="mb-2">Email password reset does not function and can only be changed by the admin. Also the Import client list is in beta.</p>
            <p className="mb-2">Recommendation is to export all your data once entered in the system as a precaution.</p>
            <p>For the completed build please email <a href="mailto:service@samcor.ca" className="underline font-medium">service@samcor.ca</a>.</p>
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
      </div>
    </div>
  );
}
