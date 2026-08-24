// cashfree-bridge.js
// Wires real Cashfree checkout into the "save your cards" screen from
// outside app.js - a pre-built minified bundle with no source in this repo
// (see admin-users-tab-stale-fetch in project notes for why patches happen
// this way, same pattern as otp-bridge.js/storage-bridge.js).
//
// app.js's own save-prompt button already handles Free and Dummy natively;
// this script only takes over when the admin-configured payment mode is
// literally "cashfree" (see /api/payment/mode), by intercepting that one
// button's click in the capture phase before React ever sees it. Any other
// mode - free, dummy, razorpay, payu, easebuzz - passes through completely
// untouched, so switching the admin's mode setting is the only thing needed
// to switch (or turn off) Cashfree; nothing here needs to change.
//
// Flow: click -> POST /api/cashfree/create-order (server computes the
// amount from the caller's own saved card count - never trusts a client
// figure) -> Cashfree's hosted checkout (full-page redirect, not a modal,
// so no reliance on reaching into React state to resume anything) -> back
// here via ?cf_order_id=... -> POST /api/cashfree/verify-order, which
// independently re-checks the order with Cashfree before crediting anything
// -> reload, so app.js remounts and reads the now-updated saved/paid state
// fresh from the server, landing on whatever screen that implies.
(function () {
  var ORDER_PARAM = 'cf_order_id';
  var SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

  function phoneToken() {
    return sessionStorage.getItem('bmc_phone_token') || '';
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json', 'x-phone-token': phoneToken() }, opts.headers || {});
    return fetch(url, Object.assign({}, opts, { headers: headers }))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: 'Could not reach the server.' } }; });
  }

  // ── Part 1: handle landing back from Cashfree's hosted checkout ──
  function handleReturn() {
    var params = new URLSearchParams(window.location.search);
    var orderId = params.get(ORDER_PARAM);
    if (!orderId) return;

    // Strip the param immediately regardless of outcome - a refresh of this
    // exact URL must never re-trigger verification (harmless if it did,
    // since verify-order is idempotent, but there is no reason to repeat it).
    params.delete(ORDER_PARAM);
    var cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);

    if (!phoneToken()) return; // session lost across the redirect - nothing to verify as

    apiFetch('/api/cashfree/verify-order', {
      method: 'POST',
      body: JSON.stringify({ orderId: orderId }),
    }).then(function (r) {
      if (r.ok && r.data && r.data.credited) {
        window.location.reload();
        return;
      }
      var status = r.ok ? (r.data && r.data.status) : (r.data && r.data.error);
      window.alert('Cashfree payment status: ' + (status || 'unknown') + '.\nIf you completed the payment, wait a moment and refresh. Otherwise you can try again from the save-your-cards screen.');
    });
  }

  // ── Part 2: intercept the save-prompt's pay button when Cashfree is active ──
  var currentMode = null;
  fetch('/api/payment/mode').then(function (r) { return r.json(); }).then(function (d) {
    currentMode = d && d.mode ? d.mode : 'dummy';
  }).catch(function () { currentMode = 'dummy'; });

  function isSaveCardsButton(el) {
    if (!el || el.tagName !== 'BUTTON') return null;
    var t = (el.textContent || '').trim();
    return /^YES/i.test(t) && /Save my cards/i.test(t) ? el : null;
  }

  var sdkLoadPromise = null;
  function loadSdk() {
    if (window.Cashfree) return Promise.resolve();
    if (sdkLoadPromise) return sdkLoadPromise;
    sdkLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the Cashfree checkout script.')); };
      document.head.appendChild(s);
    });
    return sdkLoadPromise;
  }

  function showError(button, originalText, message) {
    button.disabled = false;
    button.textContent = originalText;
    window.alert(message);
  }

  function startCheckout(button) {
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Starting Cashfree checkout…';

    apiFetch('/api/cashfree/create-order', { method: 'POST', body: JSON.stringify({}) })
      .then(function (r) {
        if (!r.ok || !r.data || !r.data.paymentSessionId) {
          throw new Error((r.data && r.data.error) || 'Could not start the Cashfree payment.');
        }
        return loadSdk().then(function () { return r.data; });
      })
      .then(function (data) {
        var cf = window.Cashfree({ mode: data.env || 'sandbox' });
        cf.checkout({ paymentSessionId: data.paymentSessionId, redirectTarget: '_self' });
        // No further action here - a successful checkout() call navigates
        // the whole page away to Cashfree, so nothing after this line runs.
      })
      .catch(function (e) {
        showError(button, originalText, e.message || 'Something went wrong starting the payment.');
      });
  }

  document.addEventListener('click', function (e) {
    if (currentMode !== 'cashfree') return; // native Free/Dummy/other-gateway behaviour untouched
    var btn = isSaveCardsButton(e.target.closest && e.target.closest('button'));
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    startCheckout(btn);
  }, true); // capture phase - runs before React's own delegated click handler

  handleReturn();
})();
