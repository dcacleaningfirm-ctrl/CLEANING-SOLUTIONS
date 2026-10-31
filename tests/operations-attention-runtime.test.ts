import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.includes("/netlify/functions/"))
      return next(specifier.slice(0, -3) + ".ts", context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/lib/manager-session.ts")) return { format: "module", shortCircuit: true, source: `
      export async function readSessionCookie() { return { employeeId: 1 }; }
      export function can() { return true; }
    ` };
    if (url.endsWith("/db/index.ts")) return { format: "module", shortCircuit: true, source: `
      const rows = [
        [{role:'owner',active:true,mustChangePin:false}],
        [],
        [{id:37,priceCents:62500}],
        [],
        [],
        [{jobId:37,paidCents:12500}],
        []
      ];
      export const db = { select() {
        const result = rows.shift() || [];
        const query = {from(){return this},innerJoin(){return this},where(){return this},orderBy(){return this},limit(){return this},groupBy(){return this},then(ok,bad){return Promise.resolve(result).then(ok,bad)}};
        return query;
      }};
    ` };
    return next(url, context);
  }
});

test("operations endpoint executes all queries and respects all-time payments outside the recent transaction window", async () => {
  const { default: handler } = await import("../netlify/functions/operations-attention.mts");
  const response = await handler(new Request("https://example.com/api/operations-attention"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.counts.depositPending, 0);
  assert.equal(body.counts.alertFailed, 0);
});
