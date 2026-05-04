import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
// 2026-05-04 Phase 7: dropped `isPlatformRole` import — the platform-role
// post-login redirect branch was dead code after Phase 6.
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

/**
 * Auth-page prefixes that must NEVER be honored as a `returnTo` target —
 * sending the user back to /login (or any other auth surface) right after
 * a successful login produces an immediate bounce/loop. The sanitiser
 * below treats any such `returnTo` the same as "no returnTo provided".
 */
const AUTH_PAGE_PREFIXES = ["/login", "/signup", "/request-reset", "/reset-password"];

function isSafeOfficeReturnTo(raw: string | null): raw is string {
  if (!raw) return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false; // protocol-relative URL — never trust
  for (const p of AUTH_PAGE_PREFIXES) {
    if (raw === p || raw.startsWith(p + "/") || raw.startsWith(p + "?")) return false;
  }
  return true;
}

function isSafeTechReturnTo(raw: string | null): raw is string {
  return !!raw && raw.startsWith("/tech/");
}

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

  /**
   * 2026-05-03 first-login race fix (final form): navigation now depends
   * ONLY on the `userData` returned by `await login(...)` — NOT on
   * `useAuth().user` or any AuthProvider context state.
   *
   * Why: the previous `pendingDestination` + `useEffect([user, ...])`
   * approach gated `setLocation` on the React-context `user` becoming
   * truthy. AuthProvider's `user` state is a `useState` that mirrors
   * either the TanStack cache or `setUser(userData)` from the login
   * mutation's `onSuccess`. Both updates are asynchronous from this
   * component's perspective: the effect can't fire until React commits
   * AuthProvider's render. On a clean first login, the navigation
   * effect ran with `user === null` and short-circuited; the state
   * never re-flipped on this Login page (we already setLocation away
   * by then in the second-click path), so the user appeared to be
   * stuck on /login.
   *
   * `await login(...)` resolves with the canonical `User` object the
   * server returned. That value is sufficient for the role-aware
   * destination calculation below — there is no need to wait for any
   * client-side state to update. AuthProvider has already called
   * `setUser(userData)` and `setQueryData(["/api/auth/me"], userData)`
   * inside the mutation's `onSuccess` BEFORE this `await` resolves, so
   * by the time we call `setLocation(destination)`, ProtectedRoute
   * mounts on the new route with a context `user` that has been
   * committed (or is committing in the same render flush as our
   * navigation). The new ProtectedRoute's wipe-condition fix (closed
   * earlier) keeps `user` from being nulled by a stale `/api/auth/me`
   * 401, so even if its initial render happened to read a not-yet-
   * committed `user`, the next render's auth-check would settle it.
   */
  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const userData = await login(data.email, data.password);
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo");

      // Role-aware destination, computed synchronously from the response.
      // 2026-05-04 Phase 7: removed the `isPlatformRole(userData.role)`
      // → /platform/tenants branch. The tenant `/api/auth/login`
      // response carries a `users` row, and after Phase 6's DB CHECK
      // constraint that row cannot hold a platform role — the branch
      // was unreachable. Platform admins sign in exclusively at
      // `/platform/login` (separate page, separate cookie).
      let destination: string;
      if (userData.role === "technician") {
        // Honor returnTo only when it's a /tech/* path — prevents a tech
        // session-expiry from the tech app losing context on re-auth.
        // Office returnTo values are ignored so techs don't land in pages
        // they have no permission to view.
        destination = isSafeTechReturnTo(returnTo) ? returnTo : "/tech/today";
      } else {
        // Office roles: honor any sane non-auth returnTo, else go to root.
        destination = isSafeOfficeReturnTo(returnTo) ? returnTo : "/";
      }

      // Synchronous, immediate. No effect, no React-state gate.
      setLocation(destination);
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
