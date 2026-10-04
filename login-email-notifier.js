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

  // The signed-in number, read off the token (its payload is plain base64url
  // JSON; the signature is the server's business, not ours).
  function ownDigits() {
    try {
      var body = (sessionStorage.getItem('bmc_phone_token') || '').split('.')[0];
      if (!body) return '';
      var json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
      return String(json.phone || '').replace(/\D/g, '').slice(-10);
    } catch (e) { return ''; }
  }
  function isOwn(entry) {
    var me = ownDigits();
    return !!me && String(entry.actor || '').replace(/\D/g, '').slice(-10) === me;
  }

  // FIX (4 Oct 2026): login emails had quietly stopped being requested at all.
  // The "first read establishes a baseline" rule below assumed the first read
  // happens BEFORE sign-in, against an empty list - true back when a
  // signed-out browser was handed an empty cbp:logs. Since /api/storage was
  // locked down a signed-out read is refused, so the first read that
  // succeeds is the one just AFTER signing in, and its baseline already
  // contains the "Login"/"Registered" entry it was supposed to notice.
  // Nothing was ever new, so nothing was ever sent.
  //
  // The tab now tracks whether it actually watched a sign-in happen
  // (signed-out poll, then a signed-in one). If it did, the newest
  // account-access entry for this number in that first read IS this
  // sign-in, and is notified; a tab that loaded already signed in (refresh,
  // restored session) still just takes a baseline, so history is never
  // re-mailed. The server de-duplicates on (phone, timestamp) regardless.
  var sawSignedOut = false;

  function poll() {
    if (!window.storage || !window.storage.get) return;
    // Signed out there is nothing to read (the server refuses) and nothing
    // to notify - this used to fire a doomed request every ten seconds for
    // every visitor to the site.
    if (!sessionStorage.getItem('bmc_phone_token')) { sawSignedOut = true; seen = null; return; }
    var watchedSignIn = sawSignedOut && seen === null;
    window.storage.get('cbp:logs').then(function (result) {
      if (!result || !result.value) return;
      var logs;
      try { logs = JSON.parse(result.value); } catch (e) { return; }
      if (!Array.isArray(logs)) return;

      if (seen === null) {
        seen = new Set(logs.map(serialize));
        sawSignedOut = false;
        if (watchedSignIn) {
          // Newest first: the first own Login/Registered entry near the top
          // is the sign-in this tab just went through.
          for (var k = 0; k < Math.min(logs.length, 12); k++) {
            var e0 = EMAIL_ON[logs[k].action];
            if (e0 && isOwn(logs[k])) { notify(logs[k].actor, logs[k].t, e0); break; }
          }
        }
        return;
      }

      // Logs are newest-first; walk until we hit something we've already seen.
      for (var i = 0; i < logs.length; i++) {
        var key = serialize(logs[i]);
        if (seen.has(key)) break;
        seen.add(key);
        var evt = EMAIL_ON[logs[i].action];
        // The admin console sees every user's entries; the server only mails
        // on a token belonging to the number concerned, so only ask for our own.
        if (evt && isOwn(logs[i])) notify(logs[i].actor, logs[i].t, evt);
      }
    }).catch(function () {});
  }

  // FIX (4 Oct 2026): a "syncDirectory" step used to live here, POSTing every
  // email address this browser could see to /api/user-directory every ten
  // seconds. That route does not exist on either backend (server.js or
  // pages/api), so on the deployed site it was a 404 every ten seconds for
  // every signed-in user. Worse was what it would have done had the route
  // existed: it looped over EVERY record in cbp:users - for the admin that is
  // every customer - and submitted each one's address under the caller's own
  // phone token, and on a 401 it deleted that token, signing the user out of
  // storage. The server already finds the address itself (login-email looks
  // the user up in cbp:users), so nothing needs syncing.

  // FIX (17 Aug 2026, item 4 - background polling loops): poll/syncDirectory
  // were 3000ms - unconditional on every page load, forever. Neither the
  // login-email notification nor the directory sync needs to land within
  // 3 seconds; widening to 10s cuts steady-state /api/storage traffic ~3x
  // with no observable difference to the user (email notifications already
  // go out asynchronously, well after the login itself completes).
  setInterval(poll, 10000);
  setInterval(retryPending, RETRY_MS);
  poll();
})();
