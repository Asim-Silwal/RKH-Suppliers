import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { validEndpoint, validId, validSubscription } from "../../../supabase/functions/notifications/validation.ts";

test("push endpoint validation rejects arbitrary URLs and SSRF targets", () => {
  for (const url of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://example.com/x", "https://fcm.googleapis.com.evil.test/x", "https://user:pass@web.push.apple.com/x", "https://web.push.apple.com:444/x", "file:///tmp/a"]) assert.equal(validEndpoint(url), false, url);
  for (const url of ["https://web.push.apple.com/abc", "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc"]) assert.equal(validEndpoint(url), true);
  assert.equal(validSubscription({endpoint:"https://fcm.googleapis.com/x",keys:{p256dh:"x".repeat(87),auth:"x".repeat(22)}}),true);
  assert.equal(validSubscription({endpoint:"https://fcm.googleapis.com/x",keys:{p256dh:"wrong",auth:"wrong"}}),false);
});

function harness({owner = true, authenticated = true, previous = null, count = 0, outcomes = [201,410,500]}: any = {}) {
  let handler: any; const writes: any[] = []; const deliveries: any[] = [];
  const admin = { auth: { getUser: async () => ({data:{user:authenticated ? {id:"owner-id"} : null},error:null}) }, from(table: string) {
    let operation = "select", value: any, filters: any[] = [], head = false;
    const query: any = {
      select(_fields: any, options: any) { head = options?.head; return query; },
      eq(...args: any[]) { filters.push(args); return query; }, gte() { return query; },
      limit() { return query; }, order() { return query; },
      maybeSingle() { return query; }, single() { return query; },
      insert(data: any) { operation="insert"; value=data; return query; },
      update(data: any) { operation="update"; value=data; return query; },
      upsert(data: any) { operation="upsert"; value=data; return query; },
      delete() { operation="delete"; return query; },
      then(resolve: any) {
        if(operation !== "select") { writes.push({table,operation,value,filters}); return Promise.resolve({error:null}).then(resolve); }
        let data: any = null;
        if(table === "notification_vapid") data={public_key:"public",private_key:"private"};
        if(table === "app_owner") data=owner ? {user_id:"owner-id"} : null;
        if(table === "notification_sends") data=previous;
        if(table === "push_subscriptions") data=outcomes.map((_:any,i:number)=>({endpoint:`https://fcm.googleapis.com/${i}`,p256dh:"key",auth:"auth"}));
        return Promise.resolve({data,error:null,count:head?count:null}).then(resolve);
      },
    }; return query;
  }};
  const source = readFileSync(new URL("../../../supabase/functions/notifications/index.ts",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(stripTypeScriptTypes(source), { createClient:()=>admin, validEndpoint,validId,validSubscription, Response,JSON,Date,Promise,console,
    Deno:{env:{get:()=>"test"},serve:(fn:any)=>handler=fn},
    webpush:{sendNotification:async (sub:any,payload:any)=>{ deliveries.push({sub,payload}); const statusCode=outcomes[Number(sub.endpoint.split('/').pop())]; if(statusCode!==201) throw {statusCode}; }},
  });
  return {writes, deliveries, call:async(body:any, token=true)=>handler(new Request("https://test/notifications",{method:"POST",headers:token?{Authorization:"Bearer test"}:{},body:JSON.stringify(body)}))};
}
const message={action:"send",id:"11111111-1111-4111-8111-111111111111",recipient:"all",title:"Reminder",body:"Test message"};
test("service worker shows branded push and focuses the app without arbitrary navigation",async()=>{
  const handlers: any={};const shown: any[]=[];let focused=false;
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,self:{
    addEventListener:(name:string,fn:any)=>handlers[name]=fn,
    registration:{scope:'https://example.com/app/',showNotification:async(...args:any[])=>shown.push(args)},
    clients:{matchAll:async()=>[{url:'https://example.com/app/parties',navigate:async(url:string)=>{assert.equal(url,'https://example.com/app/inbox');},focus:async()=>{focused=true;}}]},
  }});
  let pending: any;
  handlers.push({data:{json:()=>({title:'Update',body:'Message',id:'test'})},waitUntil:(p:any)=>pending=p});await pending;
  assert.equal(shown[0][1].icon,'https://example.com/app/brand/icon-192.png');
  handlers.notificationclick({notification:{close(){},data:{url:'https://evil.test'}},waitUntil:(p:any)=>pending=p});await pending;assert.equal(focused,true);
});
test("backend rejects unsigned and non-owner sends", async()=>{
  const unsigned=harness(); assert.equal((await unsigned.call(message,false)).status,401);
  const denied=harness({owner:false}); assert.equal((await denied.call(message)).status,403); assert.equal(denied.deliveries.length,0);
  const expired=harness({authenticated:false}); assert.equal((await expired.call(message)).status,401);
});
test("config exposes only public key and subscriptions bind to verified user",async()=>{
  const h=harness(); const config=await (await h.call({action:"config"})).json(); assert.deepEqual(config,{publicKey:"public"});
  await h.call({action:"subscribe",user_id:"attacker",subscription:{endpoint:"https://fcm.googleapis.com/test",keys:{p256dh:"x".repeat(87),auth:"x".repeat(22)}}});
  assert.equal(h.writes[0].value.user_id,"owner-id");
});
test("send reports accepted, failed and expired devices and removes expired subscriptions",async()=>{
  const h=harness(); const response=await h.call(message); assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:"complete",accepted:1,failed:1,expired:1});
  assert.equal(h.deliveries.length,3);
  assert.equal(h.writes.filter(w=>w.operation==="delete").length,1);
});
test("retry does not resend and rate limit and no-device states are explicit",async()=>{
  const duplicate=harness({previous:{status:"complete",accepted:3}}); await duplicate.call(message); assert.equal(duplicate.deliveries.length,0);
  const limited=harness({count:5}); assert.equal((await limited.call(message)).status,429);
  const empty=harness({outcomes:[]}); assert.equal((await empty.call(message)).status,200); assert.ok(empty.writes.some(w=>w.table==='notification_sends' && w.operation==='insert'),'Save inbox message even without push devices');
  const invalid=harness(); assert.equal((await invalid.call({...message,title:""})).status,400);
});
