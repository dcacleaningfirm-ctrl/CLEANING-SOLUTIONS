// Tests for the Audience filters on the Grow screen: the ZIP and city lists, the
// previous-service filter, the two service-date fields and their calendar, the
// Clear filters button, and the recount that follows any of them changing.
//
// Run with:  npm test
//
// Three kinds of assertion live here, for the same reasons the rest of the
// marketing tests are split that way. The filter rules are imported from
// lib/marketing.ts and exercised directly, because that module holds no database
// call. The SQL is read as source, because lib/marketing-sql.ts is composed into
// queries and what matters is which expression each filter is built on. And the
// browser's calendar arithmetic is lifted out of manager/manager.js by name and
// evaluated here — manager.js is one browser IIFE with no module boundary, but
// the date arithmetic inside it touches nothing but Date, so it can be run on
// its own.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_AUDIENCE,
  describeAudience,
  normalizeAudience
} from "../lib/marketing.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const SQL = read("lib/marketing-sql.ts");
const STORE = read("lib/marketing-store.ts");
const ROUTES = read("lib/marketing-routes.ts");
const CLIENT = read("manager/manager.js");
const CSS = read("manager/manager.css");

// ---------------------------------------------------------------------------
// The filter itself: every restriction optional, and every one removable.
// ---------------------------------------------------------------------------

test("a filter with nothing set restricts nothing", () => {
  // This is what Clear filters produces. It has to mean "everybody who may be
  // contacted" and never "nobody": empty lists, blank dates, no day cutoff, and
  // households that have never booked still counted in.
  assert.deepEqual(DEFAULT_AUDIENCE.zips, []);
  assert.deepEqual(DEFAULT_AUDIENCE.cities, []);
  assert.equal(DEFAULT_AUDIENCE.service, "");
  assert.equal(DEFAULT_AUDIENCE.lastServiceFrom, "");
  assert.equal(DEFAULT_AUDIENCE.lastServiceTo, "");
  assert.equal(DEFAULT_AUDIENCE.notBookedDays, null);
  assert.equal(DEFAULT_AUDIENCE.includeNeverBooked, true);
  assert.equal(DEFAULT_AUDIENCE.excludeCampaignId, null);

  const cleared = normalizeAudience({
    channel: "any",
    service: "",
    zips: [],
    cities: [],
    lastServiceFrom: "",
    lastServiceTo: "",
    notBookedDays: "",
    includeNeverBooked: true,
    excludeCampaignId: ""
  });
  assert.deepEqual(cleared, DEFAULT_AUDIENCE);
});

test("several ZIP codes and several towns can be asked for at once", () => {
  const filter = normalizeAudience({
    zips: ["30349", "30291", "30337"],
    cities: ["Atlanta", "College Park", "East Point"]
  });
  assert.deepEqual(filter.zips, ["30349", "30291", "30337"]);
  assert.deepEqual(filter.cities, ["Atlanta", "College Park", "East Point"]);
});

test("a town typed with a space in it stays one town", () => {
  // Splitting a typed list on whitespace turned "College Park" into "College"
  // and "Park", neither of which is anywhere, so the city filter matched nobody.
  // Cities split on commas; ZIP codes may still be separated by spaces.
  assert.deepEqual(
    normalizeAudience({ cities: "Atlanta, College Park" }).cities,
    ["Atlanta", "College Park"]
  );
  assert.deepEqual(normalizeAudience({ zips: "30349 30291" }).zips, ["30349", "30291"]);
});

test("the same location asked for twice is only asked for once", () => {
  assert.deepEqual(normalizeAudience({ zips: ["30349", "30349"] }).zips, ["30349"]);
  assert.deepEqual(
    normalizeAudience({ cities: ["College  Park", "College Park"] }).cities,
    ["College Park"]
  );
});

test("a cleared date stays cleared and is never filled in", () => {
  const filter = normalizeAudience({ lastServiceFrom: "", lastServiceTo: "" });
  assert.equal(filter.lastServiceFrom, "");
  assert.equal(filter.lastServiceTo, "");
  // Nothing about the current year leaks into a blank field.
  assert.ok(!describeAudience(filter).includes(String(new Date().getFullYear())));
});

