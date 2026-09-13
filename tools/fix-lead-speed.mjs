import fs from "node:fs";

const intakePath = "lib/lead-intake.ts";
const apiPath = "netlify/functions/manager-api.mts";
const managerPath = "manager/manager.js";

const intake = fs.readFileSync(intakePath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const manager = fs.readFileSync(managerPath, "utf8");

const statusLine = '      status: LEAD_STATUS_VALUES.includes(draft.status || "") ? (draft.status as string) : "new",';
if (!intake.includes(statusLine)) throw new Error("Lead status insertion point changed");
if (intake.includes("nextFollowUpAt: submittedAt,")) throw new Error("Immediate lead follow-up is already in source; remove this build patch");
const nextIntake = intake.replace(statusLine, `${statusLine}\n      // New inbound leads enter the Call Now queue immediately.\n      nextFollowUpAt: submittedAt,`);

const oldWait = '  const wait = row.status === "new" ? 15 * 60 * 1000 : row.status === "contacted" ? 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;';
const newWait = '  const wait = row.status === "new" ? 5 * 60 * 1000 : row.status === "contacted" ? 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;';
if (!api.includes(oldWait)) throw new Error("Lead attention fallback changed");
const nextApi = api.replace(oldWait, newWait);

const oldPill = '    if (l.attention === "due") return \'<span class="pill follow-due">Due now</span>\';';
const newPill = '    if (l.attention === "due") return \'<span class="pill follow-due">\' + (l.status === "new" ? "Call now" : "Due now") + "</span>";';
if (!manager.includes(oldPill)) throw new Error("Follow-up pill changed");
const nextManager = manager.replace(oldPill, newPill);

fs.writeFileSync(intakePath, nextIntake);
fs.writeFileSync(apiPath, nextApi);
fs.writeFileSync(managerPath, nextManager);
console.log("Lead speed patch applied: immediate Call Now queue + 5-minute legacy fallback");
