import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNotebook } from "../src/domain/calculation.ts";
import { mixesUnitLanguages, parseUnitMode, rewriteLineUnits } from "../src/domain/units.ts";

const display = (source: string) =>
  evaluateNotebook(source).map((line) => (line.kind === "result" ? line.display : `!${line.kind}`));

test("中文单位名直接参与计算", () => {
  assert.deepEqual(display("1500毫克"), ["1,500 mg"]);
  assert.deepEqual(display("1英里 + 1公里"), ["2.609344 km"]);
  assert.deepEqual(display("10磅 to 千克"), ["4.5359237 kg"]);
  assert.deepEqual(display("2加仑 to 升"), ["7.570823568 l"]);
  assert.deepEqual(display("1卡 to 焦"), ["4.184 j"]);
  assert.deepEqual(display("2斤 to 克"), ["1,000 g"]);
  assert.deepEqual(display("1亩 to 平方米"), ["666.66666666667 m2"]);
});

test("公制英制混算并入公制；纯英制保持原样", () => {
  assert.deepEqual(display("1 lb + 1 kg"), ["1.45359237 kg"]);
  assert.deepEqual(display("1 gal + 1 l"), ["4.785411784 l"]);
  assert.deepEqual(display("1 foot + 30 cm"), ["0.6048 m"]);
  assert.deepEqual(display("60 mph + 1 km/h"), ["97.56064 km / hour"]);
  // 节与英里每小时按同一规则并入 km/hour，速度类呈现一致。
  assert.deepEqual(display("20节 + 1 km/h"), ["38.04 km / hour"]);
  assert.deepEqual(display("32 degF + 1 celsius"), ["1 degc"]);
  // 变量携带的单位也参与混用判断。
  assert.deepEqual(display("距离 = 1 mile\n距离 + 1 km"), ["1 mile", "2.609344 km"]);
  // 只有英制时不换算；显式 to 仍以目标单位为准。
  assert.deepEqual(display("1 mile + 1 ft"), ["1.0001893939394 mile"]);
  assert.deepEqual(display("5 mile to km"), ["8.04672 km"]);
});

test("汇总同样并入公制", () => {
  assert.deepEqual(display("1 mile\n1 km\nsum"), ["1 mile", "1 km", "2.609344 km"]);
});

test("保留用户写下的单位与前缀", () => {
  assert.deepEqual(display("1500mg"), ["1,500 mg"]);
  assert.deepEqual(display("500毫克 + 500毫克"), ["1,000 mg"]);
  assert.deepEqual(display("2000 m"), ["2,000 m"]);
  assert.deepEqual(display("2 km + 500 m"), ["2.5 km"]);
});

test("同量纲分量约分：全抵消退回纯数字，部分抵消合并", () => {
  assert.deepEqual(display("1 m / 1 cm"), ["100"]);
  assert.deepEqual(display("2 kg / 500 g"), ["4"]);
  assert.deepEqual(display("1 mile / 1 km"), ["1.609344"]);
  // 用户真实文件的营养成分写法
  assert.deepEqual(display("钙 = 10.2克 / 100克\n钙"), ["0.102", "0.102"]);
  // 子表达式层的约分（BMI 场景）
  assert.deepEqual(display("体重 = 70公斤\n身高 = 177厘米\n体重 / (身高/米)^2"), [
    "70 kg",
    "177 cm",
    "22.343515592582 kg",
  ]);
  // 同量纲分量合并，代表取幂最大的分量
  assert.deepEqual(display("1 km * 1 cm"), ["10 m^2"]);
});

test("显式 to 的目标单位不被公制合并覆盖", () => {
  assert.deepEqual(display("5 km to mile"), ["3.1068559611867 mile"]);
  assert.deepEqual(display("1 kg to lb"), ["2.2046226218488 lb"]);
  assert.deepEqual(display("100 celsius to fahrenheit"), ["212 degf"]);
  assert.deepEqual(display("1 mile + 1 km to m"), ["2,609.344 m"]);
  assert.deepEqual(display("10磅 to 千克"), ["4.5359237 kg"]);
});

test("按模式改写刚算完的行", () => {
  assert.equal(rewriteLineUnits("100L", "chinese"), "100升");
  assert.equal(rewriteLineUnits("4ml", "chinese"), "4毫升");
  assert.equal(rewriteLineUnits("4毫升", "english"), "4 ml");
  assert.equal(rewriteLineUnits("60 mph", "chinese"), "60 英里/小时");
  assert.equal(rewriteLineUnits("预算 = 375元 / 80", "english"), "预算 = 375 CNY / 80");
  // 复合单位按斜杠逐段改写，且仍可解析。
  assert.equal(rewriteLineUnits("4 km/h", "chinese"), "4 公里/小时");
  assert.deepEqual(display(rewriteLineUnits("4 km/h", "chinese") ?? ""), ["4 km / hour"]);
});

test("自由模式只在中英文混用时统一成中文", () => {
  assert.equal(rewriteLineUnits("100L + 100升", "free"), "100升 + 100升");
  assert.equal(rewriteLineUnits("100L", "free"), null);
  assert.equal(rewriteLineUnits("5公里 + 500米", "free"), null);
  assert.equal(mixesUnitLanguages("100L + 100升"), true);
  assert.equal(mixesUnitLanguages("100L + 100 mL"), false);
});

test("改写不碰标签、注释、标题与变量名", () => {
  assert.equal(rewriteLineUnits("# 重量单位说明", "chinese"), null);
  assert.equal(rewriteLineUnits("// 1 km 备注", "chinese"), null);
  assert.equal(rewriteLineUnits("重量(千克): 5kg // 每袋", "chinese"), "重量(千克): 5千克 // 每袋");
  assert.equal(rewriteLineUnits("片 = 0.9克 * 1000毫克", "chinese"), null);
  assert.equal(rewriteLineUnits("", "chinese"), null);
});

test("单位模式配置校验", () => {
  assert.equal(parseUnitMode("free"), "free");
  assert.equal(parseUnitMode("chinese"), "chinese");
  assert.equal(parseUnitMode("english"), "english");
  assert.throws(() => parseUnitMode("traditional"));
  assert.throws(() => parseUnitMode(undefined));
});

test("单位缩写不区分大小写，结果显示小写", () => {
  assert.deepEqual(display("5 KM + 500 M"), ["5.5 km"]);
  assert.deepEqual(display("1500MG"), ["1,500 mg"]);
  assert.deepEqual(display("2 ML"), ["2 l"]);
  assert.deepEqual(display("10 LBS to KG"), ["4.5359237 kg"]);
  assert.deepEqual(display("1 hp to W"), ["745.6998715386 w"]);
  assert.deepEqual(display("1担 to 公斤"), ["50 kg"]);
  // 单字母大写也映射到常见单位；变量名大小写不受影响
  assert.deepEqual(display("Price = 5\nTotal = Price × 3"), ["5", "15"]);
});
