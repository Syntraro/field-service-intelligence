import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AuthLayout } from "@/components/AuthLayout";
import { SignupInvite } from "./signup/SignupInvite";
import { StepCredentials } from "./signup/StepCredentials";
import { StepIdentity } from "./signup/StepIdentity";
import {
  publicSignupSchema,
  type PublicSignupFormData,
} from "./signup/publicSignupSchema";

/**
 * 2026-04-19 staged signup orchestrator.
 *
 *  - URL `/signup?token=XYZ`  -> invite flow (single-step, preserved verbatim).
 *  - URL `/signup`            -> staged public flow:
 *      Step 1 (StepCredentials): email + password + confirmPassword
 *      Step 2 (StepIdentity):    first/last + optional business info
 *      Single POST to /api/auth/signup fires on Step 2 submit.
 *
 * Form state is hoisted here (one react-hook-form instance) so the Back
 * button on Step 2 preserves Step 1 values.
 *
 * Server handler is unchanged — this is a pure UX restructure.
 */
export default function Signup() {
  const urlParams = new URLSearchParams(window.location.search);
  const invitationToken = urlParams.get("token");

  // Invite flow short-circuit: never reaches the staged state machinery.
  if (invitationToken) {
    return (
      <AuthLayout>
        <SignupInvite token={invitationToken} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <StagedPublicSignup />
    </AuthLayout>
  );
}

function StagedPublicSignup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { signup } = useAuth();
  const [step, setStep] = useState<"credentials" | "identity">("credentials");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<PublicSignupFormData>({
    resolver: zodResolver(publicSignupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
      companyName: "",
      companyPhone: "",
    },
    mode: "onBlur",
  });

  const handleFinalSubmit = async () => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      const data = form.getValues();
      const payload = {
        email: data.email,
        password: data.password,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        companyName: data.companyName?.trim() || undefined,
        companyPhone: data.companyPhone?.trim() || undefined,
      };

      // 2026-04-19 auth-bounce fix: route through useAuth().signup()
      // instead of calling apiRequest + setQueryData here. The mutation's
      // onSuccess in AuthProvider calls setUser() atomically with the
      // query cache write, so ProtectedRoute on /onboarding reads an
      // authenticated user on first mount — no bounce to /login.
      await signup(payload);

      toast({
        title: "Account created",
        description: "Welcome! Let's finish setting up.",
      });
      setLocation("/onboarding");
    } catch (err: any) {
      const message =
        err?.message || "Could not create account. Please try again.";
      setServerError(message);
      toast({
        variant: "destructive",
        title: "Signup failed",
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "credentials") {
    return (
      <StepCredentials
        form={form}
        onContinue={() => setStep("identity")}
      />
    );
  }

  return (
    <StepIdentity
      form={form}
      onBack={() => setStep("credentials")}
      onSubmit={handleFinalSubmit}
      isSubmitting={isSubmitting}
      serverError={serverError}
    />
  );
}
