// admin-razorpay-toggle.js
// Despite the filename (kept as-is so index.html needs no changes), this now
// renders the general "Payment Gateway" tab in the admin console: pick Free,
// Dummy (the app's long-standing simulated-fee behaviour, and the default),
// or a real gateway - Razorpay, Cashfree, PayU, Easebuzz - and enter that
// gateway's credentials.
//
// IMPORTANT SCOPE NOTE: selecting a real gateway here only saves its
// credentials and admin choice (server-side, in the payment_settings table -
// see payment_settings_table.sql and lib/payment-settings-store.js). It does
// NOT wire that gateway into the actual checkout flow - app.js's
// "save your cards" screen still only distinguishes Free vs. everything-else
// (still simulated) until a future round actually calls a gateway's SDK/API
// from the frontend. Razorpay is the closest to ready: server.js already has
// working /api/razorpay/create-order and /api/razorpay/verify-payment routes
// (built in an earlier round) that this panel's Razorpay credentials keep in
// sync with, via the server's /api/payment/settings handler - so Razorpay is
// one frontend change away from being real, while Cashfree/PayU/Easebuzz
// would need their SDKs integrated from scratch first.
(function () {
  var PROVIDERS = [
    {
      key: 'razorpay',
      label: 'Razorpay',
      blurb: 'Get keys from the <a href="https://dashboard.razorpay.com/app/keys" target="_blank" style="color:#0f172a;text-decoration:underline;">Razorpay Dashboard &rarr; Settings &rarr; API Keys</a>. The server-side checkout backend for Razorpay already exists and stays in sync with what you save here.',
      idField: 'razorpay_key_id',
      idLabel: 'Key ID (public)',
      idPlaceholder: 'rzp_live_...',
      secretField: 'razorpay_key_secret',
      secretLabel: 'Key Secret (private)',
    },
    {
      key: 'cashfree',
      label: 'Cashfree',
      blurb: 'Get credentials from the Cashfree Merchant Dashboard under Developers &rarr; API Keys. Not yet wired into checkout - saving here only stores the credentials for a future round.',
      idField: 'cashfree_app_id',
      idLabel: 'App ID',
      idPlaceholder: 'CF...',
      secretField: 'cashfree_secret_key',
      secretLabel: 'Secret Key',
    },
    {
      key: 'payu',
      label: 'PayU',
      blurb: 'Get credentials from the PayU Dashboard under Settings &rarr; Merchant Key &amp; Salt. Not yet wired into checkout - saving here only stores the credentials for a future round.',
      idField: 'payu_merchant_key',
      idLabel: 'Merchant Key',
      idPlaceholder: 'e.g. gtKFFx',
      secretField: 'payu_salt',
      secretLabel: 'Salt',
    },
    {
      key: 'easebuzz',
      label: 'Easebuzz',
      blurb: 'Get credentials from the Easebuzz Dashboard under Settings &rarr; API Keys. Not yet wired into checkout - saving here only stores the credentials for a future round.',
      idField: 'easebuzz_key',
      idLabel: 'Key',
      idPlaceholder: 'e.g. ABCD1234',
      secretField: 'easebuzz_salt',
      secretLabel: 'Salt',
    },
  ];

  function providerByKey(k) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].key === k) return PROVIDERS[i];
    return null;
  }

  // Which provider's credential form is currently open. Independent of the
  // saved `mode` - you can look at/edit Cashfree's credentials while Dummy
  // is still the active mode.
  var openProvider = null;

  function apiFetch(url, opts) {
    opts = opts || {};
    var token = sessionStorage.getItem('bmc_phone_token');
    var headers = Object.assign({
      'x-phone-token': token || '',
      'x-admin-key': localStorage.getItem('admin_api_secret') || localStorage.getItem('bmc_admin_key') || sessionStorage.getItem('bmc_admin_key') || '',
    }, opts.headers || {});
    return fetch(url, Object.assign({}, opts, { headers: headers }))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: 'Could not reach the server.' } }; });
  }

  function el(tag, style, html) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function statusLine(text, ok) {
    return el('div', 'margin-top:.6rem;font-size:.75rem;font-weight:600;padding:.45rem .65rem;border-radius:.375rem;' +
      (ok ? 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;'
          : 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;'), text);
  }

  function modeCard(current, refresh) {
    var card = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.1rem;margin-bottom:1rem;');
    card.appendChild(el('h4', 'font-weight:700;font-size:.95rem;margin:0 0 .15rem;color:#0f172a;', 'Payment mode'));
    card.appendChild(el('p', 'font-size:.75rem;color:#64748b;margin:0 0 .8rem;line-height:1.5;',
      'Controls the fee shown on the "Save your cards" screen. <b>Dummy</b> is the current default and simulates a paid save with no real charge. <b>Free</b> removes the fee entirely. Selecting a gateway saves its credentials for a future round - the checkout itself still behaves like Dummy until that gateway is actually wired in.'));

    var row = el('div', 'display:flex;gap:.4rem;flex-wrap:wrap;');
    var modeButtons = [
      { key: 'free', label: 'Free' },
      { key: 'dummy', label: 'Dummy (default)' },
    ].concat(PROVIDERS.map(function (p) { return { key: p.key, label: p.label }; }));

    modeButtons.forEach(function (m) {
      var isActive = current.mode === m.key;
      var b = el('button', 'padding:.5rem .85rem;border-radius:.375rem;font-size:.8125rem;font-weight:700;cursor:pointer;font-family:inherit;' +
        (isActive ? 'background:#0f172a;color:#fff;border:1.5px solid #0f172a;' : 'background:#fff;color:#475569;border:1.5px solid #cbd5e1;'), m.label);
      b.onclick = function () {
        b.disabled = true;
        apiFetch('/api/payment/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: m.key }),
        }).then(function (r) {
          b.disabled = false;
          if (r.ok) refresh();
          else alert('Error switching mode: ' + (r.data && r.data.error ? r.data.error : 'Unknown error'));
        });
      };
      row.appendChild(b);
    });
    card.appendChild(row);

    var statusText = current.mode === 'free' ? 'App is FREE — no fee is charged for saving cards.'
      : current.mode === 'dummy' ? 'DUMMY mode — a simulated fee is shown, nothing is actually charged.'
      : providerByKey(current.mode) ? providerByKey(current.mode).label + ' selected — checkout is still simulated until this gateway is wired into the frontend.'
      // Defensive fallback: current.mode should always be one of MODES once
      // it's read off the right object (see the FIX above), but never show
      // a bare "undefined" if the server ever returns something unexpected.
      : 'DUMMY mode — a simulated fee is shown, nothing is actually charged.';
    card.appendChild(el('p', 'font-size:.75rem;margin:.8rem 0 0;color:#475569;font-weight:600;', statusText));

    return card;
  }

  function credentialsCard(provider, current, refresh) {
    var state = current[provider.key] || { configured: false, id_hint: null };
    var card = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.1rem;margin-bottom:1rem;');

    var headerRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:.15rem;');
    headerRow.appendChild(el('h4', 'font-weight:700;font-size:.95rem;margin:0;color:#0f172a;', provider.label + ' credentials'));
    var toggleLink = el('button', 'background:none;border:none;color:#64748b;font-size:.75rem;font-weight:600;cursor:pointer;text-decoration:underline;', openProvider === provider.key ? 'Hide' : (state.configured ? 'Edit' : 'Set up'));
    toggleLink.onclick = function () { openProvider = openProvider === provider.key ? null : provider.key; refresh(); };
    headerRow.appendChild(toggleLink);
    card.appendChild(headerRow);

    card.appendChild(el('p', 'font-size:.72rem;color:' + (state.configured ? '#15803d' : '#94a3b8') + ';font-weight:600;margin:0;',
      state.configured ? ('Configured' + (state.id_hint ? ' (' + state.id_hint + ')' : '')) : 'Not set up'));

    if (openProvider !== provider.key) { card.appendChild(el('div')); return card; }

    var blurb = el('p', 'font-size:.75rem;color:#64748b;margin:.7rem 0 .9rem;line-height:1.5;');
    blurb.innerHTML = provider.blurb;
    card.appendChild(blurb);

    var idWrap = el('label', 'display:block;margin-bottom:.6rem;');
    idWrap.appendChild(el('span', 'display:block;font-size:.72rem;font-weight:700;color:#64748b;margin-bottom:.25rem;', provider.idLabel));
    var idInput = el('input', 'width:100%;border:1px solid #cbd5e1;border-radius:.375rem;padding:.45rem .6rem;font-size:.8125rem;box-sizing:border-box;font-family:monospace;');
    idInput.type = 'text';
    idInput.placeholder = state.configured ? 'Saved — leave blank to keep it' : (provider.idPlaceholder || '');
    idWrap.appendChild(idInput);
    card.appendChild(idWrap);

    var secretWrap = el('label', 'display:block;margin-bottom:.8rem;');
    secretWrap.appendChild(el('span', 'display:block;font-size:.72rem;font-weight:700;color:#64748b;margin-bottom:.25rem;', provider.secretLabel));
    var secretInput = el('input', 'width:100%;border:1px solid #cbd5e1;border-radius:.375rem;padding:.45rem .6rem;font-size:.8125rem;box-sizing:border-box;font-family:monospace;');
    secretInput.type = 'password';
    secretInput.placeholder = state.configured ? 'Saved — leave blank to keep it' : '●●●●●●●●';
    secretWrap.appendChild(secretInput);
    card.appendChild(secretWrap);

    var statusHost = el('div');
    var saveBtn = el('button', 'background:#0f172a;color:#fff;border:none;border-radius:.375rem;padding:.5rem 1.1rem;font-size:.8125rem;font-weight:600;cursor:pointer;font-family:inherit;', 'Save ' + provider.label + ' credentials');
    saveBtn.onclick = function () {
      var patch = {};
      if (idInput.value.trim()) patch[provider.idField] = idInput.value.trim();
      if (secretInput.value.trim()) patch[provider.secretField] = secretInput.value.trim();
      if (!patch[provider.idField] && !patch[provider.secretField] && !state.configured) {
        statusHost.innerHTML = '';
        statusHost.appendChild(statusLine('Enter both fields to save.', false));
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      apiFetch('/api/payment/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (r) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save ' + provider.label + ' credentials';
        statusHost.innerHTML = '';
        if (r.ok) { statusHost.appendChild(statusLine('Saved.', true)); refresh(); }
        else statusHost.appendChild(statusLine(r.data.error || ('Error ' + r.status), false));
      });
    };
    card.appendChild(saveBtn);
    card.appendChild(statusHost);

    return card;
  }

  var panelHost = document.createElement('div');

  function refreshPanel() {
    if (!panelHost) return;
    apiFetch('/api/payment/settings').then(function (r) {
      panelHost.innerHTML = '';
      var wrap = el('div', 'padding:1rem 0;max-width:640px;');
      if (!r.ok) {
        wrap.appendChild(statusLine(r.data && r.data.error ? r.data.error : 'Could not load payment settings (check admin access).', false));
        panelHost.appendChild(wrap);
        return;
      }
      // FIX (13 Aug 2026, NEW-05): apiFetch() resolves `r.data` to the whole
      // parsed JSON body, and the server wraps its payload one level deeper
      // as { ok: true, data: {...} } (see GET /api/payment/settings in
      // server.js). This used to read `current = r.data` directly, so
      // `current.mode` was always undefined - not just cosmetically (the
      // "undefined selected" status line), but for real: every
      // credentialsCard() below also read `current[provider.key]` off the
      // wrong object, so already-saved Razorpay/Cashfree/PayU/Easebuzz
      // credentials always rendered as "not configured" too.
      var current = (r.data && r.data.data) || {};
      wrap.appendChild(modeCard(current, refreshPanel));
      PROVIDERS.forEach(function (p) { wrap.appendChild(credentialsCard(p, current, refreshPanel)); });
      panelHost.appendChild(wrap);
    });
  }

  function build() {
    refreshPanel();
    return panelHost;
  }

  // Rendered inside the shared, React-safe floating panel (admin-tools-panel.js)
  // instead of being spliced directly into the admin console's own tab bar -
  // see admin-tools-panel.js for why that used to crash the whole app.
  function register() {
    if (!window.BmcAdminTools) return false;
    window.BmcAdminTools.register('payment', 'Payment Gateway', build);
    return true;
  }
  if (!register()) {
    var tries = 0;
    var waitForHost = setInterval(function () {
      tries++;
      if (register() || tries > 20) clearInterval(waitForHost);
    }, 250);
  }
})();