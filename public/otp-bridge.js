// otp-bridge.js
(function () {
  var lastPhone=sessionStorage.getItem('bmc_phone')||'',_pendingToken=sessionStorage.getItem('bmc_token')||null,_allowVerify=false,_otpValue=null,_toastTimer=null,_resendCountdown=null,_otpRequestId=0,_otpPurpose='login';
  Object.defineProperty(window,'__bmc_otp',{get:function(){return _otpValue;},set:function(v){_otpValue=v;},enumerable:false,configurable:true});
  function loadAdminToggle(){if(document.querySelector('script[src*="admin-otp-toggle"]'))return;var s=document.createElement('script');s.src='/admin-otp-toggle.js';s.async=true;document.head.appendChild(s);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadAdminToggle);else loadAdminToggle();
  function getDummyMode(){return window.__bmc_dummy_mode===true;}
  function showDummyBanner(v){var b=document.getElementById('bmc-dummy-banner');if(!b){b=document.createElement('div');b.id='bmc-dummy-banner';b.style.cssText='position:fixed;top:28px;left:0;right:0;z-index:9997;background:#7c3aed;color:#fff;font-size:.72rem;font-weight:600;text-align:center;padding:.3rem 1rem;font-family:ui-sans-serif,system-ui,sans-serif;pointer-events:none;';b.textContent='DUMMY OTP MODE - code is 1234, Twilio NOT called';document.body.insertBefore(b,document.body.firstChild);}b.style.display=v?'block':'none';}
  function refreshBanners(){showDummyBanner(getDummyMode());}
  setInterval(refreshBanners,800);window.addEventListener('focus',refreshBanners);
  // The app's own logout control, wherever it currently is. The exit modal
  // comes first: while it is open the header's button only re-opens it, and
  // this bar sits on top of the modal, so its button has to be the one that
  // actually ends the session. Looked up fresh each time - React replaces these
  // nodes on every render.
  function findLogoutButton(){var skip=[...document.querySelectorAll('#root button')].find(function(b){return b.textContent.trim()==='Skip — just log out';});if(skip)return skip;var rh=document.querySelector('#root header');if(rh){var btns=rh.querySelectorAll('button');for(var i=0;i<btns.length;i++){var t=btns[i].textContent.trim();if(t==='Log out'||t==='Exit admin')return btns[i];}}return null;}
  function fixLogoutButton(){var rh=document.querySelector('#root header');var btn=findLogoutButton();if(!btn){var old=document.getElementById('bmc-logout-bar');if(old)old.remove();return;}var label=btn.textContent.trim();var phoneEl=rh?rh.querySelector('span.font-mono'):null;var phoneText=phoneEl?phoneEl.textContent.trim():'';var bar=document.getElementById('bmc-logout-bar');if(!bar){bar=document.createElement('div');bar.id='bmc-logout-bar';bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9998;background:#1e293b;display:flex;align-items:center;justify-content:flex-end;padding:.35rem 1rem;gap:1rem;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1;';var ph=document.createElement('span');ph.id='bmc-logout-phone';ph.style.cssText='font-family:monospace;font-size:.75rem;color:#94a3b8;';bar.appendChild(ph);var proxy=document.createElement('button');proxy.id='bmc-logout-proxy';proxy.style.cssText='background:none;border:1px solid #475569;color:#cbd5e1;border-radius:.375rem;padding:.2rem .65rem;cursor:pointer;font-size:.75rem;font-weight:600;';proxy.onmouseenter=function(){proxy.style.color='#fff';};proxy.onmouseleave=function(){proxy.style.color='#cbd5e1';};bar.appendChild(proxy);document.body.insertBefore(bar,document.body.firstChild);}var ph2=document.getElementById('bmc-logout-phone');var proxy2=document.getElementById('bmc-logout-proxy');if(ph2)ph2.textContent=phoneText;if(proxy2){proxy2.textContent=label;proxy2.onclick=function(){// Reloading used to be indistinguishable from logging out, because the app
// forgot who you were on every load. It no longer does, so this has to press
// the app's own button - that is what clears the stored session.
var live=findLogoutButton();if(live)live.click();else location.reload();};}}
  setInterval(fixLogoutButton,500);
  // Torn down as soon as the OTP screen goes away. It used to just bail when
  // the input was gone, so the button - and its ticking countdown - stayed
  // welded to whatever screen came next: "Resend OTP in 15s" sitting under the
  // dashboard, resending an OTP for a login that had already finished.
  function removeResendButton(){clearInterval(_resendCountdown);_resendCountdown=null;var b=document.getElementById('bmc-resend-btn');if(b)b.remove();}
  function injectResendButton(){var otpInput=document.querySelector('input[maxlength="6"]');if(!otpInput){removeResendButton();return;}var existing=document.getElementById('bmc-resend-btn');if(existing&&existing.dataset.reqId===String(_otpRequestId))return;if(existing)existing.remove();var rb=document.createElement('button');rb.id='bmc-resend-btn';rb.dataset.reqId=String(_otpRequestId);rb.disabled=true;var secs=60;rb.textContent='Resend OTP in '+secs+'s';rb.style.cssText='margin-top:.75rem;display:block;width:100%;background:none;border:1px solid #cbd5e1;color:#94a3b8;border-radius:.375rem;padding:.5rem 1rem;font-size:.875rem;font-family:ui-sans-serif,system-ui,sans-serif;cursor:default;';var container=otpInput.closest('div')||otpInput.parentElement;container.insertAdjacentElement('afterend',rb);clearInterval(_resendCountdown);_resendCountdown=setInterval(function(){secs--;var b=document.getElementById('bmc-resend-btn');if(!b){clearInterval(_resendCountdown);return;}if(secs<=0){clearInterval(_resendCountdown);b.disabled=false;b.textContent='Resend OTP';b.style.color='#d63a2a';b.style.borderColor='#d63a2a';b.style.cursor='pointer';b.onclick=function(){var again=sanitisePhone(lastPhone);if(!/^[6-9][0-9]{9}$/.test(again))return;requestOtpFor(again,null,{purpose:_otpPurpose,sentMsg:'New OTP sent to your phone.'});};} else{b.textContent='Resend OTP in '+secs+'s';}},1000);}
  setInterval(injectResendButton,600);
  function showError(msg){clearTimeout(_toastTimer);var t=document.getElementById('bmc-otp-toast');if(!t){t=document.createElement('div');t.id='bmc-otp-toast';// Yellow on black, matching bmcAlert in app.js - every alert the user can be
// shown reads the same way, whichever file raised it.
t.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:10001;width:min(420px,calc(100vw - 2rem));background:#facc15;border:1.5px solid #ca8a04;border-radius:10px;padding:.75rem 2.75rem .75rem 1rem;font-size:.875rem;font-weight:600;color:#000;box-shadow:0 8px 24px rgba(0,0,0,.2);line-height:1.5;word-break:break-word;';var x=document.createElement('button');x.textContent='x';x.style.cssText='position:absolute;top:.5rem;right:.65rem;background:none;border:none;cursor:pointer;color:#000;font-size:.9rem;font-weight:700;';x.onclick=hideError;t.appendChild(x);document.body.appendChild(t);}var x2=t.querySelector('button');Array.from(t.childNodes).forEach(function(n){if(n!==x2)t.removeChild(n);});t.insertBefore(document.createTextNode(msg),x2);t.style.display='block';_toastTimer=setTimeout(hideError,10000);}
  function hideError(){clearTimeout(_toastTimer);var t=document.getElementById('bmc-otp-toast');if(t)t.style.display='none';}
  function fetchWT(url,opts){var ctrl=new AbortController();var timer=setTimeout(function(){ctrl.abort();},30000);return fetch(url,Object.assign({},opts,{signal:ctrl.signal})).then(function(r){clearTimeout(timer);return r;}).catch(function(e){clearTimeout(timer);throw e;});}
  function safeJson(r){return r.json().catch(function(){return null;});}
  function sanitisePhone(raw){if(!raw||raw.length>20)return'';var d=String(raw).replace(/[^0-9]/g,'');if(d.length===12&&d.slice(0,2)==='91')d=d.slice(2);if(d[0]==='0'&&d.length>=11)d=d.slice(1);return d;}
  // Every OTP the app can ask for is sent from here, so the challenge token
  // always belongs to the number actually on the OTP screen. It used to be
  // inlined in the "Send OTP" branch below, which meant the only number that
  // could ever be verified was the one typed on the login screen.
  //   btn  - button to show progress on, or null when the click navigates away
  //          and React is about to unmount it.
  //   opts - {purpose:'login'|'altPhone', sentMsg:string}
  // The app moves to the OTP screen the moment the button is pressed, and this
  // file does the sending afterwards - so a send that fails leaves the user on
  // a screen announcing "An OTP has been sent to <number>" when none was. The
  // toast saying otherwise clears itself after ten seconds, and there is no
  // Send OTP button on that screen to retry from: a rate-limited user is stuck
  // reading a message that is not true. Walk them back to the form, where the
  // number is still editable and the button still exists.
  //
  // Polled rather than immediate because React has usually not painted the OTP
  // screen yet when a fast failure comes back.
  function abandonOtpScreen(){
    var tries=0;
    var timer=setInterval(function(){
      if(++tries>20){clearInterval(timer);return;}
      var back=[].slice.call(document.querySelectorAll('#root button')).filter(function(b){return b.textContent.trim()==='Go back';})[0];
      if(back){clearInterval(timer);removeResendButton();back.click();}
    },100);
  }
  function requestOtpFor(digits,btn,opts){
    opts=opts||{};hideError();
    _otpPurpose=opts.purpose||'login';
    lastPhone='+91'+digits;sessionStorage.setItem('bmc_phone',lastPhone);
    _pendingToken=null;sessionStorage.removeItem('bmc_token');_otpValue=null;
    var dummy=getDummyMode(),orig=btn?btn.textContent:'';
    var reset=function(){if(btn){btn.disabled=false;btn.textContent=orig;}};
    // Dummy mode used to short-circuit here with a placeholder token and never
    // call the server, so the client decided what "dummy" meant. The server
    // decides now (lib/otp-mode.js), and it has to see a send for every verify
    // - that request is where the 3-per-10-minutes limit lives, and where the
    // challenge this number will be verified against is issued.
    if(btn){btn.disabled=true;btn.textContent='Sending...';}
    fetchWT('/api/send-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:lastPhone,dummyMode:dummy})})
      .then(function(res){
        if(res.status===429){showError('Too many OTP requests. Please wait 10 minutes.');reset();abandonOtpScreen();return;}
        return safeJson(res).then(function(data){
          // Refusals the server can be specific about are worth repeating
          // verbatim - "this number isn't whitelisted on our trial account"
          // is one an alternate number runs into far more often than the
          // login number does, and "try again" is useless advice for it.
          if(!res.ok||!data||!data.token){showError((data&&data.error)||'Could not send OTP. Please try again.');reset();abandonOtpScreen();return;}
          _pendingToken=data.token;sessionStorage.setItem('bmc_token',_pendingToken);_otpRequestId++;
          if(opts.sentMsg)showError(opts.sentMsg);
          if(btn){btn.textContent='OTP sent';setTimeout(function(){btn.textContent=orig;btn.disabled=false;},60000);}
        });
      })
      .catch(function(err){showError(err.name==='AbortError'?'Request timed out. Check your signal.':'No connection. Please check your signal.');reset();});
  }
  // The number the alternate-number screens are about to submit. Looked for
  // near the button first - the dashboard renders its edit field as a sibling,
  // and both screens use a 10-digit tel input, which nothing else on those
  // screens does (card fields are 4).
  function findAltPhoneInput(btn){
    var sel='input[type="tel"][maxlength="10"]',node=btn;
    for(var i=0;i<6&&node;i++){var hit=node.querySelector&&node.querySelector(sel);if(hit)return hit;node=node.parentElement;}
    return document.querySelector('#root '+sel);
  }
  document.addEventListener('click',function(e){
    var btn=e.target.closest('button');if(!btn)return;
    var text=(btn.textContent||'').trim();
    if(text==='Send OTP'){
      // Scoped to #root like the quick-login panel below: the login form's phone
      // field is the only one meant here, and the page now carries other tel
      // inputs outside the app (the Contact us widget). Document order happens
      // to put the app's field first today, so this was not yet wrong - but it
      // should not depend on that.
      var digits=sanitisePhone((document.querySelector('#root input[type="tel"]')||{}).value);
      if(!/^[6-9][0-9]{9}$/.test(digits)){showError('Enter a valid 10-digit Indian mobile number (starting with 6-9).');return;}
      requestOtpFor(digits,btn,{purpose:'login'});
    }
    // The alternate-number screens - "Save & verify alternate number" at the
    // end of registration, "Save & verify" on the dashboard - ask the app for
    // an OTP directly, and its requestOtp only switches to the OTP screen. No
    // "Send OTP" button is ever clicked, so nothing above ran: the screen
    // announced a code that was never sent, and Verify OTP then refused
    // because there was no challenge token for that number. The alternate
    // number could not be verified at all, which is not cosmetic - a verified
    // alternate is what lets that number reach the account.
    if(text==='Save & verify alternate number'||text==='Save & verify'){
      var altInput=findAltPhoneInput(btn);
      var altDigits=sanitisePhone(altInput&&altInput.value);
      // A bad number is the app's own error to report - it validates the same
      // way and stays put - so don't send, and don't interfere either.
      if(!/^[6-9][0-9]{9}$/.test(altDigits))return;
      requestOtpFor(altDigits,null,{purpose:'altPhone'});
    }
    if(text==='Verify OTP'){
      if(_allowVerify){_allowVerify=false;return;}
      e.stopImmediatePropagation();e.preventDefault();
      var otpInput=document.querySelector('input[maxlength="6"][type="tel"]')||document.querySelector('input[maxlength="6"]')||document.querySelector('input[inputmode="numeric"][maxlength]');
      var entered=((otpInput&&otpInput.value)||'').replace(/[^0-9]/g,'');
      if(!/^[0-9]{4,6}$/.test(entered)){showError('Enter the OTP sent to your phone.');return;}
      var dummy2=getDummyMode();
      // Verification always goes through the server now, dummy mode included.
      // The old client-side shortcut skipped the API entirely, so it never
      // received the signed phoneToken that proves this number was verified.
      // #root-scoped for the same reason as the Send OTP branch above.
      if(!lastPhone){var d2=sanitisePhone((document.querySelector('#root input[type="tel"]')||{}).value);if(/^[6-9][0-9]{9}$/.test(d2))lastPhone='+91'+d2;}
      if(!_pendingToken){showError('OTP was not sent — please tap Send OTP first.');return;}
      // No client-side verdict on the code. The banner is a local admin
      // toggle; the server is the only thing that knows whether this
      // deployment is really in dummy mode, and announcing "the code is 1234"
      // from here was wrong whenever the two disagreed.
      hideError();btn.disabled=true;var orig2=btn.textContent;btn.textContent='Verifying...';
      fetchWT('/api/verify-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:lastPhone,otp:entered,token:_pendingToken,dummyMode:dummy2})})
        .then(function(res){if(res.status===429){showError('Too many attempts.');btn.disabled=false;btn.textContent=orig2;return;}return safeJson(res).then(function(data){if(res.ok&&data&&data.success){
          // The stored token stands for "this session's own number". Verifying
          // an alternate contact proves a different number entirely, so it must
          // not overwrite that - otherwise the rest of the session would go on
          // identifying itself as the family member whose number was just added.
          if(data.phoneToken&&_otpPurpose!=='altPhone')sessionStorage.setItem('bmc_phone_token',data.phoneToken);sessionStorage.removeItem('bmc_token');sessionStorage.removeItem('bmc_phone');_pendingToken=null;_otpValue=entered;_allowVerify=true;removeResendButton();
          // The toast is the only place a failed attempt is reported, and it
          // lingers for ten seconds. Without this, a user who mistypes once
          // and then gets it right lands on the dashboard still being told
          // the OTP was wrong.
          hideError();btn.disabled=false;btn.textContent=orig2;btn.click();}else{showError((data&&data.error)||'Server error.');btn.disabled=false;btn.textContent=orig2;}});})
        .catch(function(err){showError(err.name==='AbortError'?'Timed out.':'Verification failed.');btn.disabled=false;btn.textContent=orig2;});
    }
  },true);

  var _quickLoginInjected=false;
  // The login screen, and nothing else. "A tel input exists" was the old test,
  // which is also true of the registration contact screen and the dashboard's
  // alternate-number editor - so the panel appeared there too, and because it
  // anchors itself to the nearest <section> it landed above the header. The
  // "Send OTP" button belongs to the login form alone.
  function isLoginScreen(){
    // Matches the in-flight labels too - this file relabels the button to
    // "Sending..." / "OTP sent" for a minute after a click, and the panel
    // should not blink out of existence while that is showing.
    return [].slice.call(document.querySelectorAll('#root button')).some(function(b){
      var t=b.textContent.trim();return t==='Send OTP'||t==='Sending...'||t==='OTP sent';
    });
  }
  function injectQuickLogin(){
    var phoneInput=document.querySelector('#root input[type="tel"]');
    var otpInput=document.querySelector('#root input[maxlength="6"]');
    if(!phoneInput||otpInput||!isLoginScreen()){
      _quickLoginInjected=false;
      var stale=document.getElementById('bmc-quick-login');if(stale)stale.remove();
      return;
    }
    if(document.getElementById('bmc-quick-login'))return;
    window.storage.get('cbp:users').then(function(result){
      // The read is async; the screen may have moved on while it was in flight.
      if(!isLoginScreen()||document.getElementById('bmc-quick-login'))return;
      if(!result||!result.value)return;
      var users;try{users=JSON.parse(result.value);}catch(e){return;}
      var accounts=Object.values(users).filter(function(u){return u.paid&&u.saved&&u.phone&&u.cards&&u.cards.length>0;});
      if(!accounts.length)return;
      var panel=document.createElement('div');panel.id='bmc-quick-login';
      panel.style.cssText='margin-top:1rem;border-top:1px solid #e2e8f0;padding-top:1rem;';
      var lbl=document.createElement('p');
      lbl.style.cssText='font-size:.75rem;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem;';
      lbl.textContent='Quick login';panel.appendChild(lbl);
      accounts.forEach(function(u){
        var masked=u.phone.slice(0,2)+'••••••'+u.phone.slice(-2);
        var display=(u.name?u.name+'  ·  ':'')+masked+'  ·  '+u.cards.length+(u.cards.length===1?' card':' cards');
        var btn=document.createElement('button');btn.type='button';
        btn.style.cssText='display:flex;align-items:center;width:100%;text-align:left;padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:.5rem;margin-bottom:.375rem;background:#fff;cursor:pointer;font-family:ui-sans-serif,system-ui,sans-serif;gap:.5rem;';
        btn.onmouseenter=function(){btn.style.borderColor='#94a3b8';btn.style.background='#f8fafc';};
        btn.onmouseleave=function(){btn.style.borderColor='#e2e8f0';btn.style.background='#fff';};
        var icon=document.createElement('span');icon.textContent='⚡';icon.style.cssText='font-size:.9rem;flex-shrink:0;opacity:.5;';btn.appendChild(icon);
        var txt=document.createElement('span');txt.style.cssText='font-size:.8125rem;color:#0f172a;line-height:1.4;';txt.textContent=display;btn.appendChild(txt);
        btn.onclick=function(ev){
          ev.stopPropagation();
          var nSet=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
          if(nSet&&nSet.set){nSet.set.call(phoneInput,u.phone);}else{phoneInput.value=u.phone;}
          phoneInput.dispatchEvent(new Event('input',{bubbles:true}));
          phoneInput.scrollIntoView({block:'center'});phoneInput.focus();
        };
        panel.appendChild(btn);
      });
      var sec=phoneInput;while(sec&&sec.tagName!=='SECTION'){sec=sec.parentElement;}
      if(sec&&sec.parentElement){sec.parentElement.insertBefore(panel,sec.nextSibling);_quickLoginInjected=true;}
    }).catch(function(){});
  }
  setInterval(injectQuickLogin,700);
})();
