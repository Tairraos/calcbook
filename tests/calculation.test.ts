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
test("result display unit spacing follows the option, raw and file format keep the space", () => {
  const body = "总长 = 5 km to m";
  const [line] = evaluateNotebook(body);
  // 默认（历史行为）：数字与单位间有空格——写入 .txt 的 ` = 结果` 用它，Numi 兼容
  assert.equal(line.display, "5,000 m");
  // 结果列实时对齐设置的「数字与单位空格」：关 = 紧贴，开 = 空格
  const [tight] = evaluateNotebook(body, { unitSpacing: false });
  assert.equal(tight.display, "5,000m");
  const [spaced] = evaluateNotebook(body, { unitSpacing: true });
  assert.equal(spaced.display, "5,000 m");
  // 千分位开关独立于空格
  const [noGroup] = evaluateNotebook(body, { unitSpacing: false, resultThousands: false });
  assert.equal(noGroup.display, "5000m");
  // raw（复制用的精确值）不受显示选项影响：无千分位、保留单位间空格
  const [raw] = evaluateNotebook(body, { unitSpacing: false });
  assert.equal(raw.raw, "5000 m");
});

test("calculator display rounds to four places and caps at sixteen integer digits", () => {
  for (const [source, display] of [
    ["1/3", "0.3333"],
    ["2/3", "0.6667"],
    ["-2/3", "-0.6667"],
    ["-0.0004", "-0.0004"],
    ["1.2345", "1.2345"],
    ["9999999999.9994", "9,999,999,999.9994"],
    ["-9999999999.999", "-9,999,999,999.999"],
    ["9999999999.9995", "9,999,999,999.9995"],
    ["12345678901", "12,345,678,901"],
    ["9999999999999999", "9,999,999,999,999,999"],
    ["1 CNY / 3", "0.3333CNY"],
    ["16:9", "1.7778"],
    ["8 : 4", "2"],
  ]) {
    const result = calculateInput(source);
    assert.ok(result.ok, source);
    assert.equal(result.display, display, source);
  }
});
test("number width limit: 16 integer digits and 4 decimals, input and result errors differ", () => {
  // 输入数字超宽：17 位整数、5 位小数 →「数字宽度超限」
  for (const source of ["12345678901234567", "0.12345", "12.34567"]) {
    const result = calculateInput(source);
    assert.equal(result.ok, false, source);
    assert.equal(result.ok ? "" : result.error, "数字宽度超限", source);
  }
  // 上限内正常（16 位整数、4 位小数）
  assert.equal(calculateInput("9999999999999999").ok, true);
  assert.equal(calculateInput("0.1234").ok, true);
  // 结果超宽：进位到 17 位整数、大幂结果、超宽的 e 记法输入 →「计算结果数字宽度超限」
  for (const source of ["9999999999999999 + 1", "2^60", "2^60 米", "1e308"]) {
    const [line] = evaluateNotebook(source);
    assert.equal(line.kind, "error", source);
    assert.equal(line.error, "计算结果数字宽度超限", source);
  }
  // 计算器同款文案
  const calc = calculateInput("2^60");
  assert.equal(calc.ok, false);
  assert.equal(calc.ok ? "" : calc.error, "计算结果数字宽度超限");
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
