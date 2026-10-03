// Browser-level functional checks (headless Chromium) against the local build
// with an in-memory stand-in database. Nothing here touches production.
const { open, snap, login, registerPaid, adminLogin, rootText, buttons, kv, db, BASE } = require('./lib');
const FAKE = 'http://127.0.0.1:54321';
const crypto = require('crypto');
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : '  <- ' + String(detail || '').slice(0, 400)}`);
}
const reset = () => fetch(FAKE + '/__ctl?reset=1&down=0');
const down = (v) => fetch(FAKE + '/__ctl?down=' + (v ? 1 : 0));
const userRec = async (phone) => { const m = (await kv('cbp:users')) || {}; return Object.values(m).filter((u) => u && String(u.phone).replace(/\D/g, '').slice(-10) === phone); };
const toast = async (page) => (await page.locator('#bmc-otp-toast').isVisible().catch(() => false)) ? page.locator('#bmc-otp-toast').innerText() : '';
const banner = async (page) => (await page.locator('#bmc-error-banner').count()) ? page.locator('#bmc-error-banner').innerText() : '';
function forgeToken(phone, exp) {
  const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = b64url(JSON.stringify({ phone, exp }));
  return body + '.' + b64url(crypto.createHmac('sha256', 'local-test-otp-secret').update(body).digest());
}
async function t(id, name, fn) {
  try { await fn(); } catch (e) { check(id, name + ' [test crashed]', false, e.message.split('\n')[0]); }
}

(async () => {
  // ── U1: new user, paid registration end to end ──
  await reset();
  await t('U1', 'paid registration', async () => {
    const { browser, page, log } = await open('/');
    await registerPaid(page, '9812300001', 'Asha Rao', '9812300002', 'asha@example.com');
    const txt = await rootText(page);
    check('U1.1', 'new user: OTP login -> add cards -> pay -> contact -> lands on dashboard', /Hello, Asha Rao/.test(txt) && /4321/.test(txt) && /9876/.test(txt), txt.slice(0, 200));
    const recs = await userRec('9812300001');
    check('U1.2', 'new user: record saved (paid, 2 cards, email, verified alternate)', recs.length === 1 && recs[0].paid && recs[0].cards.length === 2 && recs[0].email === 'asha@example.com' && recs[0].altVerified === true, JSON.stringify(recs));
    check('U1.3', 'new user: no JavaScript errors during registration', log.errors.length === 0, log.errors.join(' | '));
    const bad = log.net.filter((x) => /-> (404|5\d\d)$/.test(x));
    check('U1.4', 'new user: no calls to missing/broken endpoints', bad.length === 0, [...new Set(bad)].join(' | '));

    // ── U3: refresh keeps the session ──
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    check('U3.1', 'session: page refresh keeps the user signed in on the dashboard', /Hello, Asha Rao/.test(await rootText(page)));

    // ── U8: block flow ──
    await page.locator('#root button:has-text("Block")').first().click();
    await page.waitForTimeout(600);
    const blockTxt = await page.locator('#root').innerText();
    const hrefs = await page.$$eval('#root a', (as) => as.map((a) => a.getAttribute('href') || ''));
    check('U8.1', 'block: Block shows SMS, email and helpline options for the card', /SMS BANK TO BLOCK/i.test(blockTxt) && hrefs.some((h) => /^tel:/.test(h)) && hrefs.some((h) => /^mailto:/.test(h)), blockTxt.slice(0, 300));
    check('U8.2', 'block: SMS details are pre-filled with the bank number and card last-4', /7308080808/.test(blockTxt) && /BLOCKCARD 4321/.test(blockTxt));
    const mail = decodeURIComponent(hrefs.find((h) => /^mailto:/.test(h)) || '');
    check('U8.3', 'block: email to the bank is pre-filled with card, name and registered number', /support@hdfcbank\.com/.test(mail) && /4321/.test(mail) && /Asha Rao/.test(mail) && /9812300001/.test(mail), mail.slice(0, 200));
    await page.locator('#root a[href^="tel:"]').first().click();
    await page.waitForTimeout(1500);
    const blockLogs = ((await kv('cbp:logs')) || []).filter((l) => l.actor === '9812300001').map((l) => l.action + ' ' + l.detail);
    check('U8.4', 'block: tapping the helpline is recorded in the activity log against the card', blockLogs.some((a) => /Helpline call initiated.*4321/.test(a)), blockLogs.join(','));
    await page.waitForTimeout(4500);
    check('U10.1', 'feedback: the rating prompt appears after a block action', /How easy was it to use the service/.test(await page.locator('#root').innerText()));
    await page.click('#root button:text-is("5")');
    await page.click('#root button:has-text("Submit feedback")');
    await page.waitForTimeout(1500);
    const fb = (await kv('cbp:feedback')) || [];
    check('U10.2', 'feedback: the submitted rating is stored', fb.length === 1 && String(fb[0].rating) === '5', JSON.stringify(fb));

    // ── U9: add another card on the dashboard, persists ──
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.click('#root button:has-text("+ Add card")');
    await page.waitForTimeout(400);
    await page.locator('#root select').nth(1).selectOption({ label: 'Axis Bank' });
    await page.fill('#root input[placeholder="Last 4"]', '5555');
    await page.click('#root button:text-is("Add card")');
    await page.waitForTimeout(600);
    await page.click('#root button:has-text("YES — Save")');
    await page.waitForTimeout(1500);
    let recs2 = await userRec('9812300001');
    check('U9.1', 'dashboard: adding a card saves it to the account', recs2[0] && recs2[0].cards.length === 3, JSON.stringify(recs2[0] && recs2[0].cards) + ' BTNS ' + JSON.stringify(await buttons(page)));

    // ── U2: log out, log back in ──
    await page.click('#bmc-logout-proxy');
    await page.waitForTimeout(800);
    const skip = page.locator('#root button:has-text("Skip — just log out")');
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(600); }
    check('U2.1', 'logout: returns to the login screen and clears the session', /Authenticate \/ Block/.test(await rootText(page)) && !(await page.evaluate(() => sessionStorage.getItem('bmc_phone_token'))));
    await login(page, '9812300001');
    const again = await rootText(page);
    check('U2.2', 'returning user: login goes straight to the dashboard with saved cards', /Hello, Asha Rao/.test(again) && /5555/.test(again), again.slice(0, 200));
    recs2 = await userRec('9812300001');
    check('U2.3', 'returning user: login does not alter the saved record', recs2.length === 1 && recs2[0].paid && recs2[0].cards.length === 3 && recs2[0].name === 'Asha Rao', JSON.stringify(recs2));
    await browser.close();

    // ── U4: alternate-number login reaches the same account ──
    const b = await open('/');
    await login(b.page, '9812300002', 'alternate');
    const altTxt = await rootText(b.page);
    check('U4.1', "alternate: verified alternate number opens the owner's cards", /4321/.test(altTxt) && /Asha Rao/.test(altTxt), altTxt.slice(0, 250));
    await b.browser.close();

    // alternate chosen for a number nobody nominated -> refused, nothing written
    const c = await open('/');
    await login(c.page, '9812300009', 'alternate');
    const refTxt = (await banner(c.page)) + ' ' + (await rootText(c.page));
    check('U4.2', 'alternate: an un-nominated number is refused with an explanation', /not been nominated/.test(refTxt), refTxt.slice(0, 200));
    check('U4.3', 'alternate: refusal creates no account', (await userRec('9812300009')).length === 0);
    await c.browser.close();

    // own number entered as "alternate" must not wipe the account
    const d = await open('/');
    await login(d.page, '9812300001', 'alternate');
    recs2 = await userRec('9812300001');
    check('U4.4', 'alternate: choosing "Alternate" with your own number does not damage the account', recs2.length === 1 && recs2[0].paid && recs2[0].cards.length === 3, JSON.stringify(recs2));
    await d.browser.close();
  });

  // ── U5: free path ──
  await reset();
  await t('U5', 'free path', async () => {
    const { browser, page } = await open('/');
    await login(page, '9812300011');
    await page.fill('#root input[placeholder="Full name"]', 'Free User');
    await page.selectOption('#root select', { label: 'HDFC Bank' });
    await page.fill('#root input[maxlength="4"]', '1212');
    await page.click('#root button:has-text("+ Add card")');
    await page.click('#root button:has-text("Continue")');
    await page.waitForTimeout(600);
    await page.click('#root button:has-text("NO — Continue free")');
    await page.waitForTimeout(1200);
    const txt = await rootText(page);
    check('U5.1', 'free user: declining payment still reaches a usable block screen', /Block/.test(txt) && !/Add your cards/.test(txt), txt.slice(0, 250));
    const recs = await userRec('9812300011');
    check('U5.2', 'free user: account exists and is not marked paid', recs.length === 1 && !recs[0].paid, JSON.stringify(recs));
    await browser.close();
    const b = await open('/');
    await login(b.page, '9812300011');
    const txt2 = await rootText(b.page);
    check('U5.3', 'free user: next login offers the add-cards / pay-to-save step again', /Add your cards/.test(txt2), txt2.slice(0, 200));
    await b.browser.close();
  });

  // ── U6/U7: wrong OTP, invalid phone ──
  await reset();
  await t('U6', 'otp errors', async () => {
    const { browser, page } = await open('/');
    await page.fill('#root input[type="tel"]', '12345');
    await page.click('#root button:has-text("Send OTP")');
    await page.waitForTimeout(500);
    const t1 = (await toast(page)) + (await banner(page));
    check('U7.1', 'login: invalid mobile number is rejected with a message', /valid 10-digit/.test(t1), t1);
    await page.fill('#root input[type="tel"]', '9812300021');
    await page.click('#root button:has-text("Send OTP")');
    await page.waitForSelector('#root input[maxlength="6"]');
    await page.waitForFunction(() => !!sessionStorage.getItem('bmc_token'));
    await page.fill('#root input[maxlength="6"]', '9999');
    await page.click('#root button:has-text("Verify OTP")');
    await page.waitForTimeout(1200);
    const t2 = await toast(page);
    check('U6.1', 'login: wrong OTP shows an error and stays on the OTP screen', /Invalid OTP/i.test(t2) && /Enter OTP/.test(await rootText(page)), t2);
    await page.fill('#root input[maxlength="6"]', '1234');
    await page.click('#root button:has-text("Verify OTP")');
    await page.waitForTimeout(2500);
    check('U6.2', 'login: correct OTP after a wrong one signs in', /Add your cards/.test(await rootText(page)));
    check('U6.3', 'login: the earlier error message is cleared after success', !(await toast(page)));
    await browser.close();

    // rate limit: 4th send walks the user back to the form
    const b = await open('/');
    for (let i = 0; i < 4; i++) {
      await b.page.fill('#root input[type="tel"]', '9812300022');
      await b.page.click('#root button:has-text("Send OTP")');
      await b.page.waitForTimeout(1500);
      if (i < 3) { await b.page.click('#root button:has-text("Go back")'); await b.page.waitForTimeout(400); }
    }
    await b.page.waitForTimeout(1500);
    const t3 = await toast(b.page);
    check('U6.4', 'login: 4th OTP request in 10 minutes is throttled with a clear message', /Too many OTP requests/.test(t3), t3);
    check('U6.5', 'login: throttled user is returned to the form (not stranded on the OTP screen)', /Authenticate \/ Block/.test(await rootText(b.page)), (await rootText(b.page)).slice(0, 150));
    await b.browser.close();
  });

  // ── U11/U12: admin ──
  await reset();
  await t('U11', 'admin', async () => {
    const seed = await open('/');
    await registerPaid(seed.page, '9812300031', 'Seed User', '9812300032', 'seed@example.com');
    await seed.browser.close();

    const { browser, page, log } = await open('/admin');
    await adminLogin(page);
    check('U11.1', 'admin: admin number + OTP opens the admin console', /Admin console/.test(await rootText(page)));
    await page.click('#root button:text-is("Users")');
    await page.waitForTimeout(600);
    let txt = await rootText(page);
    check('U11.2', 'admin: Users tab lists the registered user with cards', /9812300031/.test(txt) && /Seed User/.test(txt) && /4321/.test(txt), txt.slice(150, 500));
    check('U11.3', 'admin: each user is listed once', (txt.match(/9812300031/g) || []).length === 1, 'occurrences=' + (txt.match(/9812300031/g) || []).length);
    // admin edits the user's email
    const emailInput = page.locator('#root input[type="email"], #root input').filter({ hasNot: page.locator('[type=checkbox]') });
    const inputsNow = await page.$$eval('#root input', (is) => is.map((i) => i.value));
    const idx = inputsNow.indexOf('seed@example.com');
    if (idx >= 0) {
      const el = page.locator('#root input').nth(idx);
      await el.fill('seed-changed@example.com');
      await el.blur();
      await page.waitForTimeout(1200);
    }
    let recs = await userRec('9812300031');
    check('U11.4', "admin: editing a user's email saves to that user's single record", idx >= 0 && recs.length === 1 && recs[0].email === 'seed-changed@example.com' && recs[0].cards.length === 2, 'idx=' + idx + ' ' + JSON.stringify(recs.map((r) => ({ e: r.email, c: r.cards.length }))) + ' keys=' + Object.keys(await kv('cbp:users')).join(','));
    await page.click('#root button:text-is("Activity log")');
    await page.waitForTimeout(500);
    txt = await rootText(page);
    check('U11.5', 'admin: Activity log shows user activity', /Registered/.test(txt) && /9812300031/.test(txt));
    await page.click('#root button:text-is("Banks")');
    await page.waitForTimeout(400);
    check('U11.6', 'admin: Banks tab lists banks with blocking details', /State Bank of India/.test(await rootText(page)));
    // admin tools
    await page.click('button:has-text("Admin tools")');
    await page.waitForTimeout(400);
    await page.click('button:text-is("Payment Gateway")');
    await page.waitForTimeout(1200);
    await page.click('button:text-is("Free")');
    await page.waitForTimeout(1500);
    const mode = await (await fetch(BASE + '/api/payment/mode')).json();
    check('U11.7', 'admin: Payment Gateway panel switches the payment mode', mode.mode === 'free', JSON.stringify(mode));
    await page.click('button:text-is("Contact messages")');
    await page.waitForTimeout(600);
    const unlock = page.locator('button:has-text("Unlock messages")');
    if (await unlock.count()) { await unlock.click(); await page.waitForTimeout(1500); }
    const bodyTxt = await page.evaluate(() => document.body.innerText);
    const cmIdx = bodyTxt.lastIndexOf('Contact messages');
    const cm = bodyTxt.slice(cmIdx, cmIdx + 300);
    check('U11.8', 'admin: Contact messages panel loads (no server error)', !/error|failed|could not|404|not found/i.test(cm) && /message/i.test(cm), cm.replace(/\n+/g, ' | '));
    await page.click('button:text-is("OTP Mode")');
    await page.waitForTimeout(800);
    const bad = [...new Set(log.net.filter((x) => /-> (404|5\d\d)$/.test(x)))];
    check('U11.9', 'admin: console makes no calls to missing/broken endpoints', bad.length === 0, bad.join(' | '));
    check('U11.10', 'admin: no JavaScript errors in the console', log.errors.length === 0, log.errors.join(' | '));
    await browser.close();

    // user still gets their own, current data after the admin console saved
    const u = await open('/');
    await login(u.page, '9812300031');
    const ut = await rootText(u.page);
    check('U11.11', 'after admin edits: user logs in to the dashboard and sees the updated email', /Hello, Seed User/.test(ut) && /seed-changed@example.com/.test(ut), ut.slice(0, 300));
    await u.browser.close();

    // U12: a non-admin number at /admin
    const n = await open('/admin');
    await n.page.fill('#root input[type="tel"]', '9812300039');
    await n.page.click('#root button:has-text("Send OTP")');
    await n.page.waitForSelector('#root input[maxlength="6"]');
    await n.page.waitForFunction(() => !!sessionStorage.getItem('bmc_token'));
    await n.page.fill('#root input[maxlength="6"]', '1234');
    await n.page.click('#root button:has-text("Verify OTP")');
    await n.page.waitForTimeout(3000);
    const nt = (await toast(n.page)) + ' ' + (await rootText(n.page));
    check('U12.1', 'admin: a non-admin number is refused at /admin', /not authorized/.test(nt) && !/Admin console/.test(nt), nt.slice(0, 200));
    check('U12.2', 'admin: refused number is not registered as a customer', (await userRec('9812300039')).length === 0);
    await n.browser.close();

    // the admin number entered on the main site goes to the console, never into a customer signup
    const am = await open('/');
    await login(am.page, '9223548779');
    check('U12.3', 'admin number on the main page opens the admin console and creates no customer account', /Admin console/.test(await rootText(am.page)) && (await userRec('9223548779')).length === 0);
    await am.browser.close();
  });

  // ── U13/U14: database trouble during login ──
  await reset();
  await t('U13', 'outage', async () => {
    const seed = await open('/');
    await registerPaid(seed.page, '9812300041', 'Outage User', '9812300042', 'outage@example.com');
    await seed.browser.close();
    const before = (await userRec('9812300041'))[0];

    // (a) the account read fails at the moment of login, but writes still work
    const { browser, page, ctx } = await open('/');
    let failReads = true;
    await ctx.route('**/api/storage?key=cbp%3Ausers', (route) => (failReads && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"An error occurred. Please try again."}' }) : route.continue()));
    await login(page, '9812300041');
    await page.waitForTimeout(1000);
    const txt = (await banner(page)) + ' ' + (await toast(page)) + ' ' + (await rootText(page));
    const after = (await userRec('9812300041'))[0];
    check('U14.1', 'login while the account cannot be loaded: saved account is NOT wiped', after && after.paid === true && after.cards.length === 2 && after.name === 'Outage User', JSON.stringify(after));
    check('U14.2', 'login while the account cannot be loaded: user is told, not sent to "Add your cards" as a new user', !/Add your cards/.test(txt) && /(couldn.t|could not|unable|try again)/i.test(txt), txt.slice(0, 300));
    failReads = false;
    await browser.close();

    // (b) full database outage
    await down(true);
    const o = await open('/');
    await o.page.fill('#root input[type="tel"]', '9812300041');
    await o.page.click('#root button:has-text("Send OTP")');
    await o.page.waitForTimeout(11000); // the server retries the database for ~7s before giving up
    const ot = (await banner(o.page)) + ' ' + (await toast(o.page)) + ' ' + (await rootText(o.page));
    check('U13.1', 'full database outage: user gets a clear "temporarily unavailable" message at login', /(temporarily unavailable|try again (later|in a few minutes|shortly))/i.test(ot), ot.slice(0, 300));
    check('U13.2', 'full database outage: user is not walked into a registration that cannot be saved', !/Add your cards/.test(ot) && !/Enter OTP/.test(await rootText(o.page)), (await rootText(o.page)).slice(0, 150));
    await o.browser.close();
    await down(false);
    const still = (await userRec('9812300041'))[0];
    check('U13.3', 'after the outage: account is intact', still && still.paid && still.cards.length === 2);
    const r = await open('/');
    await login(r.page, '9812300041');
    check('U13.4', 'after the outage: user logs in normally again', /Hello, Outage User/.test(await rootText(r.page)));
    await r.browser.close();
  });

  // ── U15: session credential expiry ──
  await reset();
  await t('U15', 'expiry', async () => {
    const { browser, page } = await open('/');
    await registerPaid(page, '9812300051', 'Expiry User', '9812300052', 'exp@example.com');
    // simulate the signed token having expired while the tab stayed open
    await page.evaluate((tok) => sessionStorage.setItem('bmc_phone_token', tok), forgeToken('+919812300051', Date.now() - 60000));
    await page.click('#root button:has-text("+ Add card")');
    await page.waitForTimeout(300);
    await page.locator('#root select').nth(1).selectOption({ label: 'Axis Bank' });
    await page.fill('#root input[placeholder="Last 4"]', '7777');
    await page.click('#root button:text-is("Add card")');
    await page.waitForTimeout(600);
    await page.click('#root button:has-text("YES — Save")', { timeout: 3000 }).catch(() => {}); // the first refused save may already have ended the session
    await page.waitForTimeout(2500);
    const txt = (await banner(page)) + ' ' + (await toast(page)) + ' ' + (await rootText(page));
    check('U15.1', 'expired session: a save that cannot be stored is reported and the user is asked to sign in again (not silently dropped)', /(session (has )?expired|sign in again|log in again)/i.test(txt), txt.slice(0, 300));
    check('U15.2', 'expired session: user ends up on the login screen', /Authenticate \/ Block/.test(await rootText(page)), (await rootText(page)).slice(0, 120));
    await browser.close();
  });

  // ── U17: login email is requested after a sign-in this tab watched ──
  await reset();
  await t('U17', 'login email', async () => {
    const seed = await open('/');
    await registerPaid(seed.page, '9812300061', 'Mail User', '9812300062', 'mail@example.com');
    await seed.browser.close();
    const { browser, page, log } = await open('/');
    const bodies = [];
    page.on('request', (rq) => { if (rq.url().includes('/api/login-email')) bodies.push(JSON.parse(rq.postData() || '{}')); });
    await page.waitForTimeout(500);
    await login(page, '9812300061');
    await page.waitForTimeout(12000);
    check('U17.1', 'login email: a returning login asks the server to send the security-alert email', bodies.some((b) => b.event === 'login' && b.phone === '9812300061' && b.phoneToken), JSON.stringify(bodies.map((b) => ({ e: b.event, p: b.phone }))));
    await page.reload({ waitUntil: 'networkidle' });
    const n = bodies.length;
    await page.waitForTimeout(12000);
    check('U17.2', 'login email: a page refresh does not re-send old alerts', bodies.length === n, 'extra=' + (bodies.length - n));
    await browser.close();
  });

  // ── U18: admin can delete a user; number starting with 91 works ──
  await reset();
  await t('U18', 'admin delete + 91 prefix', async () => {
    const seed = await open('/');
    await registerPaid(seed.page, '9123456789', 'Ninety One', '9812300072', 'n1@example.com');
    const st = await rootText(seed.page);
    await seed.browser.close();
    const recs = await userRec('9123456789');
    check('U18.1', 'a mobile number that itself starts with 91 can register and is saved', /Hello, Ninety One/.test(st) && recs.length === 1 && recs[0].paid && recs[0].cards.length === 2, JSON.stringify(recs) + ' ' + st.slice(0, 120));
    const again = await open('/');
    await login(again.page, '9123456789');
    check('U18.2', 'a number starting with 91 logs back in to its dashboard', /Hello, Ninety One/.test(await rootText(again.page)), (await rootText(again.page)).slice(0, 150));
    await again.browser.close();

    const { browser, page } = await open('/admin');
    await adminLogin(page);
    await page.click('#root button:text-is("Users")');
    await page.waitForTimeout(500);
    await page.click('#root button:text-is("Delete")');
    await page.waitForTimeout(1500);
    check('U18.3', 'admin: Delete removes the user from the database', (await userRec('9123456789')).length === 0, JSON.stringify(Object.keys(await kv('cbp:users') || {})));
    await page.reload({ waitUntil: 'networkidle' });
    await browser.close();
    const b2 = await open('/admin');
    await adminLogin(b2.page);
    await b2.page.click('#root button:text-is("Users")');
    await b2.page.waitForTimeout(500);
    check('U18.4', 'admin: deleted user stays deleted after reopening the console', !/9123456789/.test(await rootText(b2.page)));
    await b2.browser.close();
  });

  // ── U16: static pages + assets ──
  await t('U16', 'static', async () => {
    for (const p of ['/', '/admin', '/about.html', '/privacy.html', '/terms-and-conditions.html', '/trust-security.html', '/register', '/app.js', '/otp-bridge.js', '/storage-bridge.js', '/cashfree-bridge.js', '/login-email-notifier.js', '/admin-tools-panel.js', '/admin-otp-toggle.js', '/admin-razorpay-toggle.js', '/admin-email-integrations.js', '/admin-contact-messages.js', '/assets/site-header.css', '/assets/site-header.js']) {
      const r = await fetch(BASE + p);
      check('U16' + p, `page/asset loads: ${p}`, r.status === 200, 'status=' + r.status);
    }
    for (const p of ['/about.html', '/privacy.html', '/terms-and-conditions.html', '/trust-security.html']) {
      const { browser, page, log } = await open(p);
      const links = await page.$$eval('a[href]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('/') && !h.startsWith('//')));
      const broken = [];
      for (const l of links) { const r = await fetch(BASE + l.split('#')[0]); if (r.status !== 200) broken.push(l + '=' + r.status); }
      check('U16.links' + p, `${p}: internal links resolve and no JS errors`, broken.length === 0 && log.errors.length === 0, broken.join(',') + ' ' + log.errors.join('|'));
      await browser.close();
    }
    const { browser, page, log } = await open('/');
    const imgs = await page.$$eval('img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
    check('U16.img', 'home: all images load', imgs.length === 0, imgs.join(','));
    // language switch + theme toggle
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /हिन्दी/.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(500);
    const hi = await page.evaluate(() => document.documentElement.getAttribute('data-lang'));
    check('U16.lang', 'home: language switch (Hindi) works', hi === 'hi', 'data-lang=' + hi);
    check('U16.err', 'home: no JavaScript errors', log.errors.length === 0, log.errors.join(' | '));
    const noisy = [...new Set(log.console.filter((x) => /storage\.set\(cbp:users\) failed: 401/.test(x)))];
    check('U16.noise', 'home: signed-out visitors do not fire a failing write on every page load', noisy.length === 0, noisy.join(' | '));
    await browser.close();
  });

  const failed = results.filter((x) => !x.ok);
  console.log(`\nUI SUITE: ${results.length - failed.length}/${results.length} passed`);
  require('fs').writeFileSync(__dirname + '/results-ui.json', JSON.stringify(results, null, 1));
  process.exit(0);
})().catch((e) => { console.error('SUITE CRASH', e); process.exit(2); });
