type Gate = (req: Request, key: string) => Promise<Response | null>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const keys = /^(gclid|wbraid|gbraid|fbclid|msclkid|utm_source|utm_medium|utm_campaign|utm_content|utm_term)$/;
export async function handleUpgrade(req: Request, gate: Gate): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "Invalid request origin" }, 403);
  let b: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 12000) return json({ error: "Application is too long." }, 413);
    b = JSON.parse(raw);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
  } catch { return json({ error: "Invalid application." }, 400); }
  const field = (key: string, max: number) => typeof b[key] === "string" && (b[key] as string).length <= max ? (b[key] as string).trim() : "";
  const name = field("name",100), company = field("company",160), email = field("email",254);
  const phone = field("phone",30), message = field("message",2000), submissionId = field("submissionId",80);
  if (b.fax || typeof b.startedAt !== "number" || Date.now() - b.startedAt < 1500)
    return json({ error: "Please wait a moment, then try again." },400);
  if (!name || !company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+0-9() .-]{6,30}$/.test(phone) || phone.replace(/\D/g,"").length < 6)
    return json({ error: "Please enter your name, business name, valid email and phone number." },400);
  if (typeof b.message !== "string" || b.message.length > 2000 || !/^[a-zA-Z0-9-]{16,80}$/.test(submissionId))
    return json({ error: "Please refresh this page and try again." },400);
  let website: string;
  try {
    const input = field("website",300);
    const url = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
    if (!["http:","https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) throw new Error();
    website = url.href;
  } catch { return json({ error: "Please enter a valid website address." },400); }
  const blocked = await gate(req, "website-upgrade"); if (blocked) return blocked;
  const attribution = b.attribution && typeof b.attribution === "object" && !Array.isArray(b.attribution)
    ? Object.entries(b.attribution).filter(([k,v]) => keys.test(k) && typeof v === "string")
      .map(([k,v]) => [k,String(v).slice(0,512)] as [string,string]) : [];
  const rows = [["Name",name],["Business",company],["Email",email],["Phone",phone],["Website",website],
    ["What they want to improve",message || "Not supplied"],["Application ID",submissionId],...attribution];
  const html = "<h2>Free Website Upgrade application</h2><p>Submitted from https://zibdigital.com.au/free-website-upgrade</p>" +
    "<table>" + rows.map(([k,v])=>"<tr><th style='text-align:left;vertical-align:top;padding:8px'>"+esc(k)+"</th><td style='padding:8px;white-space:pre-wrap'>"+esc(v)+"</td></tr>").join("")+"</table>";
  const recipients = (process.env.WEBSITE_UPGRADE_NOTIFY_EMAIL || process.env.LEAD_NOTIFY_EMAIL || "").split(",").map(s=>s.trim()).filter(Boolean);
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const apiKey = process.env.RESEND_API_KEY;
  if (!token && (!apiKey || !recipients.length)) return json({ error: "Applications are temporarily unavailable. Please contact Zib directly." },503);
  const post = async (url: string, auth: string, body: unknown, headers: Record<string,string> = {}) => {
    const response = await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+auth,"Content-Type":"application/json",...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("Delivery service returned "+response.status);
    return response.json();
  };
  const emailDelivery = async () => {
    if (!apiKey || !recipients.length) return false;
    const result = await post("https://api.resend.com/emails",apiKey,{
      from:process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev",to:recipients,
      reply_to:email,subject:"Free Website Upgrade application · "+company.replace(/[\r\n]/g," "),
      html,
    },{"Idempotency-Key":"website-upgrade/"+submissionId});
    return typeof result.id === "string" && !!result.id;
  };
  const crmDelivery = async () => {
    if (!token) return false;
    const lookup = async () => {
      const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/"+encodeURIComponent(email)+"?idProperty=email",
        {headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("CRM lookup failed");
      return (await r.json()).id as string;
    };
    let contactId = await lookup();
    if (!contactId) {
      try {
        const result = await post("https://api.hubapi.com/crm/v3/objects/contacts",token,
          {properties:{email,firstname:name,company,phone,website,lifecyclestage:"lead"}});
        contactId = result.id;
      } catch { contactId = await lookup(); }
    }
    if (!contactId) return false;
    const note = await post("https://api.hubapi.com/crm/v3/objects/notes",token,{
      properties:{hs_timestamp:new Date().toISOString(),hs_note_body:html},
      associations:[{to:{id:contactId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:202}]}],
    });
    return typeof note.id === "string" && !!note.id;
  };
  const results = await Promise.allSettled([emailDelivery(),crmDelivery()]);
  const accepted = results.map(r=>r.status === "fulfilled" && r.value === true);
  console.info("[website-upgrade] delivery", {email:accepted[0],crm:accepted[1]});
  if (!accepted.some(Boolean)) return json({ error: "We couldn’t send your application. Please try again or contact Zib directly." },502);
  return json({ok:true});
}
