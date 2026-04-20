import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { storage } from "./storage/index";
import type { User, AuthenticatedUser } from "@shared/schema";

/**
 * Passport Local Strategy using user_identities table for auth.
 *
 * Auth flow (simplified with global email uniqueness):
 * 1. Normalize email input
 * 2. Look up identity by email (global - one email = one company)
 * 3. Verify password against identity.passwordHash
 * 4. Load user using identity.userId + identity.companyId
 * 5. Return user for session serialization (user's companyId is the tenant)
 *
 * This approach:
 * - Each email can only exist in one company (global uniqueness)
 * - No tenant selection needed at login - email determines company
 * - Separates login credentials from user identity
 * - Supports future SSO providers
 */
passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      // Normalize email for lookup
      const normalizedEmail = (email || "").trim().toLowerCase();

      // Look up email identity (global - since emails are unique across all companies)
      const result = await storage.findUserByEmailGlobal(normalizedEmail);

      if (!result) {
        return done(null, false, { message: "Invalid email or password" });
      }

      const { user, identity } = result;

      // Check if identity has a password set
      // This catches invited-but-not-activated users who haven't set a password yet
      if (!identity.passwordHash) {
        return done(null, false, {
          message: "Account not activated yet. Please accept your invitation or reset your password."
        });
      }

      // Check if user is disabled
      if (user.disabled || user.status === "deactivated") {
        return done(null, false, { message: "Account is disabled" });
      }

      // Verify password against identity's passwordHash
      const isValidPassword = await bcrypt.compare(password, identity.passwordHash);

      if (!isValidPassword) {
        return done(null, false, { message: "Invalid email or password" });
      }

      // Success - user's companyId from user table is the tenant context
      return done(null, user as any);
    } catch (error) {
      return done(error);
    }
  })
);

/**
 * Session payload includes userId and tokenVersion for session invalidation.
 * When user changes password or email, tokenVersion is incremented,
 * invalidating all existing sessions.
 */
interface SessionPayload {
  userId: string;
  tokenVersion: number;
}

passport.serializeUser((user: any, done) => {
  // Store both userId and tokenVersion in session
  const payload: SessionPayload = {
    userId: user.id,
    tokenVersion: user.tokenVersion ?? 0,
  };
  done(null, payload);
});

passport.deserializeUser(async (payload: SessionPayload | string, done) => {
  try {
    // Handle legacy sessions that only stored userId as string
    const sessionData: SessionPayload = typeof payload === "string"
      ? { userId: payload, tokenVersion: 0 }
      : payload;

    const user = await storage.getUser(sessionData.userId);
    if (!user) {
      return done(null, false);
    }

    // Check tokenVersion - if it doesn't match, session is invalid
    // This happens when user changes password or email
    const currentTokenVersion = user.tokenVersion ?? 0;
    if (currentTokenVersion !== sessionData.tokenVersion) {
      // Session was invalidated by password/email change
      return done(null, false);
    }

    // Fetch company data to merge subscription fields
    const company = await storage.getCompanyById(user.companyId);
    if (!company) {
      return done(null, false);
    }

    // Merge user + company subscription data
    const authenticatedUser: AuthenticatedUser = {
      ...user,
      trialEndsAt: company.trialEndsAt,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionPlan: company.subscriptionPlan,
      stripeCustomerId: company.stripeCustomerId,
      stripeSubscriptionId: company.stripeSubscriptionId,
      billingInterval: company.billingInterval,
      currentPeriodEnd: company.currentPeriodEnd,
      cancelAtPeriodEnd: company.cancelAtPeriodEnd,
      // 2026-04-19 Hybrid SaaS onboarding gate
      onboardingCompletedAt: company.onboardingCompletedAt,
    };

    done(null, authenticatedUser as any);
  } catch (error: any) {
    console.error("Deserialize user error:", error);
    done(error);
  }
});

export { passport };

// Middleware to check if user is authenticated
export function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Middleware to check if user is an admin or owner
export function isAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const userRole = req.user?.role;
  if (userRole !== "owner" && userRole !== "admin") {
    return res.status(403).json({ error: "Access denied. Admin privileges required." });
  }
  
  next();
}

// Middleware to require admin for mutating operations
export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const userRole = req.user?.role;
  if (userRole !== "owner" && userRole !== "admin") {
    return res.status(403).json({ error: "Technicians have read-only access" });
  }
  
  next();
}

// Middleware to ensure user can only access their company's data
export function requireCompanyAccess(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  if (!req.user?.companyId) {
    return res.status(403).json({ error: "User not associated with a company" });
  }
  
  // Store companyId in request for use in routes
  req.companyId = req.user.companyId;
  next();
}