test("a one-sided date range is read back as one-sided", () => {
  // "last service 2024-01-01 to today" described a restriction the filter does
  // not apply — a blank second field is no upper bound at all.
  const from = describeAudience(normalizeAudience({ lastServiceFrom: "2024-01-01" }));
  assert.match(from, /on or after 2024-01-01/);
  assert.ok(!from.includes("today"));

  const to = describeAudience(normalizeAudience({ lastServiceTo: "2024-06-30" }));
  assert.match(to, /on or before 2024-06-30/);

  const both = describeAudience(
    normalizeAudience({ lastServiceFrom: "2024-01-01", lastServiceTo: "2024-06-30" })
  );
  assert.match(both, /2024-01-01 to 2024-06-30/);
});

// ---------------------------------------------------------------------------
// What each filter is actually built on, in SQL.
// ---------------------------------------------------------------------------

test("a filter that asks for nothing produces no condition at all", () => {
  assert.match(
    SQL,
    /if \(!parts\.length\) return null;/,
    "audienceConditions must return null rather than a condition that matches nobody"
  );
});

test("a town is matched loosely enough to find how it is really written", () => {
  // Exact matching meant an account carrying "Atlanta, GA" was not in Atlanta.
  assert.match(
    SQL,
    /filter\.cities\.map\(\(c\) => `%\$\{c\}%`\)/,
    "cities must be matched with wildcards"
  );
  assert.match(SQL, /btrim\(coalesce\(\$\{customers\.city\}, ''\)\)/);
});

test("both service-date bounds read the same last-service date the screen shows", () => {
  // Reading the jobs table alone excluded every imported household whose history
  // is service notes, so setting "on or after" emptied a real audience.
  const dateBlock = /if \(filter\.lastServiceFrom\)[\s\S]*?if \(filter\.notBookedDays\)[\s\S]*?\n  \}/.exec(SQL);
  assert.ok(dateBlock, "the date filters could not be found in audienceConditions");
  const block = dateBlock![0];
  assert.match(block, /LAST_SERVICE_ANY_SQL\} >= \$\{filter\.lastServiceFrom\}/);
  assert.match(block, /LAST_SERVICE_ANY_SQL\} < \(\$\{filter\.lastServiceTo\}/);
  assert.ok(
    !/\$\{LAST_SERVICE_SQL\}/.test(block),
    "a date bound still reads the jobs-only last-service date"
  );
});

test("the previous-service filter reads the written service history too", () => {
  const fn = /export function serviceSegmentSql[\s\S]*?\n\}/.exec(SQL);
  assert.ok(fn, "serviceSegmentSql could not be found");
  assert.match(fn![0], /service_notes/, "a service filter must reach the service notes");
  assert.match(SQL, /SERVICE_SEGMENT_NOTE_COLUMN/);
});

test("the ZIP codes and towns offered are the ones on file and reachable", () => {
  assert.match(STORE, /export async function audienceLocations/);
  const fn = /export async function audienceLocations[\s\S]*?\n\}/.exec(STORE)![0];
  assert.match(fn, /SMS_ELIGIBLE_SQL\} or \$\{EMAIL_ELIGIBLE_SQL\}/);
  assert.match(fn, /groupBy/);
  assert.match(ROUTES, /audienceLocations\(\)/);
  assert.match(ROUTES, /\n      locations,/);
});

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------

test("every filter has a control that takes it back off", () => {
  assert.match(CLIENT, /data-audience-reset/, "there is no Clear filters button");
  assert.match(CLIENT, /data-pick-remove/, "a chosen ZIP code or town cannot be removed on its own");
  assert.match(CLIENT, /data-pick-clear/, "a whole list cannot be cleared");
  assert.match(CLIENT, /data-audience-clear-service/, "the service filter cannot be cleared");
  assert.match(CLIENT, /data-date-clear/, "a date cannot be cleared");
  assert.match(CLIENT, /data-cal-clear/, "the calendar cannot clear a date");
  assert.match(CLIENT, /data-cm-reset/, "the customer-marketing segments cannot be cleared");
});

test("Clear filters restores the widest filter rather than an empty one", () => {
  const fn = /function resetAudienceFilter\(\)[\s\S]*?\n  \}/.exec(CLIENT);
  assert.ok(fn, "resetAudienceFilter could not be found");
  assert.match(fn![0], /defaultAudienceFilter\(\)/);
  const defaults = /function defaultAudienceFilter\(\)[\s\S]*?\n  \}/.exec(CLIENT)![0];
  assert.match(defaults, /channel: "any"/);
  assert.match(defaults, /zips: \[\]/);
  assert.match(defaults, /cities: \[\]/);
  assert.match(defaults, /lastServiceFrom: ""/);
  assert.match(defaults, /lastServiceTo: ""/);
  assert.match(defaults, /notBookedDays: ""/);
  assert.match(defaults, /includeNeverBooked: true/);
  assert.match(defaults, /excludeCampaignId: ""/);
});

