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
  if (!source.includes(replacement.from)) throw new Error(`New-lead alert patch target missing: ${replacement.from}`);
  source = source.replace(replacement.from, replacement.to);
}

const marker = '  // The optional promotional-text box, if the customer ticked it. Deliberately\n';
if (!source.includes(marker)) throw new Error("New-lead alert insertion marker missing");

const alertBlock = [
  '  // Alert the office immediately after a fresh lead is safely stored.',
  '  // Messaging failure is isolated so intake can never lose the request.',
  '  try {',
  '    const contact = phone || email || "No phone/email provided";',
  '    const service = draft.service || draft.promotionName || "Service not specified";',
  '    const campaign = draft.campaign ? " / " + draft.campaign : "";',
  '    const officeBody = [',
  '      "NEW DCA LEAD — CALL NOW",',
  '      name,',
  '      contact,',
  '      "Service: " + service,',
  '      "Source: " + leadSourceLabel(source) + campaign,',
  '      "Lead #" + lead.id',
  '    ].join("\\n");',
  '    const alert = await sendSms({ to: SHACOLE_NUMBER, body: officeBody });',
  '    await db.insert(notifications).values({',
  '      customerId: customer?.id ?? null,',
  '      kind: "lead_alert",',
  '      channel: "sms",',
  '      recipient: SHACOLE_NUMBER,',
  '      body: officeBody,',
  '      status: alert.ok ? "sent" : "failed",',
  '      provider: alert.provider,',
  '      providerRef: alert.providerRef,',
  '      error: alert.error',
  '    });',
  '  } catch (error) {',
  '    console.error("New lead office alert failed", error);',
  '  }',
  '',
].join("\n") + "\n";

source = source.replace(marker, alertBlock + marker);
fs.writeFileSync(path, source);
console.log("Applied real-time new-lead office alert patch");
