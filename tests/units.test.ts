import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNotebook } from "../src/domain/calculation.ts";
import { DEFAULT_FORMAT_SETTINGS, formatNoteBody } from "../src/domain/formatting.ts";

const display = (source: string) =>
  evaluateNotebook(source).map((line) => (line.kind === "result" ? line.display : `!${line.kind}`));

test("中文单位名直接参与计算，结果语言跟随算式", () => {
  assert.deepEqual(display("1500毫克"), ["1500毫克"]);
  assert.deepEqual(display("1英里 + 1公里"), ["2.609344公里"]);
  assert.deepEqual(display("10磅 to 千克"), ["4.5359237千克"]);
  assert.deepEqual(display("2加仑 to 升"), ["7.570823568升"]);
  assert.deepEqual(display("2斤 to 克"), ["1000克"]);
  assert.deepEqual(display("1亩 to 平方米"), ["666.66666666667平方米"]);
});

test("结果向同行更小的单位靠拢", () => {
  assert.deepEqual(display("5ml+6L"), ["6,005 ML"]);
  assert.deepEqual(display("1L+500ML"), ["1,500 ML"]);
  assert.deepEqual(display("2 km + 500 m"), ["2,500 m"]);
  assert.deepEqual(display("1 foot + 30 cm"), ["60.48 cm"]);
  // 英文大写在算式里出现时，结果保持大写
  assert.deepEqual(display("5 KM + 500 M"), ["5,500 M"]);
});

test("制式优先级 公制 > 英制 > 市制", () => {
  assert.deepEqual(display("1 mile + 1 km"), ["2.609344 km"]);
  assert.deepEqual(display("1 lb + 1 kg"), ["1.45359237 kg"]);
  assert.deepEqual(display("1 gal + 1 l"), ["4.785411784 l"]);
  assert.deepEqual(display("2里 + 1公里"), ["2公里"]);
  assert.deepEqual(display("1里 + 500米"), ["1000米"]);
  // 变量携带的单位参与判断
  assert.deepEqual(display("距离 = 1 mile\n距离 + 1 km"), ["1 mile", "2.609344 km"]);
  // 只有英制时向英制的小单位靠拢
  assert.deepEqual(display("1 mile + 1 ft"), ["5,281 foot"]);
});

test("显式 to 的目标单位不被覆盖", () => {
  assert.deepEqual(display("5 km to mile"), ["3.1068559611867 mile"]);
  assert.deepEqual(display("1 kg to lb"), ["2.2046226218488 lb"]);
  assert.deepEqual(display("100 celsius to fahrenheit"), ["212 degf"]);
  assert.deepEqual(display("1 mile + 1 km to m"), ["2,609.344 m"]);
  assert.deepEqual(display("10磅 to 千克"), ["4.5359237千克"]);
});

test("汇总跟随段内单位规则", () => {
  assert.deepEqual(display("1 mile\n1 km\nsum"), ["1 mile", "1 km", "2.609344 km"]);
});

test("保留用户写下的单位与前缀", () => {
  assert.deepEqual(display("1500mg"), ["1,500 mg"]);
  assert.deepEqual(display("500毫克 + 500毫克"), ["1000毫克"]);
  assert.deepEqual(display("2000 m"), ["2,000 m"]);
  assert.deepEqual(display("0.1 + 0.2"), ["0.3"]);
});

test("同量纲分量约分", () => {
  assert.deepEqual(display("1 m / 1 cm"), ["100"]);
  assert.deepEqual(display("2 kg / 500 g"), ["4"]);
  assert.deepEqual(display("1 mile / 1 km"), ["1.609344"]);
  assert.deepEqual(display("钙 = 10.2克 / 100克\n钙"), ["0.102", "0.102"]);
});

test("按格式设置格式化整篇", () => {
  const body = "预算=1234567\n6L + 1gal\n5 kg#备注";
  // 默认：运算符空格、注释空格，不加千分位、不换算
  assert.equal(
    formatNoteBody(body, DEFAULT_FORMAT_SETTINGS, () => null),
    "预算 = 1234567\n6L + 1gal\n5kg # 备注",
  );
  // 制式换算 + 千分位 + 单位空格 + 大写
  assert.equal(
    formatNoteBody(
      body,
      {
        ...DEFAULT_FORMAT_SETTINGS,
        unitSystem: "metric",
        thousands: true,
        unitSpace: true,
        unitStyle: "upper",
      },
      (value, from, to) =>
        from === "gallon" && to.toLowerCase() === "l" ? value * 3.785411784 : null,
    ),
    "预算 = 1,234,567\n6 L + 3.785411784 L\n5 KG # 备注",
  );
  // 中文风格：单位改写中文
  assert.equal(
    formatNoteBody("6L + 1gal", { ...DEFAULT_FORMAT_SETTINGS, unitStyle: "chinese" }, () => null),
    "6升 + 1加仑",
  );
  // 连续空格收敛、行尾空格去除
  assert.equal(
    formatNoteBody("1  +   2  \n#  标题 ", DEFAULT_FORMAT_SETTINGS, () => null),
    "1 + 2\n# 标题",
  );
});
