-- Create payment_settings table: the single admin-configured switch for
-- which payment mode BlockMyCard's "save your cards" upsell uses.
--
-- mode = 'free'     -> no fee at all, cards saved for free (app.js hides
--                       the fee amount and skips paidAmount entirely)
-- mode = 'dummy'    -> current/default behaviour: a simulated fee is shown
--                       and "paid" and no real gateway is called (matches
--                       what the app has always done)
-- mode = 'razorpay' | 'cashfree' | 'payu' | 'easebuzz'
--                   -> a real gateway is selected and its credentials are
--                       saved here. NOTE: as of this table's creation, the
--                       frontend checkout flow does NOT call any of these
--                       gateways yet - selecting one only stores the admin's
--                       choice and credentials for a future round to wire
--                       up. Until then the user-facing flow still behaves
--                       exactly like 'dummy' (see app.js's savePrompt
--                       screen), so nothing breaks by selecting a gateway
--                       early.
--
-- Razorpay's credentials here are mirrored into the existing
-- razorpay_settings table (see razorpay_table.sql) by the /api/payment/settings
-- POST handler in server.js, so the already-built Razorpay checkout backend
-- (/api/razorpay/create-order, /api/razorpay/verify-payment) stays in sync
-- and ready to be wired up later without a separate migration.

CREATE TABLE IF NOT EXISTS payment_settings (
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

ALTER TABLE payment_settings ENABLE ROW LEVEL SECURITY;

-- Same pattern as razorpay_settings/email_settings: only the server's
-- service-role key ever talks to this table, so a permissive policy here is
-- fine - the real access control is lib/admin-auth.js's checkAdminAccess()
-- gate in front of the /api/payment/settings routes.
CREATE POLICY "Allow service role full access" ON payment_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Default row: dummy mode, matching the app's existing behaviour exactly
-- until an admin deliberately picks Free or a gateway.
INSERT INTO payment_settings (id, mode)
VALUES (1, 'dummy')
ON CONFLICT (id) DO NOTHING;
