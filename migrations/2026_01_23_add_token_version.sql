-- Migration: Add tokenVersion for session invalidation
-- When tokenVersion is incremented, all existing sessions for that user become invalid.
-- This is used when password or email is changed to force re-authentication.

-- Add tokenVersion column to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Create index for faster lookups during session validation
CREATE INDEX IF NOT EXISTS users_token_version_idx ON users(id, token_version);
