// lib/payment-settings-store.js
// Reads/writes the single payment_settings row (id=1), via a Supabase
// service-role client passed in by the caller. Mirrors the shape of
// lib/email-settings-store.js and lib/razorpay-settings-store.js.

const GATEWAY_FIELDS = {
  razorpay: { id: 'razorpay_key_id', secret: 'razorpay_key_secret', idLabel: 'Key ID' },
  cashfree: { id: 'cashfree_app_id', secret: 'cashfree_secret_key', idLabel: 'App ID' },
  payu: { id: 'payu_merchant_key', secret: 'payu_salt', idLabel: 'Merchant Key' },
  easebuzz: { id: 'easebuzz_key', secret: 'easebuzz_salt', idLabel: 'Key' },
};

const MODES = ['free', 'dummy', 'razorpay', 'cashfree', 'payu', 'easebuzz'];

async function getSettings(supabase) {
  const { data, error } = await supabase.from('payment_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data || { id: 1, mode: 'dummy' };
}

// Only overwrites fields present in `patch` - a save for one gateway's
// credentials never touches another gateway's saved values, and switching
// `mode` doesn't require resending every gateway's secrets.
async function saveSettings(supabase, patch) {
  const row = { id: 1, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('payment_settings').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return getSettings(supabase);
}

// Never round-trips secrets back to the browser - same pattern as
// lib/email-settings-store.js's admin panel: the public ID/key is shown
// partially masked, the secret is reduced to a boolean "configured" flag.
function maskSettings(settings) {
  if (!settings) return { id: 1, mode: 'dummy' };
  const out = { mode: settings.mode || 'dummy' };
  for (const [gateway, fields] of Object.entries(GATEWAY_FIELDS)) {
    const idVal = settings[fields.id];
    const secretVal = settings[fields.secret];
    out[gateway] = {
      configured: Boolean(idVal && secretVal),
      id_hint: idVal ? (idVal.length > 6 ? idVal.slice(0, 6) + '…' : idVal) : null,
    };
  }
  return out;
}

module.exports = { getSettings, saveSettings, maskSettings, GATEWAY_FIELDS, MODES };
