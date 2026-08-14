// lib/storage-policy.js
// The access rules behind api/storage.js, kept free of HTTP and database so
// they can be tested directly. Every decision about "who may see or change
// what" lives here; the endpoint only fetches rows and applies these.
//
// The rules exist because the client cannot enforce them. app.js loads the
// whole user table at boot and writes the whole table back on every change,
// so the server has to treat any incoming map as a proposal and narrow both
// directions itself.

// Reference data - identical for everyone, safe to read signed-out, admin-only
// to change.
const PUBLIC_KEYS = new Set(['cbp:banks', 'cbp:templates']);
// Per-user collections - must be filtered to the caller on the way out and on
// the way in.
const OWNED_KEYS = new Set(['cbp:users', 'cbp:logs', 'cbp:feedback']);
// Server/operator-controlled switches - never exposed to a signed-in user,
// only to an admin (checkAdminAccess). Added when /api/storage was locked
// down: this used to be reachable and writable by anyone, same as everything
// else that went through that endpoint unauthenticated.
const ADMIN_KEYS = new Set(['cbp:otp_mode']);

const LEGACY_USERS_KEY = 'cbp:users';

function normalize(v) {
  const digits = String(v || '').replace(/\D/g, '').replace(/^91/, '');
  return digits ? '+91' + digits : '';
}

function isAddressable(key) {
  return PUBLIC_KEYS.has(key) || OWNED_KEYS.has(key) || ADMIN_KEYS.has(key);
}

// Their own number, plus any account that named them as a *verified* alternate
// contact. That second case is the "acting on behalf of" flow the dashboard
// already supports and is the only route by which one phone may touch
// another's record. An unverified alternate grants nothing - otherwise typing
// a stranger's number into your own profile would reach their data.
function reachablePhones(caller, records) {
  const me = normalize(caller);
  const phones = new Set();
  if (!me) return phones;
  phones.add(me);
  for (const rec of records || []) {
    if (!rec) continue;
    if (normalize(rec.altPhone) === me && rec.altVerified) {
      const owner = normalize(rec.phone);
      if (owner) phones.add(owner);
    }
  }
  return phones;
}

// Narrows a stored set of records down to the map shape the client expects,
// containing only what this caller is entitled to.
function usersMapFor(caller, records) {
  const allowed = reachablePhones(caller, records);
  const out = {};
  for (const rec of records || []) {
    if (!rec) continue;
    const phone = normalize(rec.phone);
    if (phone && allowed.has(phone)) out[rec.phone] = rec;
  }
  return out;
}

// FIX (14 Aug 2026, BUG-08): reachablePhones() above is a *read* scope - a
// verified alternate needs to see the owner's cards/email to act on their
// behalf, which is the whole point of the alternate-login flow. It was also
// being reused, unmodified, as the *write* scope in writableRecords() below,
// which meant a signed-in alternate could silently persist edits to the
// owner's record - change the owner's email, delete a saved card - not just
// view them. app.js's dashboard already tries to lock this down client-side
// for the alternate-number field itself (the "Locked while logged in via
// alternate number" check), but nothing stopped the email Edit/Delete
// buttons or a card's Delete button from writing through, and even a fully
// locked-down UI would only be a suggestion - a signed-in alternate's own
// browser could still call POST /api/storage directly. Write access is
// scoped to the caller's own number only; acting "on behalf of" someone
// grants read access and the ability to trigger blocking actions (which
// don't touch this record at all), never the ability to modify or delete
// what the owner saved.
function ownWritablePhones(caller) {
  const me = normalize(caller);
  const phones = new Set();
  if (me) phones.add(me);
  return phones;
}

// Treats an incoming users map as a proposal: returns only the entries the
// caller may persist. A stale map from an old session therefore cannot
// overwrite anyone else, and entries for unknown phones are dropped silently
// rather than failing the whole write. `records` is accepted for signature
// symmetry with reachablePhones()/callers that still pass it, but write scope
// no longer depends on it - see ownWritablePhones() above.
function writableRecords(caller, proposed, records) {
  const allowed = ownWritablePhones(caller);
  const out = [];
  for (const rec of Object.values(proposed || {})) {
    const phone = normalize(rec && rec.phone);
    if (phone && allowed.has(phone)) out.push({ phone, record: rec });
  }
  return out;
}

