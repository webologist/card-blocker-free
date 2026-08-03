// admin-razorpay-toggle.js
// Injects a Razorpay Settings tab into the admin console.
(function () {
  var STORAGE_KEY = 'cbp:razorpay_settings';

  function getSettings() {
    return window.storage.get(STORAGE_KEY)
      .then(function(r) { return r ? r.value : null; })
      .catch(function() { return null; });
  }

  function setSettings(settings) {
    return window.storage.set(STORAGE_KEY, settings).catch(function(){});
  }

  function fetchSettings() {
    var token = sessionStorage.getItem('bmc_phone_token');

    // Use the phone token obtained during OTP verification. The API validates it.
    return fetch('/api/razorpay/settings', {
      headers: {
        'x-phone-token': token || '',
        'x-admin-key': localStorage.getItem('admin_api_secret') || ''
      }
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; });
  }

  function saveSettings(data) {
    var token = sessionStorage.getItem('bmc_phone_token');

    // Use the phone token obtained during OTP verification. The API validates it.
    return fetch('/api/razorpay/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-phone-token': token || '',
        'x-admin-key': localStorage.getItem('admin_api_secret') || ''
      },
      body: JSON.stringify(data)
    })
      .then(function(r) { return r.json(); })
      .catch(function(e) { console.error('Error saving Razorpay settings:', e); return null; });
  }

  function buildPanel() {
    return fetchSettings().then(function(response) {
      if (!response || !response.ok || !response.data) {
        var panel = document.createElement('div');
        panel.style.cssText = 'padding:1rem 0;';
        var card = document.createElement('div');
        card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.25rem;max-width:500px;';
        var msg = document.createElement('p');
        msg.textContent = 'Error loading Razorpay settings. Please check your admin access.';
        msg.style.cssText = 'color:#d63a2a;margin:0;';
        card.appendChild(msg);
        panel.appendChild(card);
        return panel;
      }

      var settings = response.data;
      var panel = document.createElement('div');
      panel.id = 'bmc-razorpay-settings-panel';
      panel.style.cssText = 'padding:1rem 0;';

      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.25rem;max-width:700px;';

      var h = document.createElement('h3');
      h.textContent = 'Razorpay Settings';
      h.style.cssText = 'font-weight:700;font-size:1rem;margin:0 0 .25rem;color:#0f172a;';
      card.appendChild(h);

      var desc = document.createElement('p');
      desc.style.cssText = 'font-size:.8125rem;color:#64748b;margin:0 0 1rem;line-height:1.5;';
      desc.textContent = 'Configure Razorpay payment gateway integration.';
      card.appendChild(desc);

      // Toggle section
      var toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid #e2e8f0;';

      var toggleLabel = document.createElement('label');
      toggleLabel.style.cssText = 'font-weight:600;color:#0f172a;cursor:pointer;flex:1;';
      toggleLabel.textContent = 'Enable Razorpay';

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = settings.enabled === true;
      checkbox.style.cssText = 'width:20px;height:20px;cursor:pointer;';

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(checkbox);
      card.appendChild(toggleRow);

      // API Key ID section
      var keyIdRow = document.createElement('div');
      keyIdRow.style.cssText = 'margin-bottom:1rem;';

      var keyIdLabel = document.createElement('label');
      keyIdLabel.style.cssText = 'display:block;font-weight:600;color:#0f172a;margin-bottom:.5rem;font-size:.875rem;';
      keyIdLabel.textContent = 'Razorpay Key ID (Public Key)';

      var keyIdInput = document.createElement('input');
      keyIdInput.type = 'text';
      keyIdInput.placeholder = 'rzp_live_xxx...';
      keyIdInput.value = settings.razorpay_key_id || '';
      keyIdInput.style.cssText = 'width:100%;padding:.6rem;border:1px solid #cbd5e1;border-radius:.375rem;font-size:.875rem;font-family:monospace;box-sizing:border-box;';

      keyIdRow.appendChild(keyIdLabel);
      keyIdRow.appendChild(keyIdInput);
      card.appendChild(keyIdRow);

      // API Key Secret section
      var keySecretRow = document.createElement('div');
      keySecretRow.style.cssText = 'margin-bottom:1.5rem;';

      var keySecretLabel = document.createElement('label');
      keySecretLabel.style.cssText = 'display:block;font-weight:600;color:#0f172a;margin-bottom:.5rem;font-size:.875rem;';
      keySecretLabel.textContent = 'Razorpay Key Secret (Private Key)';

      var keySecretInput = document.createElement('input');
      keySecretInput.type = 'password';
      keySecretInput.placeholder = '●●●●●●●●';
      keySecretInput.value = settings.razorpay_key_secret || '';
      keySecretInput.style.cssText = 'width:100%;padding:.6rem;border:1px solid #cbd5e1;border-radius:.375rem;font-size:.875rem;font-family:monospace;box-sizing:border-box;';

      keySecretRow.appendChild(keySecretLabel);
      keySecretRow.appendChild(keySecretInput);
      card.appendChild(keySecretRow);

      // Action buttons
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:.5rem;';

      var saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save Settings';
      saveBtn.style.cssText = 'flex:1;border-radius:.375rem;padding:.6rem;font-size:.875rem;font-weight:600;cursor:pointer;background:#0f172a;color:#fff;border:1.5px solid #0f172a;';

      var status = document.createElement('div');
      status.style.cssText = 'font-size:.8125rem;font-weight:600;padding:.5rem .75rem;border-radius:.375rem;margin-top:1rem;' +
        (settings.enabled ? 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;' : 'background:#fef2f2;color:#d63a2a;border:1px solid #fecaca;');
      status.textContent = settings.enabled ? 'Razorpay: ENABLED' : 'Razorpay: DISABLED';

      saveBtn.onclick = function() {
        var newSettings = {
          enabled: checkbox.checked,
          razorpay_key_id: keyIdInput.value.trim(),
          razorpay_key_secret: keySecretInput.value.trim()
        };

        if (newSettings.enabled && (!newSettings.razorpay_key_id || !newSettings.razorpay_key_secret)) {
          alert('Please enter both Key ID and Key Secret to enable Razorpay.');
          return;
        }

        saveSettings(newSettings).then(function(response) {
          if (response && response.ok) {
            alert('Razorpay settings saved successfully!');
            var host = panel.parentNode;
            if (host) {
              panel.remove();
              buildPanel().then(function(p) { host.appendChild(p); });
            }
          } else {
            alert('Error saving settings: ' + (response && response.error ? response.error : 'Unknown error'));
          }
        });
      };

      btnRow.appendChild(saveBtn);
      card.appendChild(btnRow);
      card.appendChild(status);

      var note = document.createElement('p');
      note.style.cssText = 'font-size:.75rem;color:#94a3b8;margin:.75rem 0 0;line-height:1.5;';
      note.innerHTML = '<strong>Get your keys from:</strong> <a href="https://dashboard.razorpay.com/app/keys" target="_blank" style="color:#0f172a;text-decoration:underline;">Razorpay Dashboard → Settings → API Keys</a>';
      card.appendChild(note);

      panel.appendChild(card);
      return panel;
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
    if (tabContainer.querySelector('[data-bmc-razorpay-tab]')) { injected = true; return; }
    injected = true;

    var adminSection = tabContainer.parentNode;
    if (!adminSection) return;

    var razorpayTabBtn = document.createElement('button');
    razorpayTabBtn.dataset.bmcRazorpayTab = '1';
    razorpayTabBtn.textContent = 'Razorpay';
    razorpayTabBtn.style.cssText = 'padding:.375rem .75rem;border-radius:.375rem;font-size:.875rem;font-weight:600;background:#fff;border:1px solid #cbd5e1;color:#475569;cursor:pointer;';
    tabContainer.appendChild(razorpayTabBtn);

    var panelHost = document.getElementById('bmc-razorpay-panel-host');
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.id = 'bmc-razorpay-panel-host';
      panelHost.style.display = 'none';
      adminSection.appendChild(panelHost);
    }

    razorpayTabBtn.addEventListener('click', function() {
      var tabBtns = tabContainer.querySelectorAll('button');
      for (var i = 0; i < tabBtns.length; i++) {
        if (tabBtns[i] === razorpayTabBtn) { tabBtns[i].style.background = '#0f172a'; tabBtns[i].style.color = '#fff'; tabBtns[i].style.borderColor = '#0f172a'; }
        else if (tabBtns[i].parentNode === tabContainer) { tabBtns[i].style.background = '#fff'; tabBtns[i].style.color = '#475569'; tabBtns[i].style.borderColor = '#cbd5e1'; }
      }
      var ch = adminSection.children;
      for (var j = 0; j < ch.length; j++) {
        if (ch[j] !== tabContainer && ch[j] !== panelHost) { ch[j].style.display = 'none'; ch[j].dataset.bmcHidden = '1'; }
      }
      panelHost.style.display = 'block';
      panelHost.innerHTML = '';
      buildPanel().then(function(p) { panelHost.appendChild(p); });
    });

    var existingBtns = tabContainer.querySelectorAll('button');
    for (var k = 0; k < existingBtns.length; k++) {
      if (existingBtns[k] === razorpayTabBtn) continue;
      existingBtns[k].addEventListener('click', function() {
        panelHost.style.display = 'none';
        var ch = adminSection.children;
        for (var m = 0; m < ch.length; m++) {
          if (ch[m].dataset && ch[m].dataset.bmcHidden) { delete ch[m].dataset.bmcHidden; ch[m].style.display = ''; }
        }
      }, true);
    }
  }

  setInterval(function() { injected = false; tryInject(); }, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInject);
  else tryInject();
})();
