// Direct PostgreSQL connection to create razorpay_settings table
require('dotenv').config({ path: '.env.db' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔌 Connecting to Supabase...');
console.log(`📍 URL: ${supabaseUrl}`);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  }
});

async function createTable() {
  try {
    console.log('\n📊 Creating razorpay_settings table...\n');

    // Use Supabase's query function to execute raw SQL
    // First, let's try to create the table using insert which will fail with a clear error if table doesn't exist
    const { error: checkError } = await supabase
      .from('razorpay_settings')
      .select('count', { count: 'exact', head: true });

    if (!checkError) {
      console.log('✅ Table already exists!\n');
      // Get current data
      const { data } = await supabase
        .from('razorpay_settings')
        .select('*');
      console.log('📋 Current data:');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    // Table doesn't exist, we need to use the admin API
    console.log('⚠️  Table doesn\'t exist. Using admin API to create...\n');

    // Try using Supabase functions API as fallback
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query_raw`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          CREATE TABLE IF NOT EXISTS razorpay_settings (
            id INT PRIMARY KEY DEFAULT 1,
            enabled BOOLEAN DEFAULT false,
            razorpay_key_id TEXT,
            razorpay_key_secret TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT razorpay_settings_singleton CHECK (id = 1)
          );

          ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY;

          CREATE POLICY "Allow service role full access" ON razorpay_settings
            FOR ALL
            USING (true)
            WITH CHECK (true);

          INSERT INTO razorpay_settings (id, enabled)
          VALUES (1, false)
          ON CONFLICT (id) DO NOTHING;
        `
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.log('⚠️  API method failed, trying alternative...\n');
      throw new Error(error.message || 'Failed to create table');
    }

    const result = await response.json();
    console.log('✅ Table created via admin API!\n');
    console.log('📋 Result:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n⚠️  Could not create table automatically.');
    console.log('\n📝 Please create it manually in Supabase:\n');
    console.log('Steps:');
    console.log('1. Go to: https://app.supabase.com');
    console.log('2. Select project: jizwdvimefzjqtbfxjnb');
    console.log('3. Click "SQL Editor" → "New Query"');
    console.log('4. Paste this SQL:\n');

    console.log(`
CREATE TABLE IF NOT EXISTS razorpay_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT false,
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT razorpay_settings_singleton CHECK (id = 1)
);

ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access" ON razorpay_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

INSERT INTO razorpay_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
    `);

    console.log('5. Click "Run"');
    console.log('6. Run this script again: node create-table-direct.js\n');
  }
}

createTable();
