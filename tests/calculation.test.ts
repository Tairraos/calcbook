import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateInput, evaluateNotebook } from "../src/domain/calculation.ts";
import { createWorkspace } from "../src/domain/notebook.ts";

const cases: { name: string; source: string; expected: string[] }[] = JSON.parse(
  readFileSync(new URL("./cases/calculations.json", import.meta.url), "utf8"),
);
for (const scenario of cases) {
  test(scenario.name, () => {
    const result = evaluateNotebook(scenario.source);
    assert.deepEqual(
      result.map((line) => (line.kind === "result" ? line.raw : `!${line.kind}`)),
      scenario.expected,
    );
  });
}
test("all shipped examples are valid", () => {
  for (const note of createWorkspace(new Date().toISOString(), () => crypto.randomUUID()).notes) {
    assert.deepEqual(
      evaluateNotebook(note.body).filter((line) => line.kind === "error"),
      [],
      note.title,
    );
  }
});
test("scopes do not leak and long input is bounded", () => {
  evaluateNotebook("budget=10");
  assert.equal(evaluateNotebook("budget+1")[0].kind, "error");
  assert.equal(calculateInput("1+".repeat(600)).ok, false);
  assert.equal(calculateInput(`${"(".repeat(40)}1${")".repeat(40)}`).ok, false);
});
test("calculator display rounds to three places and switches at ten integer digits", () => {
  for (const [source, display] of [
    ["1/3", "0.333"],
    ["2/3", "0.667"],
    ["-2/3", "-0.667"],
    ["-0.0004", "0"],
    ["1.2345", "1.235"],
    ["9999999999.9994", "9,999,999,999.999"],
    ["-9999999999.999", "-9,999,999,999.999"],
    ["9999999999.9995", "1e+10"],
    ["12345678901", "1.235e+10"],
    ["1e308", "1e+308"],
    ["1 CNY / 3", "0.333 CNY"],
  ]) {
    const result = calculateInput(source);
    assert.ok(result.ok, source);
    assert.equal(result.display, display, source);
  }
});
