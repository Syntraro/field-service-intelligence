-- Migration: Create audit_events table for security and compliance logging
-- Tracks sensitive team management actions

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    actor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    target_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    metadata JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS audit_events_company_id_idx ON audit_events(company_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_user_id_idx ON audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS audit_events_target_user_id_idx ON audit_events(target_user_id);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events(created_at DESC);

-- Composite index for common audit queries
CREATE INDEX IF NOT EXISTS audit_events_company_action_created_idx
    ON audit_events(company_id, action, created_at DESC);

COMMENT ON TABLE audit_events IS 'Security audit trail for sensitive actions';
COMMENT ON COLUMN audit_events.action IS 'Action type: TEAM_MEMBER_CREATED, EMAIL_CHANGED, PASSWORD_RESET, ROLE_CHANGED, USER_ENABLED, USER_DISABLED';
COMMENT ON COLUMN audit_events.metadata IS 'Additional context (e.g., old/new values, reason)';
