// The rules behind the Grow section: who may be marketed to, how an audience is
// described, and what a promotional message actually says.
//
// Everything in this file is deliberately free of database and network access,
// so the rules can be read — and tested — on their own. The queries that use
// these fragments live in lib/marketing-store.ts and the routes that call them
// in lib/marketing-routes.ts.
//
// The one rule the rest of the system is built around: a promotional message is
// only ever sent to somebody the database can show gave permission for it, and
// never to somebody who has asked to stop. Consent is per channel, because a
// text message and an email are not the same promise.
import crypto from "node:crypto";

export const BUSINESS_NAME = "DCA Cleaning Solutions";
export const BUSINESS_PHONE = "(470) 485-3123";

export type MarketingChannel = "sms" | "email";
export const MARKETING_CHANNELS: MarketingChannel[] = ["sms", "email"];
