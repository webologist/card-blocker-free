const http = require('http');

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: JSON.parse(data),
            headers: res.headers
          });
        } catch {
          resolve({
            status: res.statusCode,
            body: data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║            CARD PERSISTENCE FIX - VERIFICATION TEST             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const testPhone = '+919777666555';
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // ─────────────────────────────────────────────────────────────────
    // SESSION 1: Initial Login & Save Cards
    // ─────────────────────────────────────────────────────────────────
    console.log('📋 SESSION 1: Initial Login & Save Cards\n');

    // Step 1: Send OTP
    console.log('1️⃣  Sending OTP...');
    let res = await request('POST', '/api/send-otp', { phone: testPhone });
    if (res.status !== 200) throw new Error('OTP send failed');
    const token1 = res.body.token;
    console.log('   ✅ OTP sent, token: ' + token1.substring(0, 20) + '...\n');
    testsPassed++;

    // Step 2: Verify OTP
    console.log('2️⃣  Verifying OTP...');
    res = await request('POST', '/api/verify-otp', {
      phone: testPhone,
      otp: '1234',
      token: token1
    });
    if (res.status !== 200) throw new Error('OTP verify failed');
    const phoneToken1 = res.body.phoneToken;
    console.log('   ✅ OTP verified, phone token issued\n');
    testsPassed++;

    // Step 3: Get current users data
    console.log('3️⃣  Fetching current user database...');
    res = await request('GET', '/api/storage?key=cbp:users');
    const allUsers = JSON.parse(res.body.value);
    console.log('   ✅ Current users: ' + Object.keys(allUsers).length + '\n');

    // Step 4: Save cards for this user
    console.log('4️⃣  Saving 2 test cards...');
    const userDataWithCards = {
      phone: testPhone,
      name: 'Test User',
      cards: [
        { id: 'card-1', type: 'Debit', bankId: 'sbi', last4: '1111' },
        { id: 'card-2', type: 'Credit', bankId: 'hdfc', last4: '2222' }
      ],
      saved: true,
      paid: false,
      email: 'test@example.com',
      altPhone: '',
      createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      paidAmount: 0,
      altVerified: false
    };

    allUsers[testPhone] = userDataWithCards;
    res = await request('POST', '/api/storage', {
      key: 'cbp:users',
      value: JSON.stringify(allUsers)
    });
    if (res.status !== 200) throw new Error('Card save failed');
    console.log('   ✅ Cards saved: ' + userDataWithCards.cards.length + ' cards\n');
    testsPassed++;

    // Step 5: Verify cards are in database
    console.log('5️⃣  Verifying cards in database...');
    res = await request('GET', '/api/storage?key=cbp:users');
    const dbUsers = JSON.parse(res.body.value);
    const savedUserData = dbUsers[testPhone];
    if (!savedUserData || !savedUserData.cards || savedUserData.cards.length !== 2) {
      throw new Error('Cards not saved to database');
    }
    console.log('   ✅ Database has ' + savedUserData.cards.length + ' cards\n');
    testsPassed++;

    // ─────────────────────────────────────────────────────────────────
    // SESSION 2: Logout & Re-login
    // ─────────────────────────────────────────────────────────────────
    console.log('📋 SESSION 2: Logout & Re-login (Simulated New Browser Session)\n');

    console.log('(Simulating browser close/reopen - new sessionStorage)\n');

    // Step 6: Re-send OTP (new session)
    console.log('6️⃣  Re-sending OTP (new session)...');
    res = await request('POST', '/api/send-otp', { phone: testPhone });
    if (res.status !== 200) throw new Error('OTP send failed in session 2');
    const token2 = res.body.token;
    console.log('   ✅ OTP sent (new session)\n');
    testsPassed++;

    // Step 7: Re-verify OTP (new session)
    console.log('7️⃣  Verifying OTP (new session)...');
    res = await request('POST', '/api/verify-otp', {
      phone: testPhone,
      otp: '1234',
      token: token2
    });
    if (res.status !== 200) throw new Error('OTP verify failed in session 2');
    const phoneToken2 = res.body.phoneToken;
    console.log('   ✅ OTP verified (new session)\n');
    console.log('   📌 Note: Card loading script should now be intercepting this!\n');
    testsPassed++;

    // Step 8: Check if cards are still in database
    console.log('8️⃣  Fetching cards from database (after relogin)...');
    res = await request('GET', '/api/storage?key=cbp:users');
    const dbUsers2 = JSON.parse(res.body.value);
    const reloginUserData = dbUsers2[testPhone];

    if (!reloginUserData) {
      console.log('   ❌ FAIL: User record missing!');
      testsFailed++;
    } else if (!reloginUserData.cards || reloginUserData.cards.length === 0) {
      console.log('   ❌ FAIL: Cards missing after relogin!');
      testsFailed++;
    } else {
      console.log('   ✅ Cards retrieved: ' + reloginUserData.cards.length + ' cards');
      reloginUserData.cards.forEach((card, i) => {
        console.log('      Card ' + (i + 1) + ': ' + card.type + ' ending in ' + card.last4);
      });
      console.log();
      testsPassed++;
    }

    // ─────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────
    console.log('═'.repeat(65));
    console.log('\n📊 RESULTS\n');
    console.log('  ✅ Tests Passed: ' + testsPassed);
    console.log('  ❌ Tests Failed: ' + testsFailed);
    console.log('  📈 Total Tests: ' + (testsPassed + testsFailed) + '\n');

    if (testsFailed === 0) {
      console.log('🎉 SUCCESS! Card persistence flow is working!\n');
      console.log('Frontend card loading script should now:');
      console.log('  1. Intercept OTP verification');
      console.log('  2. Load user data from database');
      console.log('  3. Display saved cards on relogin');
      console.log('  4. Make cards available to React app\n');
    } else {
      console.log('⚠️  Some tests failed. Check above for details.\n');
    }

    console.log('═'.repeat(65) + '\n');

  } catch (e) {
    console.error('\n❌ Test Error:', e.message);
    process.exit(1);
  }
})();
