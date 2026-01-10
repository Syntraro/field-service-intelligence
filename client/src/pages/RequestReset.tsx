import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const requestResetSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type RequestResetFormData = z.infer<typeof requestResetSchema>;

export default function RequestReset() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<RequestResetFormData>({
    resolver: zodResolver(requestResetSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: RequestResetFormData) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("/api/auth/password-reset-request", { method: "POST", body: JSON.stringify(data) });
      const result = await response.json();
      
      setIsSuccess(true);
      toast({
        title: "Request sent",
        description: result.message || "Check your email for a password reset link",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Request failed",
        description: error.message || "Could not send reset request",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Check Your Email</CardTitle>
            <CardDescription>
              If an account exists with the email you provided, you will receive a password reset link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {import.meta.env.DEV && (
              <div className="p-3 bg-muted rounded-md text-sm">
                <p className="font-medium mb-1">Development Mode</p>
                <p className="text-muted-foreground text-xs">
                  In development mode, the password reset link is logged to the server console. 
                  Check the server logs to find your reset link.
                </p>
              </div>
            )}
            <Button
              data-testid="button-back-to-login"
              onClick={() => setLocation("/login")}
              className="w-full"
            >
              Back to Login
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
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>Enter your email to receive a password reset link</CardDescription>
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
              <Button
                data-testid="button-request-reset"
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Remember your password?{" "}
            <button
              data-testid="link-back-to-login"
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setLocation("/login")}
            >
              Back to Login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