test("every change and every clearing triggers a recount", () => {
  ["addAudienceListValue", "removeAudienceListValue", "clearAudienceList",
   "clearAudienceService", "setAudienceDate", "typeAudienceDate", "settleAudienceDate",
   "readAudienceForm"].forEach((name) => {
    const fn = new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`).exec(CLIENT);
    assert.ok(fn, `${name} could not be found in manager.js`);
    assert.match(fn![0], /scheduleAudienceCount\(\)/, `${name} does not recount`);
  });
  // Clear filters redraws the card, and drawing the card counts it.
  assert.match(/function renderGrowAudience[\s\S]*?\n  \}/.exec(CLIENT)![0], /loadAudience\(\)/);
});

test("the four figures the office reads are all four of them", () => {
  const fn = /function loadAudience\(\)[\s\S]*?\n  \}/.exec(CLIENT)![0];
  assert.match(fn, /stat\("Customers in audience"/);
  assert.match(fn, /stat\("Can be texted"/);
  assert.match(fn, /stat\("Can be emailed"/);
  assert.match(fn, /stat\("Both"/);
});

test("the service-date fields no longer depend on the browser's own picker", () => {
  const fn = /function audienceDateFieldHtml[\s\S]*?\n  \}/.exec(CLIENT);
  assert.ok(fn, "audienceDateFieldHtml could not be found");
  assert.ok(
    !/type="date"/.test(fn![0]),
    "Safari on the Mac gives type=date no calendar at all, so the field must be a text box"
  );
  assert.match(fn![0], /data-date-open/, "there is no way to open the calendar");
});

test("the calendar can be moved by month and by year, both ways", () => {
  const fn = /function renderCalendar\([\s\S]*?\n  \}/.exec(CLIENT);
  assert.ok(fn, "renderCalendar could not be found");
  const html = fn![0];
  assert.match(html, /data-cal-move="-12"/, "no way back a whole year");
  assert.match(html, /data-cal-move="-1"/, "no way back a month");
  assert.match(html, /data-cal-move="1"/, "no way forward a month");
  assert.match(html, /data-cal-move="12"/, "no way forward a whole year");
  assert.match(html, /data-cal-month/, "no month menu");
  assert.match(html, /data-cal-year/, "no year menu");
  assert.match(html, /data-cal-today/);
  // Changing the month or year on screen must not change what is chosen.
  const show = /function showCalendarMonth\([\s\S]*?\n  \}/.exec(CLIENT)![0];
  assert.ok(!/g\.filter\[/.test(show), "moving the calendar must not touch the chosen date");
});

test("the calendar and the chips are sized for a thumb", () => {
  assert.match(CSS, /\.cal-day \{[\s\S]*?height: 36px/);
  assert.match(CSS, /\.cal-step \{[\s\S]*?height: 36px/);
  assert.match(CSS, /\.pick-chip button \{[\s\S]*?width: 24px/);
  // On a phone the field can sit against the edge of the screen, so the panel is
  // clamped to the viewport rather than allowed to run off it.
  assert.match(CSS, /\.date-pop \{[\s\S]*?max-width: calc\(100vw - 36px\)/);
});

// ---------------------------------------------------------------------------
// The calendar arithmetic, run for real.
// ---------------------------------------------------------------------------

// Lift a set of top-level functions out of the browser bundle by name. They are
// indented two spaces inside manager.js's IIFE, so the first line that is just
// "  }" closes one.
function clientSource(names: readonly string[]): string {
  return names
    .map((name) => {
      const found = new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}\\n`).exec(CLIENT);
      assert.ok(found, `manager.js has no ${name}()`);
      return found![0];
    })
    .join("\n");
}

const minYear = Number(/var CALENDAR_MIN_YEAR = (\d+);/.exec(CLIENT)![1]);
const maxYear = Number(/var CALENDAR_MAX_YEAR = (\d+);/.exec(CLIENT)![1]);

