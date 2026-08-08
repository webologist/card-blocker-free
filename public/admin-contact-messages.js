// admin-contact-messages.js
// Injects a "Messages" tab into the admin console, matching the pattern used
// by admin-otp-toggle.js and admin-email-integrations.js.
//
// Every contact-form submission is written to the database before the email is
// attempted, so nothing is lost when a provider is misconfigured or down. Until
// now nothing could read those rows back, which made the safety net useless
// exactly when it mattered. This is the screen that reads them.
(function () {
  var ADMIN_KEY_STORAGE = 'bmc_admin_key';
  var PHONE_TOKEN_STORAGE = 'bmc_phone_token';
  var injected = false;
  var panelHost = null;
  // Set when the server rejects what we hold, so the next screen offers the
  // field instead of a button that would fail the same way.
  var credentialRejected = false;

  // The Email Integrations tab keeps the same secret under the same name but in
  // sessionStorage, so a key entered there used to be invisible here and the
  // admin was asked for it twice. Read both, write both.
  function adminKey() {
    var v = '';
    try { v = localStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch (e) {}
    if (!v) { try { v = sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch (e) {} }
    return v;
  }

  function rememberKey(v) {
    try { localStorage.setItem(ADMIN_KEY_STORAGE, v); } catch (e) {}
    try { sessionStorage.setItem(ADMIN_KEY_STORAGE, v); } catch (e) {}
  }

  function forgetKey() {
    try { localStorage.removeItem(ADMIN_KEY_STORAGE); } catch (e) {}
    try { sessionStorage.removeItem(ADMIN_KEY_STORAGE); } catch (e) {}
  }

  // Written by otp-bridge.js on a successful OTP. Signing in as the admin
  // number is already how this console is reached, so when the token is there
  // the key is not needed - the server accepts either.
  function phoneToken() {
    try { return sessionStorage.getItem(PHONE_TOKEN_STORAGE) || ''; } catch (e) { return ''; }
  }

  function authHeaders() {
    var h = {};
    var k = adminKey();
    var t = phoneToken();
    if (k) h['x-admin-key'] = k;
    if (t) h['x-phone-token'] = t;
    return h;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "28 Jul 2026, 14:12" - the stored value is ISO/UTC, shown in local time.
  function when(iso) {
    if (!iso) return 'Unknown time';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  var BTN_CSS = 'background:#0f172a;color:#fff;font-weight:700;font-size:.875rem;' +
    'padding:.55rem 1.1rem;border:none;border-radius:.375rem;cursor:pointer';

  function unlockShell(body, msg) {
    return '' +
      '<div style="max-width:26rem">' +
      '<h3 style="font-size:1.05rem;font-weight:800;margin-bottom:.35rem">Contact messages</h3>' +
      (msg ? '<p role="alert" style="font-size:.8rem;color:#b91c1c;margin-bottom:.6rem">' + esc(msg) + '</p>' : '') +
      body +
      '</div>';
  }

  // Preferred path: this browser already holds a credential the server accepts,
  // so there is nothing to type - one button submits it.
  function buttonMarkup(msg) {
    var viaLogin = !!phoneToken();
    return unlockShell(
      '<p style="font-size:.85rem;color:#64748b;margin-bottom:.75rem">' +
      (viaLogin
        ? 'Signed in on the admin number. Unlock to read messages sent from the contact form.'
        : 'This browser has an admin key saved. Unlock to read messages sent from the contact form.') +
      '</p>' +
      '<button id="bmc-cm-unlock" style="' + BTN_CSS + '">Unlock messages</button>' +
      (viaLogin ? '' :
        '<button id="bmc-cm-forget" style="margin-left:.6rem;background:none;border:1px solid #cbd5e1;' +
        'border-radius:.375rem;padding:.55rem 1rem;font-size:.8rem;font-weight:600;color:#475569;cursor:pointer">Use a different key</button>'),
      msg
    );
  }

  // Fallback only: nothing saved yet, so a button would have nothing to submit.
  // The secret is never baked into this file - it is served to every visitor.
  function fieldMarkup(msg) {
    return unlockShell(
      '<p style="font-size:.85rem;color:#64748b;margin-bottom:.75rem">' +
      'Enter the admin key once. It is saved in this browser, so from now on unlocking is a single button.</p>' +
      '<input id="bmc-cm-key" type="password" placeholder="Admin key" autocomplete="off" ' +
      'style="width:100%;padding:.55rem .7rem;border:1px solid #cbd5e1;border-radius:.375rem;font-size:.9rem;margin-bottom:.6rem"/>' +
      '<button id="bmc-cm-unlock" style="' + BTN_CSS + '">Unlock</button>',
      msg
    );
  }

  function messageMarkup(m) {
    return '' +
      '<div style="border:1px solid #e2e8f0;border-radius:.5rem;padding:.9rem 1rem;margin-bottom:.75rem;background:#fff">' +
      '<div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;justify-content:space-between">' +
      '<div style="font-weight:800;font-size:.95rem">' + esc(m.subject || '(no subject)') + '</div>' +
      '<div style="font-size:.75rem;color:#94a3b8;font-family:monospace">' + when(m.received_at) + '</div>' +
      '</div>' +
      '<div style="font-size:.82rem;color:#475569;margin-top:.3rem">' +
      esc(m.name || 'Unknown sender') +
      (m.email ? ' &middot; <a href="mailto:' + esc(m.email) + '" style="color:#d63a2a">' + esc(m.email) + '</a>' : '') +
      (m.mobile ? ' &middot; <a href="tel:' + esc(m.mobile) + '" style="color:#d63a2a">' + esc(m.mobile) + '</a>' : '') +
      '</div>' +
      '<p style="white-space:pre-wrap;font-size:.875rem;color:#1e293b;margin-top:.6rem;line-height:1.6">' + esc(m.brief) + '</p>' +
      '</div>';
  }

  function listMarkup(payload) {
    var msgs = payload.messages || [];
    var head = '' +
      '<div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:baseline;justify-content:space-between;margin-bottom:.9rem">' +
      '<h3 style="font-size:1.05rem;font-weight:800">Contact messages</h3>' +
      '<div style="font-size:.8rem;color:#64748b">' + msgs.length + ' of ' + payload.count +
      ' <button id="bmc-cm-refresh" style="margin-left:.6rem;background:none;border:1px solid #cbd5e1;border-radius:.375rem;padding:.25rem .7rem;font-size:.75rem;font-weight:600;color:#475569;cursor:pointer">Refresh</button></div>' +
      '</div>';

    if (!msgs.length) {
      return head +
        '<div style="border:1px dashed #cbd5e1;border-radius:.5rem;padding:2rem;text-align:center;color:#64748b;font-size:.875rem">' +
        'No messages yet. Anything sent through the contact form will appear here, even if the email fails to send.' +
        '</div>';
    }
    return head + msgs.map(messageMarkup).join('');
  }

  // Opening the tab never fires the request on its own - it offers the button
  // that does, or the field if this browser has no key yet.
  function refreshPanel() {
    if (!panelHost) return;
    renderUnlock();
  }

  function loadMessages() {
    if (!panelHost) return;
    var headers = authHeaders();
    if (!headers['x-admin-key'] && !headers['x-phone-token']) { renderUnlock(); return; }

    panelHost.innerHTML = '<div style="font-size:.875rem;color:#64748b">Loading messages&hellip;</div>';
    fetch('/api/contact-messages?limit=200', { headers: headers })
      .then(function (res) {
        // server.js answers 401, the Vercel function answers 403 - both mean
        // the same thing, and only one of them used to clear the bad key.
        if (res.status === 401 || res.status === 403) {
          forgetKey();
          credentialRejected = true;
          renderUnlock(headers['x-phone-token']
            ? 'This login was not accepted for messages. Enter the admin key instead.'
            : 'That admin key was not accepted.');
          return null;
        }
        if (!res.ok) throw new Error('Request failed (' + res.status + ')');
        return res.json();
      })
      .then(function (payload) {
        if (!payload) return;
        credentialRejected = false;
        panelHost.innerHTML = listMarkup(payload);
        var rb = document.getElementById('bmc-cm-refresh');
        if (rb) rb.addEventListener('click', loadMessages);
      })
      .catch(function (err) {
        panelHost.innerHTML = '<p role="alert" style="font-size:.875rem;color:#b91c1c">Could not load messages: ' +
          esc(err.message) + '</p>';
      });
  }

  function renderUnlock(msg) {
    // A rejected credential falls back to the field - offering the button again
    // would just replay the same failure.
    var saved = !credentialRejected && (adminKey() || phoneToken());
    panelHost.innerHTML = saved ? buttonMarkup(msg) : fieldMarkup(msg);

    var btn = document.getElementById('bmc-cm-unlock');

    if (saved) {
      if (btn) btn.addEventListener('click', loadMessages);
      var forget = document.getElementById('bmc-cm-forget');
      if (forget) {
        forget.addEventListener('click', function () { forgetKey(); renderUnlock(); });
      }
      return;
    }

    var input = document.getElementById('bmc-cm-key');
    function submit() {
      var v = (input.value || '').trim();
      if (!v) return;
      rememberKey(v);
      loadMessages();
    }
    if (btn) btn.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  function tryInject() {
    if (injected) return;
    var allBtns = document.querySelectorAll('button'), banksTab = null;
    for (var i = 0; i < allBtns.length; i++) {
      if (allBtns[i].textContent.trim() === 'Banks') { banksTab = allBtns[i]; break; }
    }
    if (!banksTab) return;
    var tabContainer = banksTab.parentNode;
    if (!tabContainer) return;
    if (tabContainer.querySelector('[data-bmc-messages-tab]')) { injected = true; return; }
    injected = true;

    var adminSection = tabContainer.parentNode;
    if (!adminSection) return;

    var tabBtn = document.createElement('button');
    tabBtn.dataset.bmcMessagesTab = '1';
    // The console already has a native "Messages" tab (message templates), so
    // this one has to say what it actually holds or the row shows two of them.
    tabBtn.textContent = 'Contact messages';
    tabBtn.style.cssText = 'padding:.375rem .75rem;border-radius:.375rem;font-size:.875rem;font-weight:600;background:#fff;border:1px solid #cbd5e1;color:#475569;cursor:pointer;';
    tabContainer.appendChild(tabBtn);

    panelHost = document.getElementById('bmc-messages-panel-host');
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.id = 'bmc-messages-panel-host';
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
