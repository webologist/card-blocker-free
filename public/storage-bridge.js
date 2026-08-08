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
      // Get phone token from localStorage if it exists (set by verify-otp)
      const phoneToken = localStorage.getItem('bmcPhoneToken');
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
      if (data === null || data.value === undefined) return null;
      return { key: data.key, value: data.value };
    } catch (e) {
      console.error(`storage.get(${key}) error:`, e);
      return null;
    }
  },

  async set(key, value) {
    try {
      const phoneToken = localStorage.getItem('bmcPhoneToken');
      const headers = { 'Content-Type': 'application/json' };
      if (phoneToken) headers['x-phone-token'] = phoneToken;

      // Check if this is an admin-only key
      const adminKey = localStorage.getItem('bmcAdminKey');
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
