import assert from "node:assert/strict";
import test from "node:test";
import { calculateInput, evaluateNotebook } from "../src/domain/calculation.ts";
import { msg } from "../src/domain/messages.ts";
import { createWorkspace, parseWorkspace } from "../src/domain/notebook.ts";
import { makeT, STRINGS } from "../src/ui/i18n.ts";

const display = (source: string, lang: "zh" | "en") =>
  evaluateNotebook(source, { lang }).map((line) =>
    line.kind === "result" ? line.display : `!${line.kind}:${line.error}`,
  );

test("workspace uiLanguage defaults and survives round-trip", () => {
  const now = new Date().toISOString();
  // 出厂默认英文
  assert.equal(createWorkspace(now, () => "id").uiLanguage, "en");
  // 旧数据无此字段：回落英文，不阻塞启动
  const legacy = parseWorkspace({
    version: 1,
    notes: [],
    activeId: null,
    theme: "light",
    historyLimitKB: 128,
  });
  assert.equal(legacy.uiLanguage, "en");
  // 中文保留、非法回落英文
  const zh = parseWorkspace({ ...legacy, uiLanguage: "zh" });
  assert.equal(zh.uiLanguage, "zh");
  assert.equal(parseWorkspace({ ...legacy, uiLanguage: "fr" }).uiLanguage, "en");
});

test("English UI prefers English unit names over Chinese", () => {
  // 英文优先：算式里只有中文单位，结果也用英文规范名
  assert.deepEqual(display("5米", "en"), ["5 m"]);
  assert.deepEqual(display("1英里 + 1公里", "en"), ["2.6093 km"]);
  assert.deepEqual(display("(1米+25毫米)×100元/米", "en"), ["102.5 cny"]);
  assert.deepEqual(display("体重 = 70公斤\n体重 × 2", "en"), ["70 kg", "140 kg"]);
  // 大小写仍是 小写 > 大写
  assert.deepEqual(display("5 KM + 500 M", "en"), ["5,500 M"]);
  assert.deepEqual(display("5 KM + 500 m", "en"), ["5,500 m"]);
  // 中文界面保持 中文 > 英文小写 > 英文大写（1.6.20 行为不变）
  assert.deepEqual(display("5米", "zh"), ["5米"]);
  assert.deepEqual(display("5ml+6L", "zh"), ["6,005 ml"]);
});

test("unit style setting still overrides UI language", () => {
  const withStyle = (unitStyle: "chinese" | "lower" | "upper") =>
    evaluateNotebook("5米", { lang: "en", unitStyle }).map((line) =>
      line.kind === "result" ? line.display : `!${line.kind}`,
    );
  assert.deepEqual(withStyle("chinese"), ["5米"]);
  assert.deepEqual(withStyle("lower"), ["5 m"]);
  assert.deepEqual(withStyle("upper"), ["5 M"]);
});

test("errors follow the UI language", () => {
  const errorOf = (source: string, lang: "zh" | "en") => {
    const [line] = evaluateNotebook(source, { lang });
    return line.kind === "error" ? line.error : "";
  };
  assert.equal(errorOf("foo + 1", "zh"), "“foo”尚未定义");
  assert.equal(errorOf("foo + 1", "en"), '"foo" is not defined');
  assert.equal(
    errorOf("1/0", "en"),
    "Invalid result — check for division by zero or out-of-range functions",
  );
  assert.equal(
    calculateInput("10 USD + 5 CNY", "en").error,
    "Units don't match; converting between currencies isn't supported",
  );
  assert.equal(msg("en", "undefinedSymbol", { name: "x" }), '"x" is not defined');
  assert.equal(msg("zh", "undefinedSymbol", { name: "x" }), "“x”尚未定义");
});

test("i18n dictionaries keep the same key set", () => {
  assert.deepEqual(Object.keys(STRINGS.zh).sort(), Object.keys(STRINGS.en).sort());
  // 插值：两种语言都替换占位符
  assert.equal(makeT("en")("resultCount", { n: 3 }), "3 results");
  assert.equal(makeT("zh")("resultCount", { n: 3 }), "3 条计算");
});
