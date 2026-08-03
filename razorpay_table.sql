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

-- Create policy for service role access
CREATE POLICY "Allow service role full access" ON razorpay_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert default row
INSERT INTO razorpay_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
