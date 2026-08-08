// admin-email-integrations.js
// Injects an "Email Integrations" tab into the admin console, matching the
// pattern used by admin-otp-toggle.js.
//
// Flow: unlock with the admin key -> pick ONE provider (Brevo / AWS SES /
// Google) -> fill in only that provider's credentials -> save, optionally
// mark it as the one used for sending, and send a test email.
//
// Secrets are never round-tripped back to the browser: the GET endpoint
// returns masked/boolean state only, so a saved key shows as "••••abcd" and
// a blank secret field on save means "keep the existing value".
(function () {
  var ADMIN_KEY_STORAGE = 'bmc_admin_key';

  // Which provider's form is currently on screen. Not the same as the active
  // (sending) provider - you can edit one while another stays active.
  var selected = null;

  var PROVIDERS = [
    {
      key: 'brevo',
      label: 'Brevo',
      blurb: 'Get an API key from the Brevo dashboard under SMTP &amp; API &rarr; API Keys. The sender address must be a verified sender on your Brevo account.',
      fields: [
        { name: 'brevo_api_key', label: 'API key', secret: true, placeholder: 'xkeysib-...' },
        { name: 'brevo_from_email', label: 'Sender email', showKey: 'from_email', placeholder: 'you@yourdomain.com' },
        { name: 'brevo_from_name', label: 'Sender name', showKey: 'from_name', placeholder: 'BlockMyCard' },
      ],
    },
    {
      key: 'ses',
      label: 'AWS SES',
      blurb: 'Create an IAM user with the <code>ses:SendEmail</code> permission and use its access key. The sender address must be a verified identity in the same region.',
      fields: [
        { name: 'ses_access_key_id', label: 'Access key ID', secret: true, placeholder: 'AKIA...' },
        { name: 'ses_secret_access_key', label: 'Secret access key', secret: true },
        { name: 'ses_region', label: 'Region', showKey: 'region', placeholder: 'us-east-1' },
        { name: 'ses_from_email', label: 'Sender email (SES-verified)', showKey: 'from_email', placeholder: 'you@yourdomain.com' },
      ],
    },
    {
      key: 'gmail',
      label: 'Google',
      blurb: 'Uses Gmail over SMTP. You need an <b>App Password</b>, not your normal Google password - generate one at myaccount.google.com/apppasswords (requires 2-Step Verification).',
      fields: [
        { name: 'gmail_address', label: 'Gmail address', showKey: 'address', placeholder: 'you@gmail.com' },
        { name: 'gmail_app_password', label: 'App password', secret: true, placeholder: '16 characters' },
        { name: 'gmail_from_name', label: 'Sender name', showKey: 'from_name', placeholder: 'BlockMyCard' },
      ],
    },
  ];

  function providerByKey(k) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].key === k) return PROVIDERS[i];
    return null;
  }

  function getAdminKey() { return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''; }
  function setAdminKey(v) { sessionStorage.setItem(ADMIN_KEY_STORAGE, v); }

  function apiFetch(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'x-admin-key': getAdminKey() }, opts.headers || {});
    return fetch(url, Object.assign({}, opts, { headers: headers }))
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
      })
      .catch(function () { return { ok: false, status: 0, data: { error: 'Could not reach the server.' } }; });
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function statusLine(text, ok) {
    return el('div', 'margin-top:.6rem;font-size:.75rem;font-weight:600;padding:.45rem .65rem;border-radius:.375rem;' +
      (ok ? 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;'
          : 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;'), text);
  }

  // ── Step 1: admin key ──
  function buildAdminKeyCard() {
    var card = el('div', 'background:#fffbeb;border:1px solid #fde68a;border-radius:.5rem;padding:1rem;margin-bottom:1rem;');
    card.appendChild(el('h4', 'font-weight:700;font-size:.9rem;margin:0 0 .35rem;color:#92400e;', 'Admin key'));
    card.appendChild(el('p', 'font-size:.75rem;color:#92400e;margin:0 0 .6rem;',
      'Enter the ADMIN_API_SECRET configured on the server. Kept only in this browser tab\'s session.'));
    var row = el('div', 'display:flex;gap:.5rem;');
    var input = el('input', 'flex:1;border:1px solid #fbbf24;border-radius:.375rem;padding:.45rem .6rem;font-size:.8125rem;');
    input.type = 'password';
    input.value = getAdminKey();
    var btn = el('button', 'background:#92400e;color:#fff;border:none;border-radius:.375rem;padding:.45rem .9rem;font-size:.8125rem;font-weight:600;cursor:pointer;', 'Unlock');
    btn.onclick = function () { setAdminKey(input.value.trim()); refreshPanel(); };
    input.onkeydown = function (e) { if (e.key === 'Enter') btn.onclick(); };
    row.appendChild(input);
    row.appendChild(btn);
    card.appendChild(row);
    return card;
  }

  // ── Step 2: choose a provider ──
  function buildChooserCard(current) {
    var card = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.1rem;margin-bottom:1rem;');
    card.appendChild(el('h4', 'font-weight:700;font-size:.95rem;margin:0 0 .15rem;color:#0f172a;', 'Step 1 · Choose a provider'));
    card.appendChild(el('p', 'font-size:.75rem;color:#64748b;margin:0 0 .8rem;', 'Pick the service you want to send email through, then enter its credentials below.'));

    var row = el('div', 'display:flex;gap:.5rem;flex-wrap:wrap;');
    PROVIDERS.forEach(function (p) {
      var state = current[p.key] || {};
      var isSel = selected === p.key;
      var isActive = current.active_provider === p.key;

      var b = el('button', 'flex:1;min-width:150px;text-align:left;border-radius:.5rem;padding:.6rem .75rem;cursor:pointer;font-family:inherit;' +
        (isSel ? 'background:#0f172a;border:1.5px solid #0f172a;' : 'background:#fff;border:1.5px solid #cbd5e1;'));

      var name = el('div', 'font-size:.875rem;font-weight:700;margin-bottom:.15rem;color:' + (isSel ? '#fff' : '#0f172a') + ';', p.label);
      b.appendChild(name);

      var sub = state.configured ? (isActive ? 'Connected · in use' : 'Connected') : 'Not set up';
      var subColor = isSel ? '#cbd5e1' : (state.configured ? '#15803d' : '#94a3b8');
      b.appendChild(el('div', 'font-size:.7rem;font-weight:600;color:' + subColor + ';', sub));

      b.onclick = function () { selected = p.key; refreshPanel(); };
      row.appendChild(b);
    });
    card.appendChild(row);

    var activeLabel = current.active_provider ? (providerByKey(current.active_provider) || {}).label : null;
    card.appendChild(el('p', 'font-size:.75rem;margin:.8rem 0 0;color:' + (activeLabel ? '#15803d' : '#b45309') + ';font-weight:600;',
      activeLabel ? ('Login emails are currently sent via ' + activeLabel + '.')
                  : 'No provider is active yet, so no login emails are being sent.'));
    return card;
  }

  // ── Step 3: credentials for the chosen provider ──
  function buildCredentialsCard(provider, current) {
    var state = current[provider.key] || {};
    var isActive = current.active_provider === provider.key;

    var card = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.1rem;margin-bottom:1rem;');
    card.appendChild(el('h4', 'font-weight:700;font-size:.95rem;margin:0 0 .15rem;color:#0f172a;', 'Step 2 · ' + provider.label + ' credentials'));

    var blurb = el('p', 'font-size:.75rem;color:#64748b;margin:0 0 .9rem;line-height:1.5;');
    blurb.innerHTML = provider.blurb;
    card.appendChild(blurb);

    var inputs = {};
    provider.fields.forEach(function (f) {
      var wrap = el('label', 'display:block;margin-bottom:.6rem;');
      wrap.appendChild(el('span', 'display:block;font-size:.72rem;font-weight:700;color:#64748b;margin-bottom:.25rem;', f.label));
      var input = el('input', 'width:100%;border:1px solid #cbd5e1;border-radius:.375rem;padding:.45rem .6rem;font-size:.8125rem;box-sizing:border-box;font-family:inherit;');
      input.type = f.secret ? 'password' : 'text';
      if (f.secret) {
        input.placeholder = state.configured ? 'Saved — leave blank to keep it' : (f.placeholder || '');
      } else {
        input.placeholder = f.placeholder || '';
        if (f.showKey && state[f.showKey]) input.value = state[f.showKey];
      }
      wrap.appendChild(input);
      if (f.secret && state.key_hint && f.name.indexOf('key') > -1) {
        wrap.appendChild(el('span', 'display:block;font-size:.68rem;color:#94a3b8;margin-top:.15rem;', 'Currently saved: ' + state.key_hint));
      }
      card.appendChild(wrap);
      inputs[f.name] = input;
    });

    // Make-active toggle
    var actWrap = el('label', 'display:flex;align-items:center;gap:.5rem;margin:.9rem 0 .2rem;cursor:pointer;');
    var actBox = el('input', 'width:1rem;height:1rem;cursor:pointer;');
    actBox.type = 'checkbox';
    actBox.checked = isActive;
    actWrap.appendChild(actBox);
    actWrap.appendChild(el('span', 'font-size:.8125rem;color:#0f172a;font-weight:600;', 'Use ' + provider.label + ' to send login emails'));
    card.appendChild(actWrap);

    var statusHost = el('div');

    var btnRow = el('div', 'display:flex;gap:.5rem;margin-top:.8rem;flex-wrap:wrap;');
    var saveBtn = el('button', 'background:#0f172a;color:#fff;border:none;border-radius:.375rem;padding:.5rem 1.1rem;font-size:.8125rem;font-weight:600;cursor:pointer;font-family:inherit;', 'Save');
    var testBtn = el('button', 'background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:.375rem;padding:.5rem 1.1rem;font-size:.8125rem;font-weight:600;cursor:pointer;font-family:inherit;', 'Send test email');
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(testBtn);
    card.appendChild(btnRow);
    card.appendChild(statusHost);

    saveBtn.onclick = function () {
      var patch = {};
      provider.fields.forEach(function (f) {
        var v = inputs[f.name].value.trim();
        if (v) patch[f.name] = v;   // blank secret = keep existing
      });
      // Only touch active_provider when this checkbox actually changes things.
      if (actBox.checked) patch.active_provider = provider.key;
      else if (isActive) patch.active_provider = null;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      apiFetch('/api/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (r) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        statusHost.innerHTML = '';
        if (r.ok) { refreshPanel(); }
        else statusHost.appendChild(statusLine(r.data.error || ('Error ' + r.status), false));
      });
    };

    testBtn.onclick = function () {
      var to = window.prompt('Send a ' + provider.label + ' test email to:');
      if (!to) return;
      testBtn.disabled = true;
      testBtn.textContent = 'Sending...';
      apiFetch('/api/email-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to, provider: provider.key }),
      }).then(function (r) {
        testBtn.disabled = false;
        testBtn.textContent = 'Send test email';
        statusHost.innerHTML = '';
        statusHost.appendChild(r.ok && r.data.success
          ? statusLine('Test email sent via ' + r.data.provider + '. Check the inbox.', true)
          : statusLine(r.data.error || ('Error ' + r.status), false));
      });
    };

    return card;
  }

  var panelHost = null;

  function refreshPanel() {
    if (!panelHost) return;
    panelHost.innerHTML = '';
    var wrap = el('div', 'padding:1rem 0;max-width:640px;');
    wrap.appendChild(buildAdminKeyCard());

    if (!getAdminKey()) {
      panelHost.appendChild(wrap);
      return;
    }

    apiFetch('/api/email-settings').then(function (r) {
      if (!r.ok) {
        wrap.appendChild(statusLine(r.data.error || 'Could not load email settings (check the admin key).', false));
        panelHost.appendChild(wrap);
        return;
      }
      var current = r.data;
      // Default the form to whichever provider is already in use.
      if (!selected) selected = current.active_provider || null;

      wrap.appendChild(buildChooserCard(current));
      var provider = providerByKey(selected);
      if (provider) wrap.appendChild(buildCredentialsCard(provider, current));
      panelHost.appendChild(wrap);
    });
  }

  var injected = false;

  function tryInject() {
    if (injected) return;
    var allBtns = document.querySelectorAll('button'), banksTab = null;
    for (var i = 0; i < allBtns.length; i++) {
      if (allBtns[i].textContent.trim() === 'Banks') { banksTab = allBtns[i]; break; }
    }
    if (!banksTab) return;
    var tabContainer = banksTab.parentNode;
    if (!tabContainer) return;
    if (tabContainer.querySelector('[data-bmc-email-tab]')) { injected = true; return; }
    injected = true;

    var adminSection = tabContainer.parentNode;
    if (!adminSection) return;

    var tabBtn = document.createElement('button');
    tabBtn.dataset.bmcEmailTab = '1';
    tabBtn.textContent = 'Email Integrations';
    tabBtn.style.cssText = 'padding:.375rem .75rem;border-radius:.375rem;font-size:.875rem;font-weight:600;background:#fff;border:1px solid #cbd5e1;color:#475569;cursor:pointer;';
    tabContainer.appendChild(tabBtn);

    panelHost = document.getElementById('bmc-email-panel-host');
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.id = 'bmc-email-panel-host';
      panelHost.style.display = 'none';
      adminSection.appendChild(panelHost);
    }

    tabBtn.addEventListener('click', function () {
      var tabBtns = tabContainer.querySelectorAll('button');
      for (var i = 0; i < tabBtns.length; i++) {
        if (tabBtns[i] === tabBtn) { tabBtns[i].style.background = '#0f172a'; tabBtns[i].style.color = '#fff'; tabBtns[i].style.borderColor = '#0f172a'; }
        else if (tabBtns[i].parentNode === tabContainer) { tabBtns[i].style.background = '#fff'; tabBtns[i].style.color = '#475569'; tabBtns[i].style.borderColor = '#cbd5e1'; }
      }
      var ch = adminSection.children;
      for (var j = 0; j < ch.length; j++) {
        if (ch[j] !== tabContainer && ch[j] !== panelHost) { ch[j].style.display = 'none'; ch[j].dataset.bmcHidden = '1'; }
      }
      panelHost.style.display = 'block';
      refreshPanel();
    });

    var existingBtns = tabContainer.querySelectorAll('button');
    for (var k = 0; k < existingBtns.length; k++) {
      if (existingBtns[k] === tabBtn) continue;
      existingBtns[k].addEventListener('click', function () {
        panelHost.style.display = 'none';
        var ch = adminSection.children;
        for (var m = 0; m < ch.length; m++) {
          if (ch[m].dataset && ch[m].dataset.bmcHidden) { delete ch[m].dataset.bmcHidden; ch[m].style.display = ''; }
        }
      }, true);
    }
  }

  setInterval(function () { injected = false; tryInject(); }, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInject);
  else tryInject();
})();
