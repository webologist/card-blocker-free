// API-level functional + access-control checks against the local build.
// Nothing here touches production - the app is pointed at an in-memory
// stand-in database (fake-supabase.js).
const BASE = process.env.BASE || 'http://localhost:3000';
const FAKE = 'http://127.0.0.1:54321';
process.env.OTP_SECRET = 'local-test-otp-secret';
const ADMIN_KEY = 'local-test-admin-key';
const ADMIN = '9223548779';
const crypto = require('crypto');

const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : '  <- ' + (detail || '')}`);
}
async function api(method, path, body, headers) {
  const r = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}
const reset = () => fetch(FAKE + '/__ctl?reset=1&down=0');
const down = (v) => fetch(FAKE + '/__ctl?down=' + (v ? 1 : 0));
async function dump() { return (await fetch(FAKE + '/__dump')).json(); }
async function kv(key) { const d = await dump(); const r = d.kv_store.find((x) => x.key === key); if (!r) return null; try { return JSON.parse(r.value); } catch (e) { return r.value; } }

async function signIn(phone) {
  const s = await api('POST', '/api/send-otp', { phone: '+91' + phone });
  if (!s.json || !s.json.token) throw new Error('send-otp failed for ' + phone + ': ' + s.status + ' ' + JSON.stringify(s.json));
  const v = await api('POST', '/api/verify-otp', { phone: '+91' + phone, otp: '1234', token: s.json.token });
  if (!v.json || !v.json.phoneToken) throw new Error('verify failed for ' + phone + ': ' + JSON.stringify(v.json));
  return v.json.phoneToken;
}
const T = (t) => ({ 'x-phone-token': t });
const getUsers = async (t) => { const r = await api('GET', '/api/storage?key=cbp:users', undefined, T(t)); return { status: r.status, map: r.json && r.json.value ? JSON.parse(r.json.value) : null }; };
const putUsers = (t, map) => api('POST', '/api/storage', { key: 'cbp:users', value: JSON.stringify(map) }, T(t));
const rec = (phone, extra) => Object.assign({ phone, name: '', cards: [], saved: false, paid: false, email: '', altPhone: '', createdAt: 'c-' + phone }, extra || {});

// Same construction as lib/phone-token.js, used only to mint an EXPIRED token.
function forgeToken(phone, exp) {
  const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = b64url(JSON.stringify({ phone, exp }));
  return body + '.' + b64url(crypto.createHmac('sha256', process.env.OTP_SECRET).update(body).digest());
}

(async () => {
  // ── A1: send-otp validation ──
  await reset();
  let r = await api('POST', '/api/send-otp', { phone: '+919811100001' });
  check('A1.1', 'send-otp: valid number returns a challenge token', r.status === 200 && r.json.token);
  check('A1.2', 'send-otp: response never contains the OTP itself', !/1234/.test(Buffer.from(String(r.json.token).split('.')[0], 'base64').toString()));
  r = await api('POST', '/api/send-otp', { phone: '12345' });
  check('A1.3', 'send-otp: invalid number rejected (400)', r.status === 400);
  r = await api('POST', '/api/send-otp', {});
  check('A1.4', 'send-otp: missing number rejected (400)', r.status === 400);
  r = await api('GET', '/api/send-otp');
  check('A1.5', 'send-otp: GET not allowed (405)', r.status === 405);
  r = await api('POST', '/api/send-otp', { phone: '5811100001' });
  check('A1.6', 'send-otp: number not starting 6-9 rejected', r.status === 400);

  // ── A2: verify-otp ──
  await reset();
  let s = await api('POST', '/api/send-otp', { phone: '+919811100002' });
  r = await api('POST', '/api/verify-otp', { phone: '+919811100002', otp: '0000', token: s.json.token });
  check('A2.1', 'verify-otp: wrong code rejected (401)', r.status === 401 && !r.json.phoneToken);
  r = await api('POST', '/api/verify-otp', { phone: '+919811100003', otp: '1234', token: s.json.token });
  check('A2.2', 'verify-otp: token for another number rejected', r.status === 400);
  r = await api('POST', '/api/verify-otp', { phone: '+919811100002', otp: '1234', token: s.json.token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) });
  check('A2.3', 'verify-otp: tampered token rejected', r.status === 400);
  r = await api('POST', '/api/verify-otp', { phone: '+919811100002', otp: '1234', token: s.json.token });
  check('A2.4', 'verify-otp: correct code issues a phone token', r.status === 200 && r.json.phoneToken);
  const firstToken = r.json.phoneToken;
  r = await api('POST', '/api/verify-otp', { phone: '+919811100002', otp: '1234', token: s.json.token });
  check('A2.5', 'verify-otp: challenge cannot be replayed', r.status === 400 || r.status === 429);
  r = await api('POST', '/api/verify-otp', { phone: '+919811100002', otp: 'abcd', token: s.json.token });
  check('A2.6', 'verify-otp: non-numeric code rejected', r.status === 400);
  // brute-force cap
  await reset();
  s = await api('POST', '/api/send-otp', { phone: '+919811100004' });
  let last;
  for (let i = 0; i < 6; i++) last = await api('POST', '/api/verify-otp', { phone: '+919811100004', otp: '000' + i, token: s.json.token });
  check('A2.7', 'verify-otp: 6th guess on one challenge is locked out (429)', last.status === 429);
  r = await api('POST', '/api/verify-otp', { phone: '+919811100004', otp: '1234', token: s.json.token });
  check('A2.8', 'verify-otp: correct code after lock-out still refused', r.status === 429);

  // ── A3: send-otp rate limit ──
  await reset();
  for (let i = 0; i < 3; i++) last = await api('POST', '/api/send-otp', { phone: '+919811100005' });
  check('A3.1', 'send-otp: 3 requests allowed', last.status === 200);
  r = await api('POST', '/api/send-otp', { phone: '+919811100005' });
  check('A3.2', 'send-otp: 4th request in 10 min throttled (429)', r.status === 429);
  r = await api('POST', '/api/send-otp', { phone: '+919811100006' });
  check('A3.3', 'send-otp: throttle is per number', r.status === 200);

  // ── A4: storage addressing ──
  await reset();
  r = await api('GET', '/api/storage?key=cbp:banks');
  check('A4.1', 'storage: public key readable signed-out', r.status === 200);
  r = await api('POST', '/api/storage', { key: 'cbp:banks', value: '[]' });
  check('A4.2', 'storage: public key not writable signed-out', r.status === 401);
  r = await api('GET', '/api/storage?key=cbp:users');
  check('A4.3', 'storage: users not readable signed-out', r.status === 401);
  r = await api('GET', '/api/storage?key=ratelimit:send-otp:9811100005');
  check('A4.4', 'storage: internal keys not addressable', r.status === 400);
  r = await api('GET', '/api/storage?key=cbp:otp_mode');
  check('A4.5', 'storage: admin key not readable signed-out', r.status === 401);
  r = await api('GET', '/api/storage');
  check('A4.6', 'storage: missing key rejected', r.status === 400);
  r = await api('GET', '/api/storage?key=cbp:users', undefined, T('garbage.token'));
  check('A4.7', 'storage: forged token rejected', r.status === 401);
  r = await api('GET', '/api/storage?key=cbp:users', undefined, T(forgeToken('+919811100002', Date.now() - 1000)));
  check('A4.8', 'storage: expired token rejected', r.status === 401);

  // ── A5: per-user isolation ──
  await reset();
  const tA = await signIn('9811100011');
  const tB = await signIn('9811100012');
  await putUsers(tA, { 9811100011: rec('9811100011', { name: 'Asha', email: 'a@example.com', cards: [{ id: 'c1', type: 'Debit', bankId: 'hdfc', last4: '1111' }], paid: true, saved: true }) });
  await putUsers(tB, { 9811100012: rec('9811100012', { name: 'Bala', email: 'b@example.com' }) });
  let a = await getUsers(tA); let b = await getUsers(tB);
  check('A5.1', 'storage: user reads back own record under the 10-digit key the app uses', a.map && a.map['9811100011'] && a.map['9811100011'].name === 'Asha');
  check('A5.2', 'storage: user cannot see another user', a.map && !Object.values(a.map).some((u) => u.phone === '9811100012') && !Object.values(b.map).some((u) => u.phone === '9811100011'));
  r = await putUsers(tB, { 9811100011: rec('9811100011', { name: 'HACKED' }) });
  a = await getUsers(tA);
  check('A5.3', "storage: user cannot overwrite another user's record", a.map['9811100011'].name === 'Asha');
  check('A5.4', 'storage: write response does not leak other users', r.json && !/Asha|9811100011/.test(r.json.value || ''));
  await api('POST', '/api/storage', { key: 'cbp:logs', value: JSON.stringify([{ t: 't1', actor: '9811100011', action: 'Login', detail: 'x' }]) }, T(tA));
  await api('POST', '/api/storage', { key: 'cbp:logs', value: JSON.stringify([{ t: 't2', actor: '9811100012', action: 'Login', detail: 'y' }, { t: 't3', actor: '9811100011', action: 'FAKE', detail: 'forged' }]) }, T(tB));
  r = await api('GET', '/api/storage?key=cbp:logs', undefined, T(tB));
  const logsB = JSON.parse(r.json.value);
  check('A5.5', "logs: user sees only own entries", logsB.length === 1 && logsB[0].actor === '9811100012');
  const allLogs = await kv('cbp:logs');
  check('A5.6', "logs: user cannot forge entries in another user's timeline", !allLogs.some((e) => e.action === 'FAKE'));
  r = await api('DELETE', '/api/storage?key=cbp:users', undefined, T(tA));
  check('A5.7', 'storage: non-admin cannot delete a table', r.status === 401 && (await kv('cbp:users')));

  // ── A6: admin ──
  const tAdmin = await signIn(ADMIN);
  let ad = await getUsers(tAdmin);
  const adminPhones = Object.values(ad.map || {}).map((u) => u.phone).filter((p) => /^\d{10}$/.test(p));
  check('A6.1', 'admin: sees every registered user', adminPhones.includes('9811100011') && adminPhones.includes('9811100012'));
  check('A6.2', 'admin: users map is keyed by the 10-digit number the app looks up', ad.map && ad.map['9811100011'] && ad.map['9811100012']);
  r = await api('GET', '/api/storage?key=cbp:otp_mode', undefined, T(tAdmin));
  check('A6.3', 'admin: phone token opens admin-only key', r.status === 200);
  r = await api('GET', '/api/storage?key=cbp:otp_mode', undefined, { 'x-admin-key': ADMIN_KEY });
  check('A6.4', 'admin: shared secret opens admin-only key', r.status === 200);
  r = await api('GET', '/api/storage?key=cbp:otp_mode', undefined, { 'x-admin-key': 'wrong' });
  check('A6.5', 'admin: wrong secret refused', r.status === 401);
  r = await api('GET', '/api/storage?key=cbp:otp_mode', undefined, T(tA));
  check('A6.6', 'admin: ordinary user token refused on admin-only key', r.status === 401);

  // ── A13: one record per phone, whoever wrote last ──
  // Admin console writes the whole map back keyed the way the client holds it.
  await putUsers(tAdmin, Object.assign({}, ad.map, { __no_demo__: { phone: '__no_demo__', cards: [] } }));
  // The user then changes their own record...
  a = await getUsers(tA);
  await putUsers(tA, { 9811100011: Object.assign({}, a.map['9811100011'], { name: 'Asha Updated', cards: a.map['9811100011'].cards.concat([{ id: 'c2', type: 'Credit', bankId: 'icici', last4: '2222' }]) }) });
  a = await getUsers(tA);
  check('A13.1', 'users: user sees own latest write after the admin console has saved', a.map['9811100011'] && a.map['9811100011'].name === 'Asha Updated' && a.map['9811100011'].cards.length === 2, JSON.stringify(a.map['9811100011'] && { n: a.map['9811100011'].name, c: a.map['9811100011'].cards.length }));
  const rawUsers = await kv('cbp:users');
  const copies = Object.values(rawUsers).filter((u) => String(u.phone).replace(/\D/g, '').slice(-10) === '9811100011').length;
  check('A13.2', 'users: exactly one stored record per phone number', copies === 1, 'copies=' + copies + ' keys=' + Object.keys(rawUsers).join(','));
  ad = await getUsers(tAdmin);
  const adminCopy = Object.values(ad.map).filter((u) => u.phone === '9811100011');
  check('A13.3', 'users: admin sees the same single, current record', adminCopy.length === 1 && adminCopy[0].name === 'Asha Updated', JSON.stringify(adminCopy.map((u) => u.name)));

  // ── A7: alternate contact ──
  await reset();
  const tOwner = await signIn('9811100021');
  const tAlt = await signIn('9811100022');
  await putUsers(tOwner, { 9811100021: rec('9811100021', { name: 'Owner', paid: true, saved: true, cards: [{ id: 'c1', type: 'Debit', bankId: 'sbi', last4: '3333' }], altPhone: '9811100022', altVerified: false }) });
  let alt = await getUsers(tAlt);
  check('A7.1', 'alternate: unverified alternate cannot reach the account', !alt.map || !alt.map['9811100021']);
  let own = await getUsers(tOwner);
  await putUsers(tOwner, { 9811100021: Object.assign({}, own.map['9811100021'], { altVerified: true }) });
  alt = await getUsers(tAlt);
  check('A7.2', "alternate: verified alternate can read the owner's cards", alt.map && alt.map['9811100021'] && alt.map['9811100021'].cards.length === 1);
  await putUsers(tAlt, { 9811100021: Object.assign({}, alt.map['9811100021'], { email: 'evil@example.com', cards: [] }) });
  own = await getUsers(tOwner);
  check('A7.3', "alternate: cannot modify the owner's record", own.map['9811100021'].cards.length === 1 && own.map['9811100021'].email !== 'evil@example.com');

  // ── A14: an existing account can never be replaced by a blank signup ──
  await reset();
  const tU = await signIn('9811100031');
  await putUsers(tU, { 9811100031: rec('9811100031', { name: 'Paid User', paid: true, saved: true, email: 'p@example.com', cards: [{ id: 'c1', type: 'Debit', bankId: 'sbi', last4: '4444' }] }) });
  r = await putUsers(tU, { 9811100031: { phone: '9811100031', name: '', cards: [], saved: false, paid: false, email: '', altPhone: '', createdAt: 'a-different-signup' } });
  let u = await getUsers(tU);
  check('A14.1', 'users: a fresh blank "new signup" record cannot wipe an existing paid account', u.map['9811100031'] && u.map['9811100031'].paid === true && u.map['9811100031'].cards.length === 1, 'status=' + r.status + ' rec=' + JSON.stringify(u.map['9811100031']));
  r = await putUsers(tU, { 9811100031: Object.assign({}, u.map['9811100031'], { cards: [] }) });
  u = await getUsers(tU);
  check('A14.2', 'users: the owner can still legitimately edit/delete their own cards', r.status === 200 && u.map['9811100031'].cards.length === 0 && u.map['9811100031'].paid === true);

  // ── A15: session credential lifetime matches the 12h app session ──
  const exp = JSON.parse(Buffer.from(firstToken.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).exp;
  const hours = (exp - Date.now()) / 3600000;
  check('A15.1', 'session: phone token lives as long as the app session (12h), not 15 min', hours > 11.5 && hours <= 12.1, 'token lifetime = ' + (hours * 60).toFixed(0) + ' min');

  // ── A8: login email ──
  await reset();
  const tE = await signIn('9811100041');
  await putUsers(tE, { 9811100041: rec('9811100041', { name: 'Mail User', email: 'm@example.com' }) });
  r = await api('POST', '/api/login-email', { phone: '9811100041', ts: 't1', event: 'login', phoneToken: tE });
  check('A8.1', 'login-email: answers no-provider when no email provider is connected', r.status === 200 && r.json.reason === 'no-provider');
  // connect a (dummy) provider so the lookup path runs; sending itself will fail offline
  await api('POST', '/api/email-settings', { active_provider: 'brevo', brevo_api_key: 'x', brevo_from_email: 'noreply@example.com', brevo_from_name: 'T' }, { 'x-admin-key': ADMIN_KEY });
  r = await api('POST', '/api/login-email', { phone: '9811100041', ts: 't2', event: 'login' });
  check('A8.2', 'login-email: refuses an unproven claim (no phone token)', r.json && r.json.sent === false && r.json.reason === 'unverified', JSON.stringify(r.json));
  const tOther = await signIn('9811100042');
  r = await api('POST', '/api/login-email', { phone: '9811100041', ts: 't3', event: 'login', phoneToken: tOther });
  check('A8.3', "login-email: refuses a token that belongs to a different number", r.json && r.json.sent === false && r.json.reason === 'unverified', JSON.stringify(r.json));
  r = await api('POST', '/api/login-email', { phone: '9811100041', ts: 't4', event: 'login', phoneToken: tE });
  const d = await dump();
  check('A8.4', "login-email: finds the user's saved email and attempts the send", d.login_email_log.some((x) => x.ts === 't4'), JSON.stringify(r.json) + ' log=' + JSON.stringify(d.login_email_log));

  // ── A9/A10: payment + email settings ──
  await reset();
  r = await api('GET', '/api/payment/mode');
  check('A9.1', 'payment: public mode endpoint defaults to dummy', r.status === 200 && r.json.mode === 'dummy');
  r = await api('GET', '/api/payment/settings');
  check('A9.2', 'payment: settings refused signed-out', r.status === 401);
  r = await api('POST', '/api/payment/settings', { mode: 'free' }, { 'x-admin-key': ADMIN_KEY });
  check('A9.3', 'payment: admin can switch mode', r.status === 200 && r.json.data.mode === 'free');
  r = await api('GET', '/api/payment/mode');
  check('A9.4', 'payment: public mode reflects the admin change', r.json.mode === 'free');
  r = await api('POST', '/api/payment/settings', { mode: 'bitcoin' }, { 'x-admin-key': ADMIN_KEY });
  check('A9.5', 'payment: invalid mode rejected', r.status === 400);
  r = await api('POST', '/api/payment/settings', { cashfree_app_id: 'APPID123456', cashfree_secret_key: 'secret-value' }, { 'x-admin-key': ADMIN_KEY });
  check('A9.6', 'payment: gateway secret is never echoed back', r.status === 200 && !JSON.stringify(r.json).includes('secret-value') && r.json.data.cashfree.configured === true);
  r = await api('GET', '/api/email-settings');
  check('A10.1', 'email-settings: refused signed-out', r.status === 401);
  r = await api('POST', '/api/email-settings', { active_provider: 'brevo', brevo_api_key: 'xkeysib-secret-123456', brevo_from_email: 'a@example.com' }, { 'x-admin-key': ADMIN_KEY });
  check('A10.2', 'email-settings: admin can save; API key is masked in the reply', r.status === 200 && !JSON.stringify(r.json).includes('xkeysib-secret-123456'));

  // ── A11: cashfree ──
  r = await api('POST', '/api/cashfree/create-order', {});
  check('A11.1', 'cashfree: create-order refused signed-out', r.status === 401);
  const tC = await signIn('9811100051');
  r = await api('POST', '/api/cashfree/create-order', {}, T(tC));
  check('A11.2', 'cashfree: create-order refused while mode is not cashfree', r.status === 400);
  r = await api('POST', '/api/cashfree/verify-order', { orderId: 'nope' }, T(tC));
  check('A11.3', 'cashfree: verify-order does not credit an unknown order', r.status >= 400 || (r.json && !r.json.credited));

  // ── A12: admin contact messages route exists on the deployed backend ──
  r = await api('GET', '/api/contact-messages');
  check('A12.1', 'contact-messages: route exists and refuses signed-out callers', r.status === 401 || r.status === 403, 'status=' + r.status);
  r = await api('GET', '/api/contact-messages', undefined, { 'x-admin-key': ADMIN_KEY });
  check('A12.2', 'contact-messages: admin can list messages', r.status === 200 && Array.isArray(r.json.messages), 'status=' + r.status);

  // ── A17: numbers that start with 91 ──
  await reset();
  const t91 = await signIn('9123456780');
  await putUsers(t91, { 9123456780: rec('9123456780', { name: 'NinetyOne' }) });
  const u91 = await getUsers(t91);
  check('A17.1', 'a mobile number that itself starts with 91 can save and read its own record', u91.map && u91.map['9123456780'] && u91.map['9123456780'].name === 'NinetyOne', JSON.stringify(u91.map));

  // ── A18: admin delete ──
  const tAd2 = await signIn(ADMIN);
  let all2 = await getUsers(tAd2);
  await putUsers(tAd2, Object.assign({}, all2.map, { 9123456780: { phone: '9123456780', createdAt: 'c-9123456780', __deleted: true } }));
  all2 = await getUsers(tAd2);
  check('A18.1', 'admin: an explicit delete removes the user', !all2.map['9123456780'], Object.keys(all2.map).join(','));
  // the number registers again; a stale tombstone must not delete the NEW account
  const t91b = await signIn('9123456780');
  await putUsers(t91b, { 9123456780: rec('9123456780', { name: 'Second Signup', createdAt: 'later' }) });
  await putUsers(tAd2, { 9123456780: { phone: '9123456780', createdAt: 'c-9123456780', __deleted: true } });
  all2 = await getUsers(tAd2);
  check('A18.2', "admin: a stale delete cannot remove an account the number created afterwards", all2.map['9123456780'] && all2.map['9123456780'].name === 'Second Signup');
  await putUsers(t91b, { 9123456780: rec('9123456780', { name: 'Second Signup', createdAt: 'later', __deleted: true }) });
  const still91 = await getUsers(t91b);
  check('A18.3', 'delete marker from a non-admin never removes the account or sticks to it', !!(still91.map && still91.map['9123456780'] && still91.map['9123456780'].name === 'Second Signup' && !('__deleted' in still91.map['9123456780'])), JSON.stringify(still91.map));

  // ── A19: legacy duplicate records collapse to one ──
  await reset();
  await fetch(FAKE + '/rest/v1/kv_store', { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'cbp:users', value: JSON.stringify({
    '+919811100071': { phone: '9811100071', name: 'User Copy', cards: [{ id: 'a' }, { id: 'b' }], paid: true, createdAt: 'x' },
    '__no_demo__': { phone: '__no_demo__', cards: [] },
    '9811100071': { phone: '9811100071', name: 'Admin Snapshot', cards: [{ id: 'a' }], paid: true, createdAt: 'x' },
    '+919811100072': { phone: '+919811100072', name: 'Register Page User', cards: [] },
    'legacy-odd-entry': { note: 'no phone on this one' },
  }) }) });
  const tL = await signIn('9811100071');
  const leg = await getUsers(tL);
  check('A19.1', "legacy data: a user stored twice gets back the copy their own session wrote", leg.map['9811100071'] && leg.map['9811100071'].name === 'User Copy' && leg.map['9811100071'].cards.length === 2, JSON.stringify(leg.map));
  await putUsers(tL, { 9811100071: Object.assign({}, leg.map['9811100071'], { email: 'new@example.com' }) });
  const rawL = await kv('cbp:users');
  check('A19.2', 'legacy data: the next save rewrites the table with one record per number and no placeholder', Object.keys(rawL).sort().join(',') === '9811100071,9811100072,legacy-odd-entry' && rawL['9811100071'].email === 'new@example.com', Object.keys(rawL).join(','));
  check('A19.2b', 'legacy data: an entry the re-keying does not recognise is preserved, not dropped', !!rawL['legacy-odd-entry'] && rawL['legacy-odd-entry'].note === 'no phone on this one');
  const tL2 = await signIn('9811100072');
  const leg2 = await getUsers(tL2);
  check('A19.3', 'legacy data: an account created by the old /register page is recognised by the main app', !!(leg2.map && leg2.map['9811100072'] && leg2.map['9811100072'].name === 'Register Page User'), JSON.stringify(leg2.map));

  // ── A16: database outage is reported honestly ──
  await reset();
  const tO = await signIn('9811100061');
  await down(true);
  r = await api('GET', '/api/storage?key=cbp:users', undefined, T(tO));
  check('A16.1', 'outage: storage read fails loudly (5xx), never as an empty success', r.status >= 500);
  r = await api('GET', '/api/health');
  check('A16.2', 'outage: /api/health reports the database as unreachable', r.status === 503 && r.json && r.json.database === 'unreachable', 'status=' + r.status + ' ' + JSON.stringify(r.json));
  r = await api('POST', '/api/send-otp', { phone: '+919811100062' });
  check('A16.3', 'outage: OTP is not issued while accounts cannot be loaded', r.status === 503, 'status=' + r.status);
  await down(false);
  r = await api('GET', '/api/health');
  check('A16.4', 'health: reports ok when the database is reachable', r.status === 200 && r.json && r.json.database === 'ok', 'status=' + r.status);

  const failed = results.filter((x) => !x.ok);
  console.log(`\nAPI SUITE: ${results.length - failed.length}/${results.length} passed`);
  require('fs').writeFileSync(__dirname + '/results-api.json', JSON.stringify(results, null, 1));
  process.exit(0);
})().catch((e) => { console.error('SUITE CRASH', e); process.exit(2); });
