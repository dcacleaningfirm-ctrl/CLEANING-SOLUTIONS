import { createHmac, randomUUID } from "node:crypto";

export const OFFICE_CLIENT = "dca-office";
export const TEST_PHONE = "+14706228962";

export function phoneConfiguration() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const keySid = process.env.TWILIO_VOICE_API_KEY_SID?.trim();
  const secret = process.env.TWILIO_VOICE_API_KEY_SECRET?.trim();
  if (!accountSid || !keySid || !secret || process.env.DCA_BROWSER_PHONE !== "true") return null;
  return { accountSid, keySid, secret };
}

export function officePhoneToken(config: NonNullable<ReturnType<typeof phoneConfiguration>>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(Date.now() / 1000);
  const header = encode({ typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
  const claims = encode({
    jti: `${config.keySid}-${randomUUID()}`,
    iss: config.keySid,
    sub: config.accountSid,
    iat: issued,
    exp: issued + 600,
    grants: { identity: OFFICE_CLIENT, voice: { incoming: { allow: true } } }
  });
  const signature = createHmac("sha256", config.secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}
