import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNotebook } from "../src/domain/calculation.ts";
import { parseNoteBody, serializeNoteBody, stripResult } from "../src/domain/format.ts";

// 用户真实保存的 Numi 文件（= 后面的结果是 Numi 保存时自动追加的）。
const 氨糖研究 = `#氨糖研究
#益节 Move Free 红绿瓶每天3片
氨糖 = 1500mg = 1,500 mg
MSM = 1500mg = 1,500 mg
钙 = 216mg = 216 mg
软骨素 = 200mg = 200 mg
每天价格 = 375元 / (240片 / 3片) = 4.69 ¥

#益节 Move Free 红瓶每天2片
氨糖 = 1500mg = 1,500 mg
钙 = 216mg = 216 mg
软骨素 = 200mg = 200 mg
每天价格 = 395元 / (400片 / 2片) = 1.98 ¥

#汤臣倍健 健立多骨氨糖
#每100克
钙 = 10.2克 / 100克 = 0.1
氨糖 = 19.8克 / 100克 = 0.2
软骨素 = 14.3克 / 100克 = 0.14
#每片含量
片 = 0.9克 * 1000毫克 = 900 mg
#每天4片
4 x 片 x 钙 = 367.2 mg
4 x 片 x 氨糖 = 712.8 mg
4 x 片 x 软骨素 = 514.8 mg
`;

const 氨糖研究源 = `#氨糖研究
#益节 Move Free 红绿瓶每天3片
氨糖 = 1500mg
MSM = 1500mg
钙 = 216mg
软骨素 = 200mg
每天价格 = 375元 / (240片 / 3片)

#益节 Move Free 红瓶每天2片
氨糖 = 1500mg
钙 = 216mg
软骨素 = 200mg
每天价格 = 395元 / (400片 / 2片)

#汤臣倍健 健立多骨氨糖
#每100克
钙 = 10.2克 / 100克
氨糖 = 19.8克 / 100克
软骨素 = 14.3克 / 100克
#每片含量
片 = 0.9克 * 1000毫克
#每天4片
4 x 片 x 钙
4 x 片 x 氨糖
4 x 片 x 软骨素
`;

const 人体消耗计算 = `# 人体消耗计算
# 活动系数
久坐 = 1.2 = 1.2
轻度活动 = 1.375 = 1.38
中度活动 = 1.55 = 1.55
高强度活动 = 1.725 = 1.73

# 男性BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5
体重 = 70 = 70
身高 = 177 = 177
年龄 = 2025 - 1976 = 49
BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5 = 1,566.25
全天总消耗 = BMR x 久坐 = 1,879.5
全天总消耗 = BMR x 中度活动 = 2,427.69

# 女性BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) - 161
体重 = 52 = 52
身高 = 164 = 164
年龄 = 2025 - 1988 = 37
BMR = (10 × 体重) + (6.25 × 身高) - (5 × 年龄) - 161 = 1,199
全天总消耗 = BMR x 久坐 = 1,438.8
全天总消耗 = BMR x 中度活动 = 1,858.45
`;

const 人体消耗计算源 = `# 人体消耗计算
# 活动系数
久坐 = 1.2
轻度活动 = 1.375
中度活动 = 1.55
高强度活动 = 1.725

# 男性BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5
体重 = 70
身高 = 177
年龄 = 2025 - 1976
BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5
全天总消耗 = BMR x 久坐
全天总消耗 = BMR x 中度活动

# 女性BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) - 161
体重 = 52
身高 = 164
年龄 = 2025 - 1988
BMR = (10 × 体重) + (6.25 × 身高) - (5 × 年龄) - 161
全天总消耗 = BMR x 久坐
全天总消耗 = BMR x 中度活动
`;

test("导入 Numi 文件时剥离自动追加的结果", () => {
  assert.equal(parseNoteBody(氨糖研究), 氨糖研究源);
  assert.equal(parseNoteBody(人体消耗计算), 人体消耗计算源);
});

