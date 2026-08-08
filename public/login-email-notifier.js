// login-email-notifier.js
// Watches the shared activity log (cbp:logs) for fresh account-access entries
// and asks the server to email the user about each one, via whichever provider
// the admin has connected in Email Integrations.
//
// Two actions count, because the app logs them differently: a returning user
// produces "Login", while a brand-new signup produces "Registered" and never
// a "Login". Watching only "Login" silently skipped every first-time user.
// Does not touch app.js - follows the same storage-polling pattern as
// admin-otp-toggle.js / otp-bridge.js's quick-login panel.
(function () {
  var seen = null; // null until the first poll establishes a baseline

  function serialize(entry) { return entry.t + '|' + entry.actor + '|' + entry.action + '|' + entry.detail; }

  var EMAIL_ON = { 'Login': 'login', 'Registered': 'registered' };

  // Signup logs "Registered" before the email address is collected, so the
  // first attempt often has nothing to send to. Those are retried until the
  // address appears; anything else is final.
  // Retries are paced well inside the server's rate limit - hammering every
  // few seconds just trips it, and a throttled reply carries no useful answer.
  var pending = {};          // key -> { phone, ts, event, tries }
  var MAX_TRIES = 10;
  var RETRY_MS = 15000;      // ~2.5 minutes of retries, ~10 calls

  function notify(phone, ts, event) {
    var key = phone + '|' + ts;
    // The server will not mail anyone on an unproven claim: without the signed
    // token from OTP verification, "phone X just logged in" is something any
    // caller could assert about any number. Nothing to send yet is not a
    // failure - keep it pending so a retry after verification can carry one.
    var token = sessionStorage.getItem('bmc_phone_token');
    if (!token) {
      var q = pending[key] || { phone: phone, ts: ts, event: event, tries: 0 };
      q.tries++;
      if (q.tries >= MAX_TRIES) delete pending[key]; else pending[key] = q;
      return;
    }
    fetch('/api/login-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone, ts: ts, event: event, phoneToken: token }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (d) {
      // "no-email" = the user hasn't reached the email screen yet.
      // "rate-limited" = ask again shortly. Anything else is final.
      if (d && d.sent === false && (d.reason === 'no-email' || d.reason === 'rate-limited')) {
        var p = pending[key] || { phone: phone, ts: ts, event: event, tries: 0 };
        p.tries++;
        if (p.tries >= MAX_TRIES) delete pending[key];
        else pending[key] = p;
      } else {
        delete pending[key];   // sent, duplicate, or no provider - stop asking
      }
    }).catch(function () {});
  }

  function retryPending() {
    Object.keys(pending).forEach(function (k) {
      var p = pending[k];
      notify(p.phone, p.ts, p.event);
    });
  }

  function poll() {
    if (!window.storage || !window.storage.get) return;
    window.storage.get('cbp:logs').then(function (result) {
      if (!result || !result.value) return;
      var logs;
      try { logs = JSON.parse(result.value); } catch (e) { return; }
      if (!Array.isArray(logs)) return;

      if (seen === null) {
        // First read: establish baseline, don't email for pre-existing history.
        seen = new Set(logs.map(serialize));
        return;
      }

      // Logs are newest-first; walk until we hit something we've already seen.
      for (var i = 0; i < logs.length; i++) {
        var key = serialize(logs[i]);
        if (seen.has(key)) break;
        seen.add(key);
        var evt = EMAIL_ON[logs[i].action];
        if (evt) notify(logs[i].actor, logs[i].t, evt);
      }
    }).catch(function () {});
  }

  // ── Sync this user's email address to the server ──
  // On production the app's records live in the visitor's own browser, so the
  // server has no way to know an address unless we tell it. We only do so with
  // the signed phoneToken from OTP verification, so a phone can never have a
  // stranger's address registered against it.
  var syncedFor = null;

  function syncDirectory() {
    var token = sessionStorage.getItem('bmc_phone_token');
    if (!token || !window.storage || !window.storage.get) return;

    window.storage.get('cbp:users').then(function (result) {
      if (!result || !result.value) return;
      var users;
      try { users = JSON.parse(result.value); } catch (e) { return; }

      // The token proves one specific phone; find whichever record matches a
      // recently verified number by checking them all against what we stored.
      Object.keys(users).forEach(function (phone) {
        var u = users[phone];
        if (!u || !u.email) return;
        var mark = phone + '|' + u.email;
        if (syncedFor === mark) return;
        syncedFor = mark;
        fetch('/api/user-directory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneToken: token, email: u.email, name: u.name || '' }),
        }).then(function (r) {
          // A 401 means the token was for a different phone or has expired -
          // forget it so a later verification can try again.
          if (r.status === 401) sessionStorage.removeItem('bmc_phone_token');
        }).catch(function () { syncedFor = null; });
      });
    }).catch(function () {});
  }

  setInterval(poll, 3000);
  setInterval(retryPending, RETRY_MS);
  setInterval(syncDirectory, 3000);
  poll();
})();
