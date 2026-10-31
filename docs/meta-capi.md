# DCA Pro Manager → Meta Conversions API

Verified in Meta on October 31, 2026:

- Business portfolio: DCA Cleaning firm, 1523066619831966.
- Active campaign ad account: dca cleaning solutions, 1647872499624199.
- Existing website Pixel/dataset: 1000652526109538.
- The personal account 1222947422241047 and its app 28764016053250755 are not the active DCA campaign account.
- DCA Pro uses Drizzle with Netlify Database (`db/index.ts`); this implementation needs no Supabase project or schema migration.

The sender queues Instant Form lead stage events in the existing `lead_events` table, alongside the office audit event. The five-minute dispatcher sends these to the existing Pixel, preserves the original event time and ID on retries, and records receipts. Only the Meta lead ID, stage and event metadata leave DCA Pro. Contact details and notes are excluded. Website forms are excluded, so there is no extra browser/server Lead pair to double-count. Completed service is not represented as collected revenue.

Mappings: New → Lead; Contacted → Contacted; Estimate sent → EstimateSent; Scheduled → Schedule; Completed → ServiceCompleted; Lost/cancelled → LeadLost. A booking through Convert to job also queues Schedule. Office edits to notes or ownership alone do not queue an event. This reports lead-status changes; it does not infer payment or job completion from invoice records.

Activation requires confirmation to create a CAPI access token for the existing Pixel. Choose direct integration **without Dataset Quality API** to avoid expanding existing tokens' permissions. Store the token as a production-only, Functions-scoped secret named META_CAPI_ACCESS_TOKEN on site dcacleaningfirm (6905ad23-aaa9-4710-af39-cac89636bb92). Also set META_CAPI_PIXEL_ID=1000652526109538 and META_CAPI_ENABLED=true for production Functions. Redeploy after configuration. Do not put the token in client code, git, chat, or URLs.

Before enabling production dispatch, use the Pixel's Test events code with an explicit synthetic test event and confirm Meta returns events_received=1 and shows a Server event. Test events must not be reported as real production leads. The production dispatcher never uses a test-event code. After activation, prove a real Instant Form lead arrives in DCA Pro and its CRM event receives a sent receipt. No past customer list is uploaded and no campaign, budget, targeting or optimization goal is changed.

META_CAPI_ENABLED defaults off. Provider failures stay queued and are retried. Invalid events and events older than seven days are rejected and logged rather than given a false timestamp. Meta's stable event ID protects against duplicate dispatch after a timeout or concurrent invocation. A provider error blocks that batch until fixed; check the meta-capi-dispatch function logs. A queue receipt means Meta accepted the event, not proof of ad attribution or a particular cost improvement.
