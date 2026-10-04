-- Create razorpay_settings table for Razorpay payment gateway integration

CREATE TABLE IF NOT EXISTS razorpay_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT false,
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT razorpay_settings_singleton CHECK (id = 1)
);

ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY;

-- FIX (4 Oct 2026): a policy named "Allow service role full access" used to be
-- created here with USING (true) and no TO clause. Despite its name that
-- applies to EVERY role, so the browser-safe anon key could read and rewrite
-- this table - including the gateway secrets. The service-role key bypasses
-- RLS and never needed a policy; RLS on with no policy is the locked-down
-- state. See supabase-schema.sql for the full, current schema.
DROP POLICY IF EXISTS "Allow service role full access" ON razorpay_settings;


-- Insert default row
INSERT INTO razorpay_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
