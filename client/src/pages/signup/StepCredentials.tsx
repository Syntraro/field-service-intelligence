import type { UseFormReturn } from "react-hook-form";
import { useLocation } from "wouter";
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
import type { PublicSignupFormData } from "./publicSignupSchema";

/**
 * 2026-04-19 staged signup — Step 1 of 2.
 *
 * Collects email + password + confirm. No server call. Advances step
 * state in the orchestrator only after per-field validation passes.
 * The form instance is hoisted in Signup.tsx so returning from Step 2
 * via Back preserves all values.
 */
export function StepCredentials({
  form,
  onContinue,
}: {
  form: UseFormReturn<PublicSignupFormData>;
  onContinue: () => void;
}) {
  const [, setLocation] = useLocation();

  const handleContinue = async () => {
    const ok = await form.trigger(["email", "password", "confirmPassword"]);
    if (ok) onContinue();
  };

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Start your 14-day free trial.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Form {...form}>
          <div className="space-y-3">
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
                      placeholder="you@example.com"
                      autoComplete="email"
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
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
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
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              data-testid="button-signup-continue"
              className="w-full"
              onClick={handleContinue}
            >
              Continue
            </Button>
          </div>
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
