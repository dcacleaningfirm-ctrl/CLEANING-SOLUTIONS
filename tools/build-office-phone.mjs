import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../node_modules/@twilio/voice-sdk/dist/twilio.min.js", import.meta.url),
  new URL("../manager/twilio-voice-sdk.js", import.meta.url)
);
