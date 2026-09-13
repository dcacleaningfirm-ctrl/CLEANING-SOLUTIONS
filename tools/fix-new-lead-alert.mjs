import fs from "node:fs";

const path = "lib/lead-intake.ts";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  {
    from: '  leadEvents,\n  leads\n} from "../db/schema.js";',
    to: '  leadEvents,\n  leads,\n  notifications\n} from "../db/schema.js";'
  },
  {
    from: 'import { looksLikeEmail, normalizePhone } from "./notify.js";',
    to: 'import { looksLikeEmail, normalizePhone, sendSms } from "./notify.js";\nimport { SHACOLE_NUMBER } from "./voice-agent.js";'
  }
];

for (const replacement of replacements) {
  if (!source.includes(replacement.from)) {
    throw new Error(`New-lead alert patch target missing: ${replacement.from}`);
  }
  source = source.replace(replacement.from, replacement.to);
}

const marker = '  // The optional promotional-text box, if the customer ticked it. Deliberately\n';
if (!source.includes(marker)) throw new Error("New-lead alert insertion marker missing");

const alertBlock = `  // A fresh request is money-sensitive: alert the office immediately instead of\n  // relying on somebody already having DCA Pro open. A messaging failure must\n  // never block intake, so the lead is saved first and the alert is best-effort.\n  try {\n    const contact = phone || email || "No phone/email provided";\n    const service = draft.service || draft.promotionName || "Service not specified";\n    const campaign = draft.campaign ? \\` / \\${draft.campaign}\\` : "";\n    const officeBody = [\n      "NEW DCA LEAD — CALL NOW",\n      name,\n      contact,\n      \\`Service: \\${service}\\`,\n      \\`Source: \\${leadSourceLabel(source)}\\${campaign}\\`,\n      \\`Lead #\\${lead.id}\\`\n    ].join("\\n");\n    const alert = await sendSms({ to: SHACOLE_NUMBER, body: officeBody });\n    await db.insert(notifications).values({\n      customerId: customer?.id ?? null,\n      kind: "lead_alert",\n      channel: "sms",\n      recipient: SHACOLE_NUMBER,\n      body: officeBody,\n      status: alert.ok ? "sent" : "failed",\n      provider: alert.provider,\n      providerRef: alert.providerRef,\n      error: alert.error\n    });\n  } catch (error) {\n    console.error("New lead office alert failed", error);\n  }\n\n`;

source = source.replace(marker, alertBlock + marker);
fs.writeFileSync(path, source);
console.log("Applied real-time new-lead office alert patch");
