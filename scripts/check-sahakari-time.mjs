import assert from "node:assert/strict";
import {
  adToBs,
  kathmanduNow,
  monthDateRange,
  shouldShowSahakariReminder,
} from "../artifacts/mockup-sandbox/src/lib/kathmanduTime.ts";

const beforeOne = kathmanduNow(new Date("2026-09-18T07:14:00Z"));
const atOne = kathmanduNow(new Date("2026-09-18T07:15:00Z"));
const saturday = kathmanduNow(new Date("2026-09-19T07:15:00Z"));
const afterKathmanduMidnight = kathmanduNow(new Date("2026-09-17T18:15:00Z"));

assert.equal(beforeOne.hour, 12);
assert.equal(atOne.hour, 13);
assert.equal(afterKathmanduMidnight.date, "2026-09-18");
assert.equal(shouldShowSahakariReminder(beforeOne, false, null), false);
assert.equal(shouldShowSahakariReminder(atOne, false, null), true);
assert.equal(shouldShowSahakariReminder(atOne, true, null), false);
assert.equal(shouldShowSahakariReminder(atOne, false, atOne.date), false);
assert.equal(shouldShowSahakariReminder(saturday, false, null), false);
assert.deepEqual(monthDateRange("2026-09"), { from: "2026-09-01", to: "2026-09-30" });
assert.equal(adToBs("2026-08-25"), "2083-05-09");
assert.equal(adToBs("2026-09-17"), "2083-06-01");

console.log("Sahakari Kathmandu time and reminder checks passed.");
