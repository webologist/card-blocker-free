-- supabase-schema.sql
-- Every table BlockMyCard needs, in one idempotent script. Added 4 Oct 2026
-- when the app had to be pointed at a new Supabase project and the table
-- definitions turned out to be scattered across payment_settings_table.sql,
-- razorpay_table.sql, create-email-tables.js and CREATE_TABLE_MANUAL.md -
-- with kv_store (the table that holds every user, card and log entry) not
-- written down anywhere at all.
--
-- HOW TO USE: Supabase dashboard -> SQL Editor -> New query -> paste this
-- whole file -> Run. Safe to run again at any time: it creates what is
-- missing and never drops or overwrites data.
--
-- ACCESS MODEL: Row Level Security is ON for every table and there are NO
-- policies. That means the browser-safe "anon"/"publishable" key can read and
-- write nothing; only the server's service-role key (SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS) can. All real access control lives in the API routes
-- (lib/storage-policy.js, lib/admin-auth.js).
--
-- payment_settings_table.sql and razorpay_table.sql used to add a policy
-- named "Allow service role full access" with USING (true) and no TO clause.
-- Despite the name, that grants EVERY role - including anon - full read and
-- write on the tables holding the payment-gateway secrets. The service role
-- never needed a policy in the first place, so this script removes those.

-- ── kv_store: users, cards, activity log, feedback, banks, templates, the
--    OTP-mode switch, rate-limit counters and stored contact-form messages ──
CREATE TABLE IF NOT EXISTS public.kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.kv_store ENABLE ROW LEVEL SECURITY;

-- ── email_settings: the admin console's Email Integrations tab (single row) ──
CREATE TABLE IF NOT EXISTS public.email_settings (
  id INT PRIMARY KEY DEFAULT 1,
  active_provider TEXT,
  brevo_api_key TEXT,
  brevo_from_email TEXT,
  brevo_from_name TEXT,
  ses_access_key_id TEXT,
  ses_secret_access_key TEXT,
  ses_region TEXT,
  ses_from_email TEXT,
  gmail_address TEXT,
  gmail_app_password TEXT,
  gmail_from_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT email_settings_singleton CHECK (id = 1)
);
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

-- ── login_email_log: one row per login email already sent (de-duplication) ──
CREATE TABLE IF NOT EXISTS public.login_email_log (
  phone TEXT NOT NULL,
  ts TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (phone, ts)
);
ALTER TABLE public.login_email_log ENABLE ROW LEVEL SECURITY;

-- ── user_directory: optional phone -> email lookup read by /api/login-email
--    before it falls back to kv_store. Nothing writes to it today; it must
--    exist so that lookup does not error. ──
CREATE TABLE IF NOT EXISTS public.user_directory (
  phone TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_directory ENABLE ROW LEVEL SECURITY;

-- ── payment_settings: the admin console's Payment Gateway tab (single row) ──
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id INT PRIMARY KEY DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'dummy',
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  cashfree_app_id TEXT,
  cashfree_secret_key TEXT,
  payu_merchant_key TEXT,
  payu_salt TEXT,
  easebuzz_key TEXT,
  easebuzz_salt TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT payment_settings_singleton CHECK (id = 1),
  CONSTRAINT payment_settings_mode_check
    CHECK (mode IN ('free', 'dummy', 'razorpay', 'cashfree', 'payu', 'easebuzz'))
);
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow service role full access" ON public.payment_settings;
INSERT INTO public.payment_settings (id, mode) VALUES (1, 'dummy') ON CONFLICT (id) DO NOTHING;

-- ── razorpay_settings: kept in sync by /api/payment/settings (single row) ──
CREATE TABLE IF NOT EXISTS public.razorpay_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT false,
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT razorpay_settings_singleton CHECK (id = 1)
);
ALTER TABLE public.razorpay_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow service role full access" ON public.razorpay_settings;
INSERT INTO public.razorpay_settings (id, enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

-- ── Check: should list all six tables with rowsecurity = true ──
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('kv_store', 'email_settings', 'login_email_log',
                    'user_directory', 'payment_settings', 'razorpay_settings')
ORDER BY tablename;
