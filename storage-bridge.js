// storage-bridge.js
// Sets up window.storage to call the server API instead of just using localStorage.
// Runs before app.js so it blocks the fallback.
//
// The server /api/storage endpoint requires:
// - x-phone-token header for user-owned data (from OTP verification)
// - No auth for public keys like cbp:banks
// - Returns { key, value } where value is already a JSON string

window.storage = {
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
        if (res.status === 404) return null; // unknown key
        console.error(`storage.get(${key}) failed:`, res.status);
        return null;
      }

      const data = await res.json();
      // Public keys (cbp:banks, cbp:templates) that have never been written
      // yet resolve server-side to a row that doesn't exist, and the server
      // faithfully returns { key, value: null } with a 200 - that's a real,
      // successful "no data yet" answer, not an error. The old check here
      // only treated `value === undefined` as empty, so a literal `null`
      // slipped through as if it were real JSON, and Yu() in app.js does
      // `JSON.parse(e.value)` on it - JSON.parse(null) silently returns the
      // JS value `null` (no throw), which then got stored as the banks/
      // templates state instead of the intended default array. The admin
      // console's banks tab immediately does `l.map(...)` on that state with
      // no null guard and no error boundary exists anywhere in this app, so
      // the whole React tree unmounted - a blank screen with only the
      // document.body-level "Dummy OTP mode" banner surviving.
      if (data === null || data.value === undefined || data.value === null) return null;
      return { key: data.key, value: data.value };
    } catch (e) {
      console.error(`storage.get(${key}) error:`, e);
      return null;
    }
  },

  async set(key, value) {
    try {
      const phoneToken = sessionStorage.getItem('bmc_phone_token');
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
