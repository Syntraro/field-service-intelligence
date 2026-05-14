import type { UseFormReturn } from "react-hook-form";
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
 * 2026-04-19 staged signup — Step 2 of 2.
 *
 * Collects owner identity (required first/last) and optional company
 * info (name, phone). Back returns to Step 1 with all values preserved.
 * Final submit is owned by the orchestrator (single POST for the whole
 * form).
 */
export function StepIdentity({
  form,
  onBack,
  onSubmit,
  isSubmitting,
  serverError,
}: {
  form: UseFormReturn<PublicSignupFormData>;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  serverError: string | null;
}) {
  const handleSubmit = async () => {
    const ok = await form.trigger();
    if (ok) onSubmit();
  };

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-xl">Tell us about you</CardTitle>
        <CardDescription>Just a couple more details.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Form {...form}>
          <div className="space-y-3">
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
                      autoComplete="given-name"
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
                      autoComplete="family-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-2">
              <div className="text-sm font-medium text-foreground">
                Business info (optional)
              </div>
              <p className="text-helper text-muted-foreground mt-1">
                Optional business details can be added later.
              </p>
            </div>

            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Name</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-company-name"
                      placeholder="Business name"
                      autoComplete="organization"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="companyPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Phone</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-company-phone"
                      type="tel"
                      placeholder="(555) 555-0123"
                      autoComplete="tel"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError && (
              <div
                className="text-sm text-destructive"
                data-testid="text-signup-error"
              >
                {serverError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                data-testid="button-signup-back"
                onClick={onBack}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                type="button"
                data-testid="button-signup-submit"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating account..." : "Start Free Trial"}
              </Button>
            </div>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
