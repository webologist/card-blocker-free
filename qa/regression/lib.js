const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
async function open(path = '/', opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const log = { console: [], net: [], errors: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.errors.push(String(e).slice(0, 400)));
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) log.net.push(`${r.request().method()} ${u.replace(BASE, '')} -> ${r.status()}`); });
  page.on('requestfailed', (r) => log.net.push(`FAILED ${r.url()} ${r.failure() && r.failure().errorText}`));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  return { browser, ctx, page, log };
}
async function rootText(page) { return (await page.locator('#root').innerText()).replace(/\n+/g, ' | ').slice(0, 1500); }
async function buttons(page) { return page.$$eval('#root button', (bs) => bs.map((b) => b.textContent.trim()).filter(Boolean)); }
async function inputs(page) { return page.$$eval('#root input, #root select, #root textarea', (is) => is.map((i) => `${i.tagName.toLowerCase()}[type=${i.type}][max=${i.maxLength}][ph=${i.placeholder || ''}]${i.value ? '=' + i.value : ''}`)); }
async function snap(page, label) {
  console.log(`\n--- ${label}\nTEXT: ${await rootText(page)}\nBUTTONS: ${JSON.stringify(await buttons(page))}\nINPUTS: ${JSON.stringify(await inputs(page))}`);
  const toast = await page.locator('#bmc-otp-toast').isVisible().catch(() => false);
  if (toast) console.log('TOAST:', await page.locator('#bmc-otp-toast').innerText());
}
module.exports = { open, rootText, buttons, inputs, snap, BASE };
async function login(page, phone, as = 'own', otp = '1234') {
  if (as === 'alternate') await page.click('#root button:has-text("Alternate number")');
  await page.fill('#root input[type="tel"]', phone);
  await page.click('#root button:has-text("Send OTP")');
  await page.waitForSelector('#root input[maxlength="6"]', { timeout: 8000 });
  await page.waitForFunction(() => !!sessionStorage.getItem('bmc_token'), null, { timeout: 8000 }).catch(() => {});
  await page.fill('#root input[maxlength="6"]', otp);
  await page.click('#root button:has-text("Verify OTP")');
  await page.waitForTimeout(2500);
}
module.exports.login = login;
async function registerPaid(page, phone, name, alt, email) {
  await login(page, phone);
  await page.fill('#root input[placeholder="Full name"]', name);
  await page.selectOption('#root select', { label: 'HDFC Bank' });
  await page.fill('#root input[maxlength="4"]', '4321');
  await page.click('#root button:has-text("+ Add card")');
  await page.click('#root button:has-text("Credit")');
  await page.selectOption('#root select', { label: 'ICICI Bank' });
  await page.fill('#root input[maxlength="4"]', '9876');
  await page.click('#root button:has-text("+ Add card")');
  await page.click('#root button:has-text("Continue")');
  await page.waitForTimeout(600);
  await page.click('#root button:has-text("YES — Save my cards")');
  await page.waitForSelector('#root input[type="email"]', { timeout: 8000 });
  await page.fill('#root input[type="email"]', email);
  await page.fill('#root input[type="tel"][maxlength="10"]', alt);
  await page.click('#root button:has-text("Save & verify alternate number")');
  await page.waitForSelector('#root input[maxlength="6"]', { timeout: 8000 });
  await page.waitForFunction(() => !!sessionStorage.getItem('bmc_token'), null, { timeout: 8000 }).catch(() => {});
  await page.fill('#root input[maxlength="6"]', '1234');
  await page.click('#root button:has-text("Verify OTP")');
  await page.waitForTimeout(2500);
}
async function db() { return (await fetch('http://127.0.0.1:54321/__dump')).json(); }
async function kv(key) { const d = await db(); const r = d.kv_store.find((x) => x.key === key); if (!r) return null; try { return JSON.parse(r.value); } catch (e) { return r.value; } }
module.exports.registerPaid = registerPaid; module.exports.db = db; module.exports.kv = kv;
async function adminLogin(page) {
  await page.click('#root button:has-text("Send OTP")');
  await page.waitForSelector('#root input[maxlength="6"]', { timeout: 8000 });
  await page.waitForFunction(() => !!sessionStorage.getItem('bmc_token'), null, { timeout: 8000 }).catch(() => {});
  await page.fill('#root input[maxlength="6"]', '1234');
  await page.click('#root button:has-text("Verify OTP")');
  await page.waitForTimeout(3000);
}
module.exports.adminLogin = adminLogin;
