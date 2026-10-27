import test from "node:test";
import assert from "node:assert/strict";
import { handleUpgrade } from "./websiteUpgrade.ts";
const gate = async()=>null;
const payload = {name:"TEST Application",company:"TEST business",email:"test@example.com",phone:"0400000000",website:"example.com",message:"TEST only",fax:"",startedAt:Date.now()-5000,submissionId:"12345678-1234-1234-1234-123456789abc"};
const req = (body=payload,origin="https://zibdigital.com.au")=>new Request("https://zibdigital.com.au/api/website-upgrade",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)});
test("upgrade submissions", async t=>{
 const oldFetch=globalThis.fetch;
 const envKeys=["RESEND_API_KEY","LEAD_NOTIFY_EMAIL","LEAD_NOTIFY_FROM","HUBSPOT_PRIVATE_APP_TOKEN"];
 const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 try {
  envKeys.forEach(k=>delete process.env[k]);
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Unexpected network request");};
  await t.test("rejects invalid fields without sending",async()=>{assert.equal((await handleUpgrade(req({...payload,email:"bad"}),gate)).status,400);assert.equal(calls,0);});
  await t.test("rejects cross-origin submission",async()=>assert.equal((await handleUpgrade(req(payload,"https://other.example"),gate)).status,403));
  await t.test("rejects honeypot",async()=>assert.equal((await handleUpgrade(req({...payload,fax:"bot"}),gate)).status,400));
  await t.test("does not report success without delivery configuration",async()=>assert.equal((await handleUpgrade(req(),gate)).status,503));
  await t.test("honours rate limiting",async()=>assert.equal((await handleUpgrade(req(),async()=>new Response("",{status:429}))).status,429));
  process.env.RESEND_API_KEY="mock";process.env.LEAD_NOTIFY_EMAIL="inbox@example.com";
  await t.test("fails visibly on email service rejection",async()=>{globalThis.fetch=async()=>new Response("",{status:500});assert.equal((await handleUpgrade(req(),gate)).status,502);});
  await t.test("confirms accepted email and escapes visitor content",async()=>{
   globalThis.fetch=async(url,init)=>{assert.equal(url,"https://api.resend.com/emails");const data=JSON.parse(init.body);assert.ok(data.html.includes("&lt;script&gt;"));assert.equal(data.reply_to,"test@example.com");assert.ok(init.headers["Idempotency-Key"]);return Response.json({id:"email-accepted"});};
   assert.deepEqual(await (await handleUpgrade(req({...payload,message:"<script>"}),gate)).json(),{ok:true});
  });
  await t.test("CRM note provides delivery fallback without overwriting existing contact",async()=>{
   process.env.HUBSPOT_PRIVATE_APP_TOKEN="mock";const visited=[];
   globalThis.fetch=async(url,init)=>{visited.push([String(url),init?.method||"GET"]);if(String(url).includes("resend.com"))return new Response("",{status:500});if(String(url).includes("contacts/"))return Response.json({id:"existing-contact"});return Response.json({id:"saved-note"});};
   assert.deepEqual(await (await handleUpgrade(req(),gate)).json(),{ok:true});assert.equal(visited.filter(([u,m])=>u.includes("/contacts")&&m==="POST").length,0);
  });
 } finally {globalThis.fetch=oldFetch;for(const k of envKeys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});

