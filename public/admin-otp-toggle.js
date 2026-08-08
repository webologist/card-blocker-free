// admin-otp-toggle.js
// Injects an OTP Mode tab into the admin console.
// Sets window.__bmc_dummy_mode (read synchronously by otp-bridge.js).
(function () {
  var STORAGE_KEY = 'cbp:otp_mode';

  function getMode() {
    return window.storage.get(STORAGE_KEY)
      .then(function(r){ return r ? r.value : 'live'; })
      .catch(function(){ return 'live'; });
  }

  function setMode(mode) {
    window.__bmc_dummy_mode = (mode === 'dummy');
    return window.storage.set(STORAGE_KEY, mode).catch(function(){});
  }

  // Keep window.__bmc_dummy_mode in sync - otp-bridge.js reads this synchronously
  function syncGlobal() {
    getMode().then(function(m) { window.__bmc_dummy_mode = (m === 'dummy'); });
  }
  syncGlobal();
  setInterval(syncGlobal, 2000);

  function buildPanel() {
    return getMode().then(function(current) {
      var isDummy = current === 'dummy';
      var panel = document.createElement('div');
      panel.id = 'bmc-otp-mode-panel';
      panel.style.cssText = 'padding:1rem 0;';
      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1.25rem;max-width:500px;';

      var h = document.createElement('h3');
      h.textContent = 'OTP Mode';
      h.style.cssText = 'font-weight:700;font-size:1rem;margin:0 0 .25rem;color:#0f172a;';
      card.appendChild(h);

      var desc = document.createElement('p');
      desc.style.cssText = 'font-size:.8125rem;color:#64748b;margin:0 0 1rem;line-height:1.5;';
      desc.innerHTML = 'Switch between <strong>Live Twilio</strong> (real SMS) and <strong>Dummy mode</strong> where the OTP is always <code style="background:#f1f5f9;padding:.1rem .35rem;border-radius:.25rem;font-family:monospace">1234</code> and no SMS is sent.';
      card.appendChild(desc);

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:.5rem;margin-bottom:1rem;';

      var liveBtn = document.createElement('button');
      liveBtn.textContent = 'Live Twilio';
      liveBtn.style.cssText = 'flex:1;border-radius:.375rem;padding:.6rem;font-size:.875rem;font-weight:600;cursor:pointer;' +
        (!isDummy ? 'background:#0f172a;color:#fff;border:1.5px solid #0f172a;' : 'background:#fff;color:#475569;border:1.5px solid #cbd5e1;');

      var dummyBtn = document.createElement('button');
      dummyBtn.textContent = 'Dummy OTP (1234)';
      dummyBtn.style.cssText = 'flex:1;border-radius:.375rem;padding:.6rem;font-size:.875rem;font-weight:600;cursor:pointer;' +
        (isDummy ? 'background:#7c3aed;color:#fff;border:1.5px solid #7c3aed;' : 'background:#fff;color:#475569;border:1.5px solid #cbd5e1;');

      liveBtn.onclick = function() {
        setMode('live').then(function() {
          var host = panel.parentNode; panel.remove();
          if (host) buildPanel().then(function(p){ host.appendChild(p); });
        });
      };
      dummyBtn.onclick = function() {
        setMode('dummy').then(function() {
          var host = panel.parentNode; panel.remove();
          if (host) buildPanel().then(function(p){ host.appendChild(p); });
        });
      };

      btnRow.appendChild(liveBtn);
      btnRow.appendChild(dummyBtn);
      card.appendChild(btnRow);

      var status = document.createElement('div');
      status.style.cssText = 'font-size:.8125rem;font-weight:600;padding:.5rem .75rem;border-radius:.375rem;' +
        (isDummy ? 'background:#f3e8ff;color:#7c3aed;border:1px solid #ddd6fe;' : 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;');
      status.textContent = isDummy
        ? 'Dummy mode ON - OTP is 1234, Twilio NOT called'
        : 'Live mode ON - OTPs sent via Twilio SMS';
      card.appendChild(status);

      var note = document.createElement('p');
      note.style.cssText = 'font-size:.75rem;color:#94a3b8;margin:.75rem 0 0;';
      note.innerHTML = 'Also controllable via the Vercel env var <code style="background:#f1f5f9;padding:.1rem .35rem;border-radius:.25rem;font-family:monospace">OTP_MODE=dummy</code>.';
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
    if (tabContainer.querySelector('[data-bmc-otp-tab]')) { injected = true; return; }
    injected = true;

    var adminSection = tabContainer.parentNode;
    if (!adminSection) return;

    var otpTabBtn = document.createElement('button');
    otpTabBtn.dataset.bmcOtpTab = '1';
    otpTabBtn.textContent = 'OTP Mode';
    otpTabBtn.style.cssText = 'padding:.375rem .75rem;border-radius:.375rem;font-size:.875rem;font-weight:600;background:#fff;border:1px solid #cbd5e1;color:#475569;cursor:pointer;';
    tabContainer.appendChild(otpTabBtn);

    var panelHost = document.getElementById('bmc-otp-panel-host');
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.id = 'bmc-otp-panel-host';
      panelHost.style.display = 'none';
      adminSection.appendChild(panelHost);
    }

    otpTabBtn.addEventListener('click', function() {
      var tabBtns = tabContainer.querySelectorAll('button');
      for (var i = 0; i < tabBtns.length; i++) {
        if (tabBtns[i] === otpTabBtn) { tabBtns[i].style.background = '#0f172a'; tabBtns[i].style.color = '#fff'; tabBtns[i].style.borderColor = '#0f172a'; }
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
      if (existingBtns[k] === otpTabBtn) continue;
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
