import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { commercialOnboardingWorkspace as table } from "../db/schema.js";
import { loadInitialVendors } from "./vendor-onboarding-seed.js";

type Actor = { id: number; name: string; role: string };
type RecordData = Record<string, any>;
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {"Cache-Control":"no-store"}});
export function canOnboard(actor: Actor) {
  return actor.role === "owner" || (["admin","manager","management_specialist"].includes(actor.role) && /^shacole(?:\s|$)/i.test(actor.name.trim()));
}
const stages = ["Not submitted","In progress","Awaiting reply","Approved","Paused","Verify status","Declined"];
const fields = ["name","group","contact","phone","email","service","coverage","stage","submitted","status","requirements","missing","reviewer","owner","action","date","response","decision"];
const docs = ["W-9","COI","Business license","Auto-liability proof","Workers’ compensation proof","Direct-deposit forms","Current vendor package PDF"];
const text = (val: unknown) => typeof val === "string" ? val.trim().slice(0,12000) : "";

export async function vendorOnboarding(req: Request, actor: Actor) {
  if (!canOnboard(actor)) return json({error:"Access denied"},403);
  const james = actor.role === "owner" && /^james(?:\s|$)/i.test(actor.name.trim());
  const read = () => db.select().from(table).where(eq(table.id,1));
  let [row] = await read();
  if (!row) {
    await db.insert(table).values({id:1,vendors:loadInitialVendors(),drafts:[]}).onConflictDoNothing();
    [row] = await read();
  }
  const vendors = row.vendors as RecordData[], drafts = row.drafts as RecordData[];
  const view = (rev:number) => json({vendors,drafts,rev,james});
  if (req.method === "GET") return view(row.revision);
  if (req.method !== "POST" || req.headers.get("origin") !== new URL(req.url).origin) return json({error:"Invalid request"},403);
  const p = await req.json().catch(()=>null);
  if (!p || p.rev !== row.revision) return json({error:"The workspace changed. Reload before saving."},409);
  const data = p.data || {};
  if (p.mode === "vendor") {
    if (!text(data.name) || !text(data.id) || !stages.includes(data.stage)) return json({error:"Check vendor name and stage."},400);
    const v: RecordData = Object.fromEntries(fields.map(k=>[k,text(data[k])]));
    v.id = text(data.id); v.follow = data.follow === true;
    v.docs = Object.fromEntries(docs.map(k=>[k,text(data.docs?.[k])||"Unverified"]));
    const index = vendors.findIndex(x=>x.id===v.id);
    if(index<0) vendors.unshift(v); else vendors[index]=v;
  } else if(p.mode === "draft") {
    const draft = Object.fromEntries(["vendor","type","recipient","body","attachments"].map(k=>[k,text(data[k])]));
    if(!draft.recipient || !draft.body || !vendors.some(v=>v.name===draft.vendor) || !["Email","Quote","Document","Application"].includes(draft.type)) return json({error:"Check vendor, destination and content."},400);
    drafts.unshift({...draft,id:crypto.randomUUID(),status:"Pending review",createdBy:actor.id});
  } else if(p.mode === "decision") {
    const draft = drafts.find(d=>d.id===p.id);
    if(!draft) return json({error:"Unknown draft"},404);
    if(draft.status==="Approved" && p.decision==="Delivered") {
      draft.status="Delivered"; draft.deliveredBy=actor.id; draft.deliveredAt=new Date().toISOString();
    } else if(james && draft.status==="Pending review" && ["Approved","Returned"].includes(p.decision)) {
      draft.status=p.decision; draft.by=actor.name; draft.reviewerId=actor.id; draft.time=new Date().toISOString();
    } else return json({error:"This action requires James’s approval."},403);
  } else return json({error:"Unknown action"},400);
  const updated = await db.update(table).set({revision:row.revision+1,vendors,drafts})
    .where(and(eq(table.id,1),eq(table.revision,row.revision))).returning({id:table.id});
  return updated.length ? view(row.revision+1) : json({error:"Another edit was saved first. Reload before saving."},409);
}