const cal = new Function(`
  var CALENDAR_MIN_YEAR = ${minYear};
  var CALENDAR_MAX_YEAR = ${maxYear};
  ${clientSource([
    "pad2",
    "isoDate",
    "daysInMonth",
    "parseAudienceDate",
    "shiftCalendar",
    "calendarYearOptions",
    "calendarCells"
  ])}
  return {
    isoDate: isoDate,
    parseAudienceDate: parseAudienceDate,
    shiftCalendar: shiftCalendar,
    calendarYearOptions: calendarYearOptions,
    calendarCells: calendarCells
  };
`)() as {
  isoDate: (y: number, m: number, d: number) => string;
  parseAudienceDate: (raw: unknown) => string;
  shiftCalendar: (y: number, m: number, months: number) => { year: number; month: number };
  calendarYearOptions: (shown: number, thisYear: number) => number[];
  calendarCells: (y: number, m: number) => { iso: string; day: number; outside: boolean }[];
};

test("the calendar reaches back before 2000 and forward past this year", () => {
  assert.ok(minYear <= 1970, `the calendar stops at ${minYear}`);
  assert.ok(maxYear >= 2050, `the calendar stops at ${maxYear}`);
});

test("a date can be typed the way somebody would type it", () => {
  assert.equal(cal.parseAudienceDate("2026-08-19"), "2026-08-19");
  assert.equal(cal.parseAudienceDate("2026-8-9"), "2026-08-09");
  assert.equal(cal.parseAudienceDate("8/19/2026"), "2026-08-19");
  assert.equal(cal.parseAudienceDate("08-19-2026"), "2026-08-19");
  assert.equal(cal.parseAudienceDate(" 2019-02-28 "), "2019-02-28");
  assert.equal(cal.parseAudienceDate("2020-02-29"), "2020-02-29", "2020 was a leap year");
});

test("a blank date field is a valid, meaningful answer", () => {
  assert.equal(cal.parseAudienceDate(""), "");
  assert.equal(cal.parseAudienceDate("   "), "");
  assert.equal(cal.parseAudienceDate(null), "");
  assert.equal(cal.parseAudienceDate(undefined), "");
});

test("a day that does not exist is refused rather than rolled forward", () => {
  assert.equal(cal.parseAudienceDate("2026-02-30"), "");
  assert.equal(cal.parseAudienceDate("2019-02-29"), "");
  assert.equal(cal.parseAudienceDate("2026-13-01"), "");
  assert.equal(cal.parseAudienceDate("2026-00-10"), "");
  assert.equal(cal.parseAudienceDate("last tuesday"), "");
  assert.equal(cal.parseAudienceDate("19/08/2026"), "", "there is no month 19");
});

test("changing the year moves the calendar a year, in either direction", () => {
  assert.deepEqual(cal.shiftCalendar(2026, 7, -12), { year: 2025, month: 7 });
  assert.deepEqual(cal.shiftCalendar(2026, 7, 12), { year: 2027, month: 7 });
  // Twelve single steps and one year step have to agree, or the arrows disagree
  // with each other.
  let walked = { year: 2026, month: 7 };
  for (let i = 0; i < 12; i++) walked = cal.shiftCalendar(walked.year, walked.month, -1);
  assert.deepEqual(walked, cal.shiftCalendar(2026, 7, -12));
});

test("stepping a month at the turn of the year carries into it", () => {
  assert.deepEqual(cal.shiftCalendar(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(cal.shiftCalendar(2026, 11, 1), { year: 2027, month: 0 });
});

test("the calendar stops at its ends instead of running past them", () => {
  assert.deepEqual(cal.shiftCalendar(minYear, 0, -1), { year: minYear, month: 0 });
  assert.deepEqual(cal.shiftCalendar(maxYear, 11, 1), { year: maxYear, month: 11 });
});

test("the year menu always contains the year on screen", () => {
  const years = cal.calendarYearOptions(2026, 2026);
  assert.ok(years.includes(2026));
  assert.ok(years.includes(2000), "a service date from 2000 must be reachable from the menu");
  // Walking back with the arrows past the end of the usual span widens the menu
  // instead of trapping the year at the edge of it.
  assert.ok(cal.calendarYearOptions(1975, 2026).includes(1975));
  assert.ok(cal.calendarYearOptions(2040, 2026).includes(2040));
});

test("a month is drawn as six whole weeks, with the days either side marked", () => {
  const cells = cal.calendarCells(2026, 7);
  assert.equal(cells.length, 42);
  const inside = cells.filter((c) => !c.outside);
  assert.equal(inside.length, 31, "August has 31 days");
  assert.equal(inside[0].iso, "2026-08-01");
  assert.equal(inside[30].iso, "2026-08-31");
  // February 2026 starts on a Sunday, so the grid starts on the 1st with no
  // leading days from January.
  const feb = cal.calendarCells(2026, 1);
  assert.equal(feb[0].iso, "2026-02-01");
  assert.equal(feb[0].outside, false);
});
