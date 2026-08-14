// scripts/dedupe-cbp-logs.js
//
// One-time cleanup for the cbp:logs row in kv_store, run directly against
// Supabase (not through the app server).
//
// WHY THIS EXISTS: lib/storage-policy.js's ownEntries() used to filter log
// entries by `e.phone`, but every log entry is written with `actor` instead
// (see app.js's addLog/gl()). Since e.phone was always undefined, the old
// filter was a no-op - it kept literally everything on both read and write.
// Concretely, every single POST to /api/storage for cbp:logs (i.e. every
// OTP request/verify, login, logout, card add, payment, etc. from every
// user) read back the ENTIRE existing cbp:logs row, then wrote the whole
// thing back with that user's own small batch appended - so the row grew by
// re-duplicating its own full history on every single write, compounding
// over time. By the time this was caught (13 Aug 2026), the row had ballooned
// to 20,000+ entries / ~2.3MB, almost entirely duplicate copies of the same
// underlying history, and new writes to it had started failing outright
// (Supabase upserts of a multi-MB text column can time out or hit an
// implicit size ceiling depending on plan).
//
// The code bug is fixed in lib/storage-policy.js / server.js / pages/api/
// storage.ts (entries are now matched by whichever of `phone`/`actor` is
// present via entryOwner()/normalizedEntryOwner()), which stops this from
// recurring - but that fix does nothing about the multi-MB of duplicates
// already sitting in the row. This script removes those duplicates once,
// so cbp:logs goes back to being just its real, distinct history.
//
// Usage: node scripts/dedupe-cbp-logs.js
//   (reads config the same way server.js does: process.env, loaded from
//   .env.db in this project - run it from the project root)
//
// Safe to run any time (it's idempotent - running it again on an already-
// deduped row is a no-op) and safe to run while server.js is running, though
// stopping server.js first avoids a write racing with this script.

require('dotenv').config({ path: '.env.db' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase config (checked NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY in .env.db).');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function keyFor(entry) {
  // Two entries are "the same log line" if they have the same timestamp
  // string, actor/phone, action, and detail - that's everything app.js's
  // addLog() puts on an entry, so a true duplicate matches on all four.
  return JSON.stringify([
    entry && entry.t,
    entry && (entry.phone || entry.actor),
    entry && entry.action,
    entry && entry.detail,
  ]);
}

async function main() {
  console.log('Reading cbp:logs from kv_store...');
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', 'cbp:logs').single();
  if (error) {
    if (error.code === 'PGRST116') {
      console.log('No cbp:logs row exists yet - nothing to do.');
      return;
    }
    throw new Error(error.message);
  }

  let list;
  try {
    list = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch (e) {
    console.error('cbp:logs value is not valid JSON - aborting without changes:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(list)) {
    console.error('cbp:logs value is not an array - aborting without changes.');
    process.exit(1);
  }

  const before = list.length;
  const beforeBytes = Buffer.byteLength(JSON.stringify(list), 'utf8');

  const seen = new Set();
  const deduped = [];
  for (const entry of list) {
    const k = keyFor(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(entry);
  }

  const after = deduped.length;
  const afterBytes = Buffer.byteLength(JSON.stringify(deduped), 'utf8');

  console.log(`Entries: ${before} -> ${after} (removed ${before - after} duplicates)`);
  console.log(`Size:    ${(beforeBytes / 1024).toFixed(1)} KB -> ${(afterBytes / 1024).toFixed(1)} KB`);

  if (after === before) {
    console.log('Already deduped - no write needed.');
    return;
  }

  console.log('Writing deduped list back to cbp:logs...');
  const { error: writeError } = await supabase
    .from('kv_store')
    .upsert({ key: 'cbp:logs', value: JSON.stringify(deduped) }, { onConflict: 'key' });
  if (writeError) throw new Error(writeError.message);

  console.log('Done.');
}

main().catch((e) => {
  console.error('Dedup failed:', e.message);
  process.exit(1);
});