// Log and feedback entries carry the phone they belong to, so one account
// cannot write history into another's timeline. Entries with no phone are
// kept - they are the caller's own by construction.
//
// FIX (13 Aug 2026, NEW-04 investigation): cbp:feedback entries are written
// with a `phone` field (app.js's feedback submit builds {t, phone, rating}),
// but cbp:logs entries are written with an `actor` field instead (app.js's
// addLog/gl() builds {t, actor, action, detail} - see admin console's
// Activity Log). Reading `e.phone` off a log entry was always undefined, so
// `!e.phone` was true for every single log entry regardless of who it
// belonged to - this filter was a silent no-op for cbp:logs specifically:
// any signed-in caller (not just admin) got every user's full activity log
// back, and the POST merge below (which reuses this same identity check)
// couldn't tell "my own past entries to replace" from "someone else's", so
// entries piled up as duplicates across writes instead of being deduped.
// Falling back to `e.actor` when `e.phone` is absent restores per-entry
// caller narrowing for logs without changing feedback's existing behaviour.
function entryOwner(e) {
  return e && (e.phone || e.actor);
}

// Some log entries use actor:"system" (e.g. "Sent SMS"/"Sent WhatsApp" - see
// app.js's Lu()) rather than a phone - normalize() correctly returns '' for
// those since there are no digits to extract. Treat that the same as "no
// owner" rather than a phone that can never match anyone, so these
// system-level entries stay visible/writable for whichever caller's session
// produced them instead of being silently dropped.
function normalizedEntryOwner(e) {
  return normalize(entryOwner(e)) || null;
}

function ownEntries(caller, list) {
  const me = normalize(caller);
  if (!Array.isArray(list)) return [];
  return list.filter((e) => !e || !normalizedEntryOwner(e) || normalizedEntryOwner(e) === me);
}

// FIX (14 Aug 2026, NEW-06): the entryOwner()/normalizedEntryOwner() fix
// above stops the *filtering* no-op that let every caller see and keep
// everyone else's entries, but it does nothing about *duplication* within a
// single caller's own entries. app.js's addLog() always re-sends its whole
// known local history on every write (see the POST handler's comment), and
// that local history is not itself deduped client-side - so a caller whose
// browser re-submits the same event object more than once (observed live:
// a single registration burst wrote "OTP requested"/"OTP verified"/
// "Registered" 5 times each) had every copy persisted verbatim, since the
// old logic just replaced "mine" with whatever the client proposed, dupes
// and all. This is the same failure mode that produced the 21k-entry/2.3MB
// cbp:logs row scripts/dedupe-cbp-logs.js cleaned up once - without this,
// that bloat simply reaccumulates. Same identity as that script's keyFor():
// two entries are "the same line" if they share timestamp, owner
// (phone/actor), action, and detail.
function entryDedupeKey(e) {
  return JSON.stringify([
    e && e.t,
    e && (e.phone || e.actor),
    e && e.action,
    e && e.detail,
  ]);
}

function dedupeEntries(list) {
  if (!Array.isArray(list)) return list;
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const k = entryDedupeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// What a signed-out browser gets. The app reads these at boot, before anyone
// has logged in, and still has to render - empty is the honest answer, since
// a signed-out browser owns nothing.
function emptyFor(key) {
  return key === 'cbp:users' ? {} : [];
}

module.exports = {
  PUBLIC_KEYS, OWNED_KEYS, ADMIN_KEYS, LEGACY_USERS_KEY,
  normalize, isAddressable, reachablePhones, usersMapFor,
  writableRecords, ownWritablePhones, ownEntries, entryOwner, normalizedEntryOwner, emptyFor,
  dedupeEntries,
};
