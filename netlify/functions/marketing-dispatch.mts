// Drains the marketing send queue.
//
// Sending happens here rather than in the request that pressed Send, because a
// campaign to several thousand people is far longer than one HTTP request. The
// office presses Send, the first batch goes out immediately, and this function
// picks the rest up a batch at a time until the queue is empty. A campaign
// scheduled for 6am on Saturday is started here too, so nobody has to have the
// app open for it to go out.
import type { Config } from "@netlify/functions";
import { attributeBookings } from "../../lib/marketing-store.js";
import { drainQueue, startDueCampaigns } from "../../lib/marketing-dispatch.js";
import { marketingEmailSettings, marketingSmsSettings } from "../../lib/marketing.js";

export default async () => {
  // Nothing is queued and nothing can be sent until the owner has connected a
  // provider and switched bulk sending on, so this exits without touching the
  // database on every run until that day.
  if (!marketingSmsSettings().ready && !marketingEmailSettings().ready) {
    return new Response("Marketing sending is not switched on", { status: 200 });
  }

  try {
    const started = await startDueCampaigns();
    const drained = await drainQueue();
    // Cheap enough to run alongside the send, and it keeps the bookings figure
    // on the campaign history current without anybody opening the screen.
    await attributeBookings();
    console.log(
      `marketing dispatch: ${started} campaigns started, ${drained.sent} sent, ${drained.failed} failed, ${drained.suppressed} suppressed, ${drained.remaining} still queued`
    );
    return Response.json({ started, ...drained });
  } catch (err) {
    console.error("marketing dispatch failed", err);
    return new Response("Dispatch failed", { status: 500 });
  }
};

export const config: Config = {
  schedule: "* * * * *"
};
