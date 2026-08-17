// admin-tools-panel.js
// Shared, React-safe host for admin console add-ons (OTP mode, Razorpay
// settings, email integrations, contact messages).
//
// Previously each of those four scripts injected its own tab button directly
// into the admin console's tab bar (the DOM node React renders and
// reconciles for Banks/Templates/Users/Logs/Feedback) and re-ran that
// injection on a 1-second interval, forever. With four scripts doing this at
// once, the tab bar and its parent ended up with several extra buttons/divs
// that React never put there and does not know about. React's reconciler
// still trusts its own idea of what that node's children are; the first time
// it needed to insert or remove a node in the middle of a list that no
// longer matched what it expected, the resulting DOM exception was thrown
// during render/commit with no error boundary anywhere in this app - which
// unmounts the ENTIRE component tree. That is "the module just disappears"
// after logging in as admin (9223548779).
//
// The fix here is architectural: this file owns one small floating panel
// appended to document.body - a sibling of #root, never a descendant - so
// nothing it does can ever collide with React's reconciliation again. The
// four admin-*.js scripts now call BmcAdminTools.register(...) instead of
// touching the admin console's own DOM, and this file loads before all of
// them (see index.html) so the API is always ready when they run.
(function () {
  if (window.BmcAdminTools) return; // loaded twice - keep the first instance

  // FIX (17 Aug 2026, item 4 - background polling loops): this whole panel
  // (the floating "Admin tools" button plus its four registered sub-panels)
  // is only ever shown once the admin console itself is showing
  // (isAdminConsoleShowing() below), which never happens off /admin - yet
  // tick() used to poll every second, and register() used to build the
  // floating host, on EVERY page load including the plain customer
  // #card-tool page, for zero observable effect there. That is one of
  // several unconditional setInterval loops suspected of contributing to
  // the renderer freezes users hit on the customer page - see
  // otp-bridge.js and login-email-notifier.js for the others. Gating the
  // whole thing to /admin removes it from the highest-traffic page
  // entirely with no behavior change on /admin itself.
  var ON_ADMIN = /^\/admin(\/|$)/.test(location.pathname);

  var tools = []; // { id, label, build() -> HTMLElement | Promise<HTMLElement> }
  var activeId = null;
  var visible = false;
  var floatBtn = null, win = null, tabBar = null, panelBody = null;

  // Read-only check (never mutates anything React manages) used only to
  // decide whether to show the floating "Admin Tools" launcher at all - no
  // point showing it on the login screen or the customer dashboard.
  function isAdminConsoleShowing() {
    var btns = document.querySelectorAll('#root button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim() === 'Banks') return true;
    }
    return false;
  }

  function ensureHost() {
    if (floatBtn) return;

    floatBtn = document.createElement('button');
    floatBtn.id = 'bmc-admin-tools-fab';
    floatBtn.type = 'button';
    floatBtn.textContent = '🛠 Admin tools';
    floatBtn.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:9997;background:#0f172a;' +
      'color:#fff;border:none;border-radius:9999px;padding:.6rem 1.1rem;font-size:.8125rem;' +
      'font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);' +
      'font-family:ui-sans-serif,system-ui,sans-serif;display:none;';
    floatBtn.onclick = function () { setVisible(!visible); };
    document.body.appendChild(floatBtn);

    win = document.createElement('div');
    win.id = 'bmc-admin-tools-window';
    win.style.cssText = 'position:fixed;bottom:4.4rem;right:1rem;z-index:9997;width:min(520px,calc(100vw - 2rem));' +
      'max-height:75vh;overflow:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.75rem;' +
      'box-shadow:0 16px 40px rgba(0,0,0,.3);font-family:ui-sans-serif,system-ui,sans-serif;display:none;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
      'padding:.65rem .9rem;border-bottom:1px solid #e2e8f0;background:#fff;border-radius:.75rem .75rem 0 0;';
    var title = document.createElement('div');
    title.textContent = 'Admin tools';
    title.style.cssText = 'font-weight:800;font-size:.85rem;color:#0f172a;';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:1rem;line-height:1;padding:.15rem .3rem;';
    closeBtn.onclick = function () { setVisible(false); };
    header.appendChild(title);
    header.appendChild(closeBtn);
    win.appendChild(header);

    tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem;padding:.65rem .9rem;border-bottom:1px solid #e2e8f0;background:#fff;';
    win.appendChild(tabBar);

    panelBody = document.createElement('div');
    panelBody.style.cssText = 'padding:.9rem;';
    win.appendChild(panelBody);

    document.body.appendChild(win);
  }

  function setVisible(v) {
    visible = v;
    if (win) win.style.display = v ? 'block' : 'none';
    if (v) renderActive();
  }

  function renderTabs() {
    if (!tabBar) return;
    tabBar.innerHTML = '';
    tools.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      var isActive = t.id === activeId;
      b.style.cssText = 'padding:.35rem .7rem;border-radius:.375rem;font-size:.75rem;font-weight:700;cursor:pointer;' +
        (isActive
          ? 'background:#0f172a;color:#fff;border:1px solid #0f172a;'
          : 'background:#fff;color:#475569;border:1px solid #cbd5e1;');
      b.onclick = function () { activeId = t.id; renderTabs(); renderActive(); };
      tabBar.appendChild(b);
    });
  }

  function renderActive() {
    if (!panelBody || !visible) return;
    var t = null;
    for (var i = 0; i < tools.length; i++) if (tools[i].id === activeId) { t = tools[i]; break; }
    panelBody.innerHTML = '';
    if (!t) return;
    var result;
    try { result = t.build(); } catch (e) { console.error('[ADMIN-TOOLS] build() threw for', t.id, e); return; }
    Promise.resolve(result).then(function (el) {
      // The user may have switched tabs while this was loading.
      if (activeId !== t.id || !visible) return;
      panelBody.innerHTML = '';
      if (el) panelBody.appendChild(el);
    }).catch(function (e) {
      console.error('[ADMIN-TOOLS] build() rejected for', t.id, e);
    });
  }

  function register(id, label, build) {
    if (!ON_ADMIN) return; // nothing off /admin can ever show this - see FIX above
    for (var i = 0; i < tools.length; i++) if (tools[i].id === id) return; // already registered
    tools.push({ id: id, label: label, build: build });
    if (!activeId) activeId = id;
    ensureHost();
    renderTabs();
    if (visible) renderActive();
  }

  // Lets a tool ask the panel to re-fetch/re-render itself (e.g. after a save)
  // without waiting for the user to switch tabs away and back.
  function refresh(id) {
    if (activeId === id && visible) renderActive();
  }

  function tick() {
    ensureHost();
    var showing = isAdminConsoleShowing();
    floatBtn.style.display = (showing && tools.length) ? 'block' : 'none';
    if (!showing && visible) setVisible(false);
  }
  if (ON_ADMIN) {
    setInterval(tick, 1000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
  }

  window.BmcAdminTools = { register: register, refresh: refresh };
})();
