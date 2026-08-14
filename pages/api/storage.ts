import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCors } = require('../../lib/cors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAdminAccess, isAdminPhone } = require('../../lib/admin-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyPhoneToken } = require('../../lib/phone-token');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  PUBLIC_KEYS, ADMIN_KEYS, isAddressable,
  usersMapFor, writableRecords, ownEntries, normalizedEntryOwner, normalize: normalizePhoneKey,
  dedupeEntries,
} = require('../../lib/storage-policy');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeError } = require('../../lib/input-validator');

// This used to be a stub that accepted any read/write and echoed success
// without ever touching a database - a leftover from before this route had
// a Supabase client of its own (see lib/supabase-server.js). That made two
// things true at once, depending on which of this app's two overlapping
// backends (this file vs. server.js - see the pre-launch audit's C5) a given
// deployment actually serves: either every /api/storage call silently did
// nothing (registration, saved cards, and the admin OTP-mode toggle would
// all appear to work in the UI and then evaporate), or - if some other
// caller assumed persistence the way server.js's real implementation
// provides - the access-control hardening from the Critical-severity storage
// leak fix (server.js's rewrite, audit finding C1) was never actually live
// here. This mirrors that same access-control logic so both possible
// backends enforce it identically, whichever one a given deployment serves.

async function callerPhone(req: NextApiRequest): Promise<string | null> {
  const header = req.headers['x-phone-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return null;
  try {
    return await verifyPhoneToken(token);
  } catch (e) {
    return null;
  }
}

function parseOr(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (e) {
    return fallback;
  }
}

async function readRow(supabase: any, key: string) {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', key).single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message); // PGRST116 = no row
  return data ? data.value : null;
}

async function writeRow(supabase: any, key: string, value: any) {
  const { error } = await supabase.from('kv_store').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('[STORAGE] No Supabase client configured - cannot serve /api/storage.');
    return res.status(503).json({ error: 'Storage is not configured on this deployment.' });
  }

  try {
    if (req.method === 'GET') {
      const key = Array.isArray(req.query.key) ? req.query.key[0] : req.query.key;
      if (!key) return res.status(400).json({ error: 'Key is required' });

      if (ADMIN_KEYS.has(key)) {
        const auth = await checkAdminAccess(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        const value = await readRow(supabase, key);
        return res.status(200).json({ key, value });
      }

      if (!isAddressable(key)) {
        console.warn('[STORAGE] Rejected read of unknown key:', key);
        return res.status(400).json({ error: 'Unknown storage key' });
      }

      if (PUBLIC_KEYS.has(key)) {
        const value = await readRow(supabase, key);
        return res.status(200).json({ key, value });
      }

      // OWNED_KEYS from here on - the caller must prove who they are, and
      // only gets back what belongs to them.
      const phone = await callerPhone(req);
      if (!phone) return res.status(401).json({ error: 'Sign in required to read this data.' });

      const raw = await readRow(supabase, key);
      if (key === 'cbp:users') {
        const allUsers = parseOr(raw, {});
        // The admin console needs every registered user, not just whatever
        // the admin's own phone number happens to reach - see isAdminPhone's
        // doc comment for why the usual per-caller narrowing doesn't apply.
        const value = isAdminPhone(phone) ? allUsers : usersMapFor(phone, Object.values(allUsers));
        return res.status(200).json({ key, value: JSON.stringify(value) });
      }

      // cbp:logs / cbp:feedback - owned lists. Admin needs the full activity
      // log / feedback list (mirrors server.js's /api/storage - see the
      // NEW-04 fix notes there and in storage-policy.js's entryOwner()).
      const list = parseOr(raw, []);
      const filtered = isAdminPhone(phone) ? (Array.isArray(list) ? list : []) : ownEntries(phone, Array.isArray(list) ? list : []);
      return res.status(200).json({ key, value: JSON.stringify(filtered) });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const { key, value } = (req.body || {}) as { key?: string; value?: any };
      if (!key) return res.status(400).json({ error: 'key required' });

      if (ADMIN_KEYS.has(key)) {
        const auth = await checkAdminAccess(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        await writeRow(supabase, key, value);
        return res.status(200).json({ success: true, key, value });
      }

      if (!isAddressable(key)) {
        console.warn('[STORAGE] Rejected write of unknown key:', key);
        return res.status(400).json({ error: 'Unknown storage key' });
      }

      if (PUBLIC_KEYS.has(key)) {
        // Reference data (banks/templates) - identical for every user, so
        // only an admin may change it.
        const auth = await checkAdminAccess(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        await writeRow(supabase, key, value);
        return res.status(200).json({ success: true, key, value });
      }

      // OWNED_KEYS - the incoming value is a *proposal*. We narrow it to
      // what this caller may write and merge that into the existing row, so
      // a stale or malicious payload can never touch another user's data.
      const phone = await callerPhone(req);
      if (!phone) return res.status(401).json({ error: 'Sign in required to save this data.' });

      const existingRaw = await readRow(supabase, key);

      if (key === 'cbp:users') {
        const existing = parseOr(existingRaw, {});
        const proposed = parseOr(value, {});
        // Admin may write any phone's record, unlike the reachability-narrowed
        // path below - but this must still be an ADDITIVE merge, never a
        // wholesale replace. app.js's mount effect seeds a demo-user entry into
        // whatever partial map it currently has loaded (see rs()'s useEffect),
        // completely independent of the admin console's own edits - trusting
        // `proposed` as the full table let that incidental, partial write blow
        // away every other user the admin's client hadn't (yet) loaded.
        let merged;
        if (isAdminPhone(phone)) {
          merged = Object.assign({}, existing, proposed);
        } else {
          const writable = writableRecords(phone, proposed, Object.values(existing));
          merged = Object.assign({}, existing);
          for (const { phone: p, record } of writable) merged[p] = record;
        }
        await writeRow(supabase, key, JSON.stringify(merged));
        return res.status(200).json({ success: true, key, value: JSON.stringify(merged) });
      }

      // cbp:logs / cbp:feedback - append-only owned lists. The caller's own
      // proposed entries replace their own previous entries in the list;
      // everyone else's entries are left untouched. (NEW-04 fix: matched on
      // normalizedEntryOwner() instead of e.phone - see server.js and
      // storage-policy.js for the full explanation.)
      const existingList = parseOr(existingRaw, []);
      const proposedList = parseOr(value, []);
      if (!Array.isArray(proposedList)) return res.status(400).json({ error: 'Invalid value' });
      const me = normalizePhoneKey(phone);
      const others = (Array.isArray(existingList) ? existingList : []).filter(
        (e: any) => !e || !normalizedEntryOwner(e) || normalizedEntryOwner(e) !== me
      );
      const ownProposed = ownEntries(phone, proposedList);
      // FIX (14 Aug 2026, NEW-06): see dedupeEntries() in storage-policy.js /
      // the matching fix in server.js - dedupe before persisting so a
      // client re-submitting the same entry more than once doesn't
      // reaccumulate the duplication scripts/dedupe-cbp-logs.js cleaned up.
      const merged = dedupeEntries(others.concat(ownProposed));
      await writeRow(supabase, key, JSON.stringify(merged));
      return res.status(200).json({ success: true, key, value: JSON.stringify(merged) });
    }

    if (req.method === 'DELETE') {
      const key = Array.isArray(req.query.key) ? req.query.key[0] : (req.query.key || (req.body || {}).key);
      if (!key) return res.status(400).json({ error: 'Key is required' });

      // Deleting an entire row is destructive for everyone who has data
      // under that key (there is no "delete just my entry" case in this app
      // - that's expressed as a POST that omits the caller's record instead),
      // so this is admin-only regardless of which key it is.
      const auth = await checkAdminAccess(req);
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      if (!isAddressable(key)) return res.status(400).json({ error: 'Unknown storage key' });

      const { error } = await supabase.from('kv_store').delete().eq('key', key);
      if (error) throw new Error(error.message);
      return res.status(200).json({ key, deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[STORAGE] Error:', error);
    return res.status(500).json({ error: sanitizeError(error) });
  }
}
