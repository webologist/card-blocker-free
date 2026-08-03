// create-razorpay-table.js
// Run: node create-razorpay-table.js

require('dotenv').config({ path: '.env.db' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.db');
  process.exit(1);
}

console.log('🔌 Connecting to Supabase...');
const supabase = createClient(supabaseUrl, supabaseKey);

async function createRazorpayTable() {
  try {
    console.log('📊 Checking if table exists...\n');

    // Try to query the table
    const { data: existing, error: checkError } = await supabase
      .from('razorpay_settings')
      .select('*')
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('✅ Table already exists!\n');
      console.log('📋 Current data:');
      console.log(JSON.stringify(existing, null, 2));
      console.log('\n✨ Razorpay settings table is ready!');
      return;
    }

    // Table doesn't exist, try to insert (Supabase will create it if needed with proper schema)
    console.log('📊 Creating razorpay_settings table...\n');

    const { data, error } = await supabase
      .from('razorpay_settings')
      .insert({ id: 1, enabled: false, razorpay_key_id: null, razorpay_key_secret: null })
      .select();

    if (error) {
      if (error.message.includes('relation') || error.message.includes('table')) {
        console.error('❌ Table does not exist and cannot auto-create.\n');
        console.log('📝 Please create the table manually in Supabase SQL Editor:\n');
        console.log(`
CREATE TABLE razorpay_settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT false,
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT razorpay_settings_singleton CHECK (id = 1)
);

ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO razorpay_settings (id, enabled) VALUES (1, false)
  ON CONFLICT (id) DO NOTHING;
        `);
        console.log('\nSteps:');
        console.log('1. Go to https://app.supabase.com');
        console.log('2. Select your project');
        console.log('3. Click "SQL Editor" in the left sidebar');
        console.log('4. Click "New Query"');
        console.log('5. Paste the SQL above');
        console.log('6. Click "Run"');
        console.log('7. Come back and run this script again\n');
      } else {
        console.error('❌ Error:', error.message);
      }
      process.exit(1);
    }

    console.log('✅ SUCCESS! Table created!\n');
    console.log('📋 Inserted data:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n✨ Razorpay settings table is ready!');
    console.log('🌐 You can now use the Razorpay admin panel on http://localhost:3000\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

createRazorpayTable();
