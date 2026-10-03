// storage-bridge.js
// Sets up window.storage to call the server API instead of just using localStorage.
// Runs before app.js so it blocks the fallback.
//
// The server /api/storage endpoint requires:
// - x-phone-token header for user-owned data (from OTP verification)
// - No auth for public keys like cbp:banks
// - Returns { key, value } where value is already a JSON string

// FIX (4 Oct 2026): "the read failed" and "there is nothing stored" used to
// be the same answer. get() returned null for both, app.js's Yu() turned null
// into its empty default, and the login code then concluded that a returning
// customer "is not registered" - it built a blank account and wrote it
// straight over the real one. Any failed read at the moment of login did it:
// a database blip, a dropped connection on a phone, an expired session.
//
// Reads now remember how they ended. get() still returns null on failure (so
// nothing that merely displays data changes), but callers that are about to
// DECIDE something from an empty answer - app.js's login and session-restore
// - ask readFailed(key) first and stop instead of guessing.
var bmcReadStatus = {}; // key -> 0 ok | HTTP status | -1 network error

// Keys whose contents belong to the signed-in number. A 401 on one of these
// while we are holding a token means the token is no longer accepted - the
// session has expired - as opposed to a 401 on an admin-only key, which every
// ordinary user's page gets all the time and which means nothing.
var BMC_OWNED = { 'cbp:users': 1, 'cbp:logs': 1, 'cbp:feedback': 1 };
var bmcEnding = false;

// Ends a session the server no longer honours. Before this, saves made after
// the token expired were refused and dropped with only a console line to show
// for it: the dashboard went on looking signed in while nothing the user did
// was being stored. Clear what the app keeps (the same keys bmcSession.clear()
// in app.js removes), leave a note for the login screen, and reload onto it.
function bmcEndSession(message) {
  if (bmcEnding) return;
  bmcEnding = true;
  try {
    ['cbp:session', 'bmc_phone_token', 'bmc_phone', 'bmc_token'].forEach(function (k) { sessionStorage.removeItem(k); });
    sessionStorage.setItem('bmc_notice', message);
  } catch (e) {}
  window.location.reload();
}

window.storage = {
  // true when the most recent read of `key` did not get an answer from the
  // server (5xx, network failure) or was refused (401) - i.e. when a null
  // from get() does NOT mean "nothing stored".
  readFailed(key) {
    return !!bmcReadStatus[key];
  },
  readStatus(key) {
    return bmcReadStatus[key] || 0;
  },

  async get(key) {
    try {
      // Phone token is written to sessionStorage under 'bmc_phone_token' by
      // otp-bridge.js after a successful OTP verify - this used to read a
      // different storage (localStorage) under a different key ('bmcPhoneToken')
      // that nothing ever wrote, so x-phone-token was never sent and every
      // OWNED_KEYS/ADMIN_KEYS request (saved cards, logs, feedback, the admin
      // OTP-mode toggle) failed server-side auth for every user, admin included.
      const phoneToken = sessionStorage.getItem('bmc_phone_token');
      const headers = { 'Content-Type': 'application/json' };
      if (phoneToken) headers['x-phone-token'] = phoneToken;

      const url = new URL('/api/storage', window.location.origin);
      url.searchParams.set('key', key);

      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) {
        if (res.status === 404) { bmcReadStatus[key] = 0; return null; } // unknown key
        bmcReadStatus[key] = res.status;
        // A signed-out page asks for owned/admin keys at boot and is refused;
        // that is the expected answer, not an error worth logging.
        if (res.status !== 401) console.error(`storage.get(${key}) failed:`, res.status);
        return null;
      }
      bmcReadStatus[key] = 0;

      const data = await res.json();
      // Public keys (cbp:banks, cbp:templates) that have never been written
      // yet resolve server-side to a row that doesn't exist, and the server
      // faithfully returns { key, value: null } with a 200 - that's a real,
      // successful "no data yet" answer, not an error. The old check here
      // only treated `value === undefined` as empty, so a literal `null`
      // slipped through as if it were real JSON, and Yu() in app.js does
      // `JSON.parse(e.value)` on it - JSON.parse(null) silently returns the
      // JS value `null` (no throw), which then got stored as the banks/
      // templates state instead of the intended default array/object. Every
      // reader of that state (e.g. gv()'s `e.welcomeSms` on first
      // registration) then crashes with "Cannot read properties of null",
      // which unmounts the OTP screen mid-verify and leaves the user stuck.
      if (data === null || data.value === undefined || data.value === null) return null;
      return { key: data.key, value: data.value };
    } catch (e) {
      bmcReadStatus[key] = -1;
      console.error(`storage.get(${key}) error:`, e);
      return null;
    }
  },

  async set(key, value) {
    try {
      const phoneToken = sessionStorage.getItem('bmc_phone_token');
      // Nothing owned can be saved without a token - the server answers 401
      // every time. app.js still tries on every signed-out page load (its
      // mount effect, and the "OTP requested" log line written before the
      // code has been verified), which put two failed requests and a red
      // console error on every single visit. Skip the round trip.
      if (!phoneToken && BMC_OWNED[key]) return { key, value, skipped: true };
      const headers = { 'Content-Type': 'application/json' };
      if (phoneToken) headers['x-phone-token'] = phoneToken;

      // Check if this is an admin-only key. admin-email-integrations.js and
      // admin-contact-messages.js both use 'bmc_admin_key' (session and/or
      // local storage) - match that key so a key entered in either of those
      // panels is also picked up here instead of only ever being empty.
      const adminKey = localStorage.getItem('bmc_admin_key') || sessionStorage.getItem('bmc_admin_key');
      if (adminKey) headers['x-admin-key'] = adminKey;

      const res = await fetch('/api/storage', {
        method: 'POST',
        headers,
        body: JSON.stringify({ key, value })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error(`storage.set(${key}) failed:`, res.status, err.error);
        if (BMC_OWNED[key] && phoneToken) {
          // The server no longer accepts this session's token.
          if (res.status === 401) {
            bmcEndSession('Your session has expired. Please log in again - anything you had already saved is still there.');
          }
          // The server refused a new-signup record because this number
          // already has an account (see isSignupOverExisting in
          // lib/storage-policy.js): this tab is working from an empty copy
          // of the account. Start over from a clean login, which reloads it.
          if (res.status === 409 && err.code === 'account-exists') {
            bmcEndSession('We found your existing account. Please log in again to open it.');
          }
        }
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      return { key: data.key, value };
    } catch (e) {
      console.error(`storage.set(${key}) error:`, e);
      throw e;
    }
  },

  async delete(key) {
    // The API doesn't support DELETE yet, so we use a null value as a marker
    // The server will need to handle this if deletion becomes important
    try {
      await this.set(key, null);
      return { key, deleted: true };
    } catch (e) {
      console.error(`storage.delete(${key}) error:`, e);
      return { key, deleted: false };
    }
  },

  async list(prefix = '') {
    // The API doesn't support enumeration (by design: prevents key leaking)
    // Return empty for now; if needed, the app can maintain its own list
    return { keys: [], prefix };
  }
};