test("剥离后重新计算得到 Numi 记录的结果", () => {
  const results = evaluateNotebook(parseNoteBody(人体消耗计算)).map((line) => [
    line.source.trim(),
    line.display,
  ]);
  const display = (source: string, skip = 0) => {
    let seen = 0;
    for (const [line, value] of results) {
      if (line !== source || seen++ < skip) continue;
      return value;
    }
    return undefined;
  };
  assert.equal(display("久坐 = 1.2"), "1.2");
  assert.equal(display("年龄 = 2025 - 1976"), "49");
  assert.equal(display("BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5"), "1,566.25");
  assert.equal(display("全天总消耗 = BMR x 久坐"), "1,879.5");
  // Numi 显示四舍五入后的 2,427.69，Calcbook 保留完整精度。
  assert.equal(display("全天总消耗 = BMR x 中度活动"), "2,427.6875");
  assert.equal(display("全天总消耗 = BMR x 久坐", 1), "1,438.8");
  assert.equal(display("全天总消耗 = BMR x 中度活动", 1), "1,858.45");
});

test("自己写的赋值不会被当成自动结果剥掉", () => {
  for (const line of ["a = 2 kg", "单价 = 128", "体重 = 70", "备注 = 3 天", "a=5"]) {
    assert.equal(stripResult(line), line);
  }
  assert.equal(stripResult("单价 = 128 = 128"), "单价 = 128");
  assert.equal(stripResult("4 x 片 x 钙 = 367.2 mg"), "4 x 片 x 钙");
  assert.equal(stripResult("# 标题 = 5"), "# 标题 = 5");
  assert.equal(stripResult("// 注释 = 5"), "// 注释 = 5");
  assert.equal(stripResult(""), "");
});

test("保存时追加结果，再导入回到同一份源文本", () => {
  for (const source of [氨糖研究源, 人体消耗计算源]) {
    const written = serializeNoteBody(source);
    assert.equal(parseNoteBody(written), source);
    // 可计算的整行末尾必须带上结果，才能被 Numi 与下次导入识别。
    assert.match(written, / = /);
  }
  // “毫克”加入别名后该行可以计算；同量纲分量约分后为 0.9 g^2，结果如实追加。
  assert.match(serializeNoteBody(氨糖研究源), /^片 = 0\.9克 \* 1000毫克 = 0\.9 g\^2$/m);
});

test("保存格式与 Numi 一致：注释、空行、标题原样保留", () => {
  const written = serializeNoteBody(人体消耗计算源);
  const lines = written.split("\n");
  assert.equal(lines[0], "# 人体消耗计算");
  assert.equal(lines[1], "# 活动系数");
  assert.equal(lines[6], "");
  assert.equal(lines[7], "# 男性BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5");
  assert.equal(lines[10], "年龄 = 2025 - 1976 = 49");
  assert.equal(lines[11], "BMR = (10 x 体重) + (6.25 × 身高) - (5 × 年龄) + 5 = 1,566.25");
});

test("导入时剥离保留字追加的结果与注释前结果", () => {
  assert.equal(stripResult("sum = 60"), "sum");
  assert.equal(stripResult("prev = 40"), "prev");
  assert.equal(stripResult("合计 = 123"), "合计");
  // 普通赋值不被剥离；单位保留名行也不剥离
  assert.equal(stripResult("单价 = 128"), "单价 = 128");
  // 单位保留名行：保存形态按赋值+结果剥到最后一层
  assert.equal(stripResult("kg = 5 = 5"), "kg = 5");
  // 行内注释：结果插在算式与注释之间，导入时剥离 = 结果
  assert.equal(stripResult("5 × 2 = 10 //棒冰"), "5 × 2 //棒冰");
  assert.equal(stripResult("小明 = 50 = 50"), "小明 = 50");
  const lines = evaluateNotebook(parseNoteBody("5 × 2 = 10 //棒冰"));
  assert.equal(lines[0].kind, "result");
  assert.equal(lines[0].display, "10");
  assert.match(lines[0].source, /棒冰/);
  // 保存：结果插在算式与行内注释之间
  assert.equal(serializeNoteBody("5 × 2 //棒冰"), "5 × 2 = 10 //棒冰");
  assert.equal(serializeNoteBody("小明 = 50"), "小明 = 50 = 50");
  assert.equal(serializeNoteBody("(18 + 24) × 3"), "(18 + 24) × 3 = 126");
  assert.equal(serializeNoteBody("24\n36\nsum"), "24 = 24\n36 = 36\nsum = 60");
});
