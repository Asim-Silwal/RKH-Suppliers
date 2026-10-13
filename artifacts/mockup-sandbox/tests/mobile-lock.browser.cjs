// Run: node tests/mobile-lock.browser.cjs <path-to-playwright-module>
const { chromium, devices } = require(process.argv[2]);
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge', headless:true});
 try {
 const context = await browser.newContext({...devices['iPhone 13'], defaultBrowserType:undefined});
 const page = await context.newPage();
 page.setDefaultTimeout(12000);
 const errors=[]; page.on('pageerror', error=>errors.push(error.message));
 const user={id:'00000000-0000-4000-8000-000000000001',email:'lock-test@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
 const token=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.test`;
 const session={access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
 let ledgerReads=0; let partyWrites=0; let transactionWrites=0; const parties=[]; const transactions=[];
 await context.route('https://**.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body;
  if(path==='/auth/v1/token') body=session;
  else if(path==='/auth/v1/user') body=user;
  else if(path==='/rest/v1/profiles') body={role:'admin',full_name:'Test owner',contact:'',avatar_path:null};
  else if(path==='/rest/v1/app_roles') body={name:'Admin',permissions:['ledger_view','parties_write','transactions_write','reports_view']};
  else if(path==='/rest/v1/rpc/is_app_owner') body=true;
  else if(path==='/rest/v1/parties'||path==='/rest/v1/transactions') {
   if(route.request().method()==='POST') {
    await new Promise(resolve=>setTimeout(resolve,500));
    if(path.endsWith('/parties')) {partyWrites++;body={...route.request().postDataJSON(),id:'test-party'};parties.push(body);}
    else {transactionWrites++;body=route.request().postDataJSON().map((row,index)=>({...row,id:'test-transaction-'+index}));transactions.push(...body);}
   } else {ledgerReads++;body=path.endsWith('/parties')?parties:transactions;}
  }
  else throw Error(`Unmocked API route: ${path}`);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await context.addInitScript(session=>{
  localStorage.setItem('sb-yyuilpixyrvmzxgyehme-auth-token',JSON.stringify(session));
 },session);
 const cdp=await context.newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await page.goto('http://localhost:5173/__mockup/');
 await page.getByRole('heading',{name:'Protect this device'}).waitFor();
 assert.equal(ledgerReads,0,'No ledger is fetched before initial unlock');
 await page.getByLabel('Account password').fill('test-password-only');
 await page.getByRole('button',{name:'Verify password',exact:true}).click();
 await page.getByRole('button',{name:'Enable Face ID / passcode',exact:true}).click();
 await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor().catch(async error=>{console.log(await page.locator('body').innerText()); console.log(errors); throw error;});
 assert.equal(ledgerReads,2);
 // Lock immediately on backgrounding, including any body-level portals.
 await page.evaluate(()=>{
  const portal=document.createElement('div');portal.id='privacy-test-portal';portal.textContent='Sensitive dialog';document.body.append(portal);
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await page.getByRole('heading',{name:'Your ledger is locked'}).waitFor();
 assert.equal(await page.locator('#privacy-test-portal').isVisible(),false);
 assert.equal(await page.locator('#root').isVisible(),false);
 await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}));
 await page.getByRole('button',{name:'Unlock with Face ID / passcode',exact:true}).click();
 await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 assert.equal(ledgerReads,2,'Unlock preserves loaded ledger without refetch');
 await page.reload();
 await page.getByRole('heading',{name:'Your ledger is locked'}).waitFor();
 assert.equal(ledgerReads,2,'Reload remains locked before fetching ledger');
 await page.getByRole('button',{name:'Unlock with Face ID / passcode',exact:true}).click();
 await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('rkh-lock')));
 await page.getByRole('button',{name:'Use account password instead'}).click();
 await page.getByLabel('Account password').fill('test-password-only');
 await page.getByRole('button',{name:'Verify password',exact:true}).click();
 await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 await page.getByRole('button',{name:'Parties',exact:true}).click();
 await page.getByRole('button',{name:'Add party',exact:true}).click();
 await page.getByLabel('Party name *',{exact:true}).fill('Mobile test party');
 await page.locator('form.party-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await page.getByRole('heading',{name:'Parties',exact:true}).waitFor();
 assert.equal(partyWrites,1,'Repeated submit creates only one party');
 await page.getByRole('button',{name:'Add transaction',exact:true}).click();
 await page.locator('#entry-party-search').fill('Mobile test party');
 await page.getByRole('option').filter({hasText:'Mobile test party'}).click();
 await page.getByPlaceholder('0.00',{exact:true}).first().fill('125');
 await page.locator('form.transaction-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await page.getByRole('heading',{name:'Statement',exact:true}).waitFor();
 assert.equal(transactionWrites,1,'Repeated submit creates only one transaction');
 assert.deepEqual(errors,[]);
 console.log('PASS: enrollment, password verification, background privacy, passkey unlock, reload lock, no-refetch unlock, password recovery, confirmed saves, duplicate-submit prevention.');
 await context.close();
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
