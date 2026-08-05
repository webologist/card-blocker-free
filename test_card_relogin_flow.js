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
  console.log('\n🧪 CARD PERSISTENCE FLOW TEST\n');
  console.log('═'.repeat(70));

  const testPhone = '+919999888877';

  try {
    // Step 1: Send OTP
    console.log('\n📱 Step 1: Send OTP');
    const sendRes = await request('POST', '/api/send-otp', { phone: testPhone });
    const token = sendRes.body.token;
    console.log(`   ✅ OTP sent, token: ${token.substring(0, 20)}...`);

    // Step 2: Verify OTP
    console.log('\n🔐 Step 2: Verify OTP');
    const verifyRes = await request('POST', '/api/verify-otp', { 
      phone: testPhone,
      otp: '1234',
      token
    });
    const phoneToken = verifyRes.body.phoneToken;
    console.log(`   ✅ OTP verified, phone token: ${phoneToken.substring(0, 20)}...`);

    // Step 3: Check what gets stored (simulate frontend getting user data)
    console.log('\n💾 Step 3: Check user data in storage');
    const storageRes = await request('GET', `/api/storage?key=cbp:users`);
    const users = JSON.parse(storageRes.body.value);
    const userData = users[testPhone];
    
    if (userData) {
      console.log(`   ✅ User record exists`);
      console.log(`      Name: ${userData.name || '(empty)'}`);
      console.log(`      Cards: ${userData.cards ? userData.cards.length : 0}`);
      console.log(`      Email: ${userData.email || '(empty)'}`);
      console.log(`      Saved: ${userData.saved}`);
    } else {
      console.log(`   ❌ No user record found for ${testPhone}`);
    }

    // Step 4: Simulate adding cards (from frontend perspective)
    console.log('\n💳 Step 4: Simulate adding cards (frontend action)');
    console.log(`   (Frontend would send: POST /api/storage with user data)`);
    
    // Retrieve current user data
    const currentUserData = {
      phone: testPhone,
      name: 'Test User',
      cards: [
        {
          id: 'test-card-1',
          type: 'Debit',
          bankId: 'sbi',
          last4: '1234'
        },
        {
          id: 'test-card-2',
          type: 'Credit',
          bankId: 'hdfc',
          last4: '5678'
        }
      ],
      saved: true,
      paid: false,
      email: 'test@example.com',
      altPhone: '',
      createdAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      paidAmount: 0,
      altVerified: false
    };

    // Save cards via storage API
    const updatedUsers = { ...users, [testPhone]: currentUserData };
    const saveRes = await request('POST', '/api/storage', {
      key: 'cbp:users',
      value: JSON.stringify(updatedUsers)
    });
    console.log(`   ✅ Cards saved to database`);
    console.log(`      Cards count: ${currentUserData.cards.length}`);

    // Step 5: Verify cards were saved
    console.log('\n✅ Step 5: Verify cards saved in database');
    const verifyStorageRes = await request('GET', `/api/storage?key=cbp:users`);
    const savedUsers = JSON.parse(verifyStorageRes.body.value);
    const savedUserData = savedUsers[testPhone];
    console.log(`   ✅ Saved user found`);
    console.log(`      Cards in DB: ${savedUserData.cards.length}`);
    savedUserData.cards.forEach((card, i) => {
      console.log(`        Card ${i+1}: ${card.type} ending in ${card.last4}`);
    });

    // Step 6: Simulate logout/new session
    console.log('\n🔄 Step 6: Simulate new login session');
    console.log(`   (User closes browser, opens new session)\n`);

    // Step 7: Re-login with same phone
    console.log('📱 Step 7: Re-send OTP (new session)');
    const sendRes2 = await request('POST', '/api/send-otp', { phone: testPhone });
    const token2 = sendRes2.body.token;
    console.log(`   ✅ OTP sent`);

    // Step 8: Re-verify OTP
    console.log('\n🔐 Step 8: Re-verify OTP (new session)');
    const verifyRes2 = await request('POST', '/api/verify-otp', {
      phone: testPhone,
      otp: '1234',
      token: token2
    });
    console.log(`   ✅ OTP verified`);

    // Step 9: Check if cards are still in database
    console.log('\n✅ Step 9: Retrieve cards after relogin');
    const retrieveRes = await request('GET', `/api/storage?key=cbp:users`);
    const retrievedUsers = JSON.parse(retrieveRes.body.value);
    const retrievedUserData = retrievedUsers[testPhone];
    
    if (!retrievedUserData) {
      console.log(`   ❌ ERROR: User record missing after relogin!`);
    } else if (!retrievedUserData.cards || retrievedUserData.cards.length === 0) {
      console.log(`   ❌ ERROR: Cards missing after relogin!`);
      console.log(`      Cards in DB: 0`);
    } else {
      console.log(`   ✅ Cards retrieved successfully`);
      console.log(`      Cards in DB: ${retrievedUserData.cards.length}`);
      retrievedUserData.cards.forEach((card, i) => {
        console.log(`        Card ${i+1}: ${card.type} ending in ${card.last4}`);
      });
    }

    // Step 10: Check frontend retrieval logic
    console.log('\n🔍 Step 10: Check frontend data retrieval');
    console.log(`   Frontend should:`);
    console.log(`   1. Send OTP → Get token`);
    console.log(`   2. Verify OTP → Get phoneToken (store in sessionStorage)`);
    console.log(`   3. Fetch /api/storage?key=cbp:users (to get all users)`);
    console.log(`   4. Extract user data for logged-in phone`);
    console.log(`   5. Display cards from userData.cards`);

  } catch (e) {
    console.error('\n❌ Test Error:', e.message);
  }

  console.log('\n' + '═'.repeat(70));
})();
