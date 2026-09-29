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
test("calculator display rounds to four places and switches at ten integer digits", () => {
  for (const [source, display] of [
    ["1/3", "0.3333"],
    ["2/3", "0.6667"],
    ["-2/3", "-0.6667"],
    ["-0.0004", "-0.0004"],
    ["1.2345", "1.2345"],
    ["9999999999.9994", "9,999,999,999.9994"],
    ["-9999999999.999", "-9,999,999,999.999"],
    ["9999999999.9995", "9,999,999,999.9995"],
    ["12345678901", "1.2346e+10"],
    ["1e308", "1e+308"],
    ["1 CNY / 3", "0.3333 CNY"],
    ["16:9", "1.7778"],
    ["8 : 4", "2"],
  ]) {
    const result = calculateInput(source);
    assert.ok(result.ok, source);
    assert.equal(result.display, display, source);
  }
});
test("assignment names conflicting with reserved words name the conflict", () => {
  for (const [source, category] of [
    ["月 = 12", "单位名"],
    ["kg = 7", "单位名"],
    ["sqrt = 3", "函数名"],
    ["pi = 3", "常量名"],
    ["sum = 9", "汇总关键字"],
    ["平均 = 1", "汇总关键字"],
    ["to = 3", "单位转换关键字"],
    ["prev = 5", "上一行的结果"],
  ] as const) {
    const [line] = evaluateNotebook(source);
    assert.equal(line.kind, "error", source);
    assert.match(line.error ?? "", /^保留字冲突：/, source);
    assert.match(line.error ?? "", new RegExp(category), source);
  }
  // 右边使用常量、左边是普通名字的赋值不受影响。
  assert.deepEqual(
    evaluateNotebook("体重 = 70\n天数 = 3\n周长 = pi × 3").map((line) => line.kind),
    ["result", "result", "result"],
  );
});
