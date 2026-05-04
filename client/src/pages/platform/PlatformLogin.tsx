/**
 * PlatformLogin — SaaS Admin Phase 1 Platform Auth Separation.
 *
 * 2026-04-22: dedicated login surface for the internal /platform admin
 * console. Posts to `/api/platform/auth/login`, which establishes the
 * `psid` session cookie (separate from the tenant `sid` cookie). On
 * success the user lands at `/platform/tenants`.
 *
 * No tenant chrome — this is intentionally visually distinct from the
 * customer-facing `/login` page. No signup, no password reset link
 * (platform accounts are provisioned out-of-band). Platform admins should
 * never visually confuse the tenant login with the platform login.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface PlatformLoginResponse {
  user: {
    id: string;
    email: string;
    role: string;
    fullName: string | null;
  };
}

export default function PlatformLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      await apiRequest<PlatformLoginResponse>("/api/platform/auth/login", {
        method: "POST",
        body: JSON.stringify(data),
      });
      // Successful login — psid cookie set; hard redirect so the new
      // platform auth context hydrates cleanly.
      setLocation("/platform/tenants");
    } catch (err: any) {
      const message = err?.message || "Invalid email or password";
      toast({
        variant: "destructive",
        title: "Login failed",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-950 p-4"
      data-testid="platform-login"
    >
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Internal
            </span>
          </div>
          <CardTitle className="text-xl">Platform admin login</CardTitle>
          <CardDescription className="text-slate-400">
            Ops portal. Tenant accounts cannot sign in here.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                        data-testid="platform-input-email"
                        type="email"
                        autoComplete="username"
                        placeholder="ops@example.com"
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
                        data-testid="platform-input-password"
                        type="password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="platform-button-login"
              >
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
          {/* 2026-05-03: dedicated platform password reset flow. Uses
              `/platform/request-reset` — explicitly NOT the tenant
              `/request-reset` so a forgotten-platform-password attempt
              cannot accidentally route into the tenant reset surface. */}
          <div className="mt-3 text-center">
            <button
              type="button"
              className="text-xs text-slate-400 underline-offset-4 hover:underline hover:text-slate-200"
              onClick={() => setLocation("/platform/request-reset")}
              data-testid="platform-link-forgot-password"
            >
              Forgot password?
            </button>
          </div>
          <div className="mt-4 text-center text-xs text-slate-500">
            Not a platform admin?{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/login")}
              data-testid="platform-link-tenant-login"
            >
              Tenant login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
