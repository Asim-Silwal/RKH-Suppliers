// Uses mocked push APIs; never sends notifications to real devices.
const { chromium } = require(process.argv[2]);
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
  const token=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.test`;
  const session={access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
  const actions=[];let failSend=true;const roles=[{role_key:'admin',name:'Admin',permissions:['ledger_view','reports_view'],is_system:true}];
  await context.route('https://**.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body; let status=200;
   if(path==='/auth/v1/user') body=user;
   else if(path==='/auth/v1/token') body=session;
   else if(path==='/auth/v1/logout') body={};
   else if(path==='/rest/v1/profiles') body={role:'admin',full_name:'Test owner',contact:'',avatar_path:null};
   else if(path==='/rest/v1/app_roles') body=route.request().headers().accept?.includes('object')?roles[0]:roles;
   else if(path==='/rest/v1/rpc/is_app_owner') body=true;
   else if(path==='/rest/v1/rpc/list_app_users') body=[{user_id:user.id,email:user.email,full_name:'Test owner',role_key:'admin',created_at:'2026-09-01'}];
   else if(path==='/rest/v1/notification_inbox') {const activity=new URL(route.request().url()).searchParams.get('category')==='eq.activity';body=route.request().method()==='PATCH'?{}:[{event_id:activity?'00000000-0000-4000-8000-000000000003':'00000000-0000-4000-8000-000000000002',category:activity?'activity':'admin',title:activity?'Party Added':'Team reminder',body:activity?'New party "Test party" added by Test owner.':'Admin announcement',created_at:'2026-10-14T10:00:00Z',read_at:null}];}
   else if(path==='/rest/v1/parties'||path==='/rest/v1/transactions') body=[];
   else if(path==='/functions/v1/notifications') {
    const input=route.request().postDataJSON();actions.push(input);
    if(input.action==='config') body={publicKey:'B'+'a'.repeat(86)};
    else if(input.action==='history') body={history:[]};
    else if(input.action==='send') {await new Promise(r=>setTimeout(r,250));if(failSend){status=500;body={error:'Temporary send failure'};failSend=false;}else body={status:'complete',accepted:1,failed:0,expired:0};}
    else body={ok:true};
   } else throw Error('Unmocked '+path);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await context.addInitScript(session=>{
   localStorage.setItem('sb-yyuilpixyrvmzxgyehme-auth-token',JSON.stringify(session));
   let subscription=null;window.testUnsubscribes=0;
   const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{subscription={endpoint:'https://fcm.googleapis.com/test',toJSON:()=>({endpoint:'https://fcm.googleapis.com/test',keys:{p256dh:'a'.repeat(87),auth:'a'.repeat(22)}}),unsubscribe:async()=>{window.testUnsubscribes++;subscription=null;return true;}};return subscription;}}};
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async(url)=>{if(url!=='/__mockup/sw.js')throw Error('Wrong service worker path: '+url);return registration;},ready:Promise.resolve(registration),getRegistration:async()=>registration}});
   Object.defineProperty(window,'PushManager',{value:function(){}});
   Object.defineProperty(window,'Notification',{value:{permission:'default',requestPermission:async()=>{window.Notification.permission='granted';return 'granted';}}});
  },session);
  await page.goto('http://localhost:5173/__mockup/');
  await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  const openSettings=async()=>{await page.getByRole('button',{name:'Open notifications',exact:true}).click();await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();await page.getByText('Admin announcement',{exact:true}).waitFor();await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.getByText('New party "Test party" added by Test owner.',{exact:true}).waitFor();await page.getByRole('button',{name:'Mark all read',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.inbox-item.unread').length===0);await page.getByRole('button',{name:'Notification settings',exact:true}).click();};
  await openSettings();await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
  await page.getByText('Enabled on this device',{exact:true}).waitFor();
  assert.equal(actions.filter(a=>a.action==='subscribe').length,1);
  await page.getByRole('button',{name:'Turn off notifications'}).click();await page.getByText('Off on this device',{exact:true}).waitFor();
  assert.equal(actions.filter(a=>a.action==='unsubscribe').length,1);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await page.getByText('Enabled on this device',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close notifications'}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.reference-sidebar').count(),0,'Inbox covers bottom navigation');
  const inboxBox=await page.locator('.notification-screen').boundingBox();assert.equal(inboxBox.width,390);
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'rkh-inbox-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Go back',exact:true}).click();
  await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Send notifications',exact:true}).first().click();
  await page.getByRole('heading',{name:'Send notifications',exact:true}).waitFor();
  assert.match(page.url(),/\/notifications$/);
  await page.getByLabel('Title',{exact:true}).fill('Team update');await page.getByLabel('Message',{exact:false}).fill('Please review today’s entries.');
  await page.locator('form.notification-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await page.getByRole('alert').filter({hasText:'Temporary send failure'}).waitFor();
  assert.equal(actions.filter(a=>a.action==='send').length,1);
  await page.getByRole('button',{name:'Send notification',exact:true}).click();await page.getByRole('status').filter({hasText:'1 device(s) accepted'}).waitFor();
  const sends=actions.filter(a=>a.action==='send');assert.equal(sends[0].id,sends[1].id,'Retry keeps idempotency key');
  await page.setViewportSize({width:390,height:844});
  const bell=await page.getByRole('button',{name:'Open notifications',exact:true}).boundingBox();
  const profile=await page.getByRole('button',{name:'Open profile and more sections'}).boundingBox();
  assert.ok(bell.x+bell.width<=profile.x && Math.abs(bell.y-profile.y)<5,'Bell is beside profile');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile page fits viewport');
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'rkh-notification-mobile-test.png'),fullPage:true});
  await page.getByRole('button',{name:'Open profile and more sections'}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.waitForFunction(()=>window.testUnsubscribes===2);
  assert.deepEqual(errors,[]);
  console.log('PASS: full-screen inbox, Admin/Activity tabs, read state, mobile back, enable/disable, owner sender, duplicate submit, retry identity, sign-out unsubscribe.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
