import { ArrowUpRight, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Lang } from "../domain/messages.ts";
import { UNITS } from "../domain/units.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

// termLines：写法列是一串单位清单，按「；」分词后每项独占一行、需要时折行，
// 避免整列被最长的一项撑宽。
type ReferenceGroup = { title: string; rows: [string, string, string][]; termLines?: boolean };

type HelpContent = {
  title: string;
  closeHelp: string;
  tabsAria: string;
  errorWord: string;
  headers: [string, string, string];
  notes: [string, string];
  tabs: { id: "examples" | "functions" | "aggregates" | "keywords" | "units"; label: string }[];
  examples: [string, string, string][];
  functionGroups: ReferenceGroup[];
  aggregateGroups: ReferenceGroup[];
  keywordGroups: ReferenceGroup[];
  unitGroups: ReferenceGroup[];
};

// 保留字全表：单位（中英对照，来自单位登记表；中文别名并入同一格——公斤是千克的别名，
// 同样是保留字，必须可见）+ 函数/常量/汇总/关键字。别名数据两语言共用（中文写法本身就是数据）。
const unitReservedRows = (() => {
  const rows: ReferenceGroup["rows"] = [];
  const chineseAliases = (entry: (typeof UNITS)[number]) =>
    (entry.aliases ?? []).filter((alias) => /\p{Script=Han}/u.test(alias));
  for (let index = 0; index < UNITS.length; index += 4) {
    const chunk = UNITS.slice(index, index + 4);
    rows.push([
      chunk
        .map((entry) => `${[entry.zh, ...chineseAliases(entry)].join(" / ")} → ${entry.en}`)
        .join("；"),
      "单位",
      "-",
    ]);
  }
  return rows;
})();

function reservedGroupsFor(lang: Lang): ReferenceGroup[] {
  if (lang === "en") {
    return [
      {
        title: "Reserved · Units (Chinese & English, none usable as a variable name)",
        rows: unitReservedRows.map(([term, , example]) => [term, "Unit", example]),
        termLines: true,
      },
      {
        title: "Reserved · Functions, constants, summaries & keywords",
        termLines: true,
        rows: [
          ["sqrt / abs / round / ceil / floor", "Functions", "sqrt(144) → 12"],
          ["pi / e", "Constants", "pi × 2 → 6.2832"],
          ["sum / total / 合计", "Summary", "sum"],
          ["avg / average / 平均", "Summary (average)", "avg"],
          ["prev", "Previous result", "prev + 4"],
          ["to / in / into / as", "Unit conversion", "5 km to m"],
          ["of / on / off", "Percent phrases", "20% of 150 → 30"],
          ["plus / minus / times / divided by", "English operators", "8 times 9 → 72"],
          ["CNY / USD / EUR / GBP；元 / 美元 / 欧元 / 英镑", "Currency", "¥30 + 12 CNY → 42 CNY"],
          [
            "Case rule",
            "Unit abbreviations are case-insensitive; all-caps lines stay upper",
            "5 KM + 500 m → 5,500 m",
          ],
        ],
      },
    ];
  }
  return [
    {
      title: "保留字 · 单位（中英对照，全部不可用作变量名）",
      rows: unitReservedRows,
      termLines: true,
    },
    {
      title: "保留字 · 函数、常量、汇总与关键字",
      termLines: true,
      rows: [
        ["sqrt / abs / round / ceil / floor", "函数", "sqrt(144) → 12"],
        ["pi / e", "常量", "pi × 2 → 6.2832"],
        ["sum / total / 合计", "汇总", "sum"],
        ["avg / average / 平均", "汇总（平均）", "avg"],
        ["prev", "上一行结果", "prev + 4"],
        ["to / in / into / as", "单位转换词", "5 km to m"],
        ["of / on / off", "百分比短语", "20% of 150 → 30"],
        ["plus / minus / times / divided by", "英文运算词", "8 times 9 → 72"],
        ["CNY / USD / EUR / GBP；元 / 美元 / 欧元 / 英镑", "货币", "¥30 + 12 CNY → 42 CNY"],
        ["大小写规则", "单位缩写不区分大小写；整行全大写才显示大写", "5 KM + 500 m → 5,500 m"],
      ],
    },
  ];
}

function contentFor(lang: Lang): HelpContent {
  if (lang === "en") {
    return {
      title: "Calculate naturally, like writing.",
      closeHelp: "Close cheat sheet",
      tabsAria: "Cheat sheet sections",
      errorWord: "error",
      headers: ["Syntax", "Purpose", "Example"],
      notes: [
        "The letter x also means multiplication, e.g. 2x3; [], {} and () are interchangeable brackets. At most 3 nested levels, shaped {[()]}: innermost (), then [] outward, then {}.",
        "Lines starting with # are titles, // writes comments, a label: adds a caption to an expression. An empty line starts a new summary section.",
      ],
      tabs: [
        { id: "examples", label: "Examples" },
        { id: "functions", label: "Functions & constants" },
        { id: "aggregates", label: "Magic words & variables" },
        { id: "keywords", label: "Keywords" },
        { id: "units", label: "Units & symbols" },
      ],
      examples: [
        ["Arithmetic & brackets", "(18 + 24) × 3", "126"],
        ["Define a variable", "价格 = 128\n价格 × 3", "384"],
        ["Add a percent", "200 + 10%", "220"],
        ["Percent of", "20% of 150", "30"],
        ["Convert units", "5 km to m", "5,000 m"],
        ["Time span", "90 min to hour", "1.5 hour"],
        ["Section totals", "24\n36\nsum", "60"],
        ["Previous result", "12 × 3\nprev + 4", "40"],
      ],
      functionGroups: [
        {
          title: "Functions",
          rows: [
            ["sqrt(x)", "Square root", "sqrt(144) → 12"],
            ["abs(x)", "Absolute value", "abs(-5) → 5"],
            ["round(x, n)", "Round, with optional decimals", "round(2.345, 2) → 2.35"],
            ["ceil(x)", "Round up", "ceil(2.1) → 3"],
            ["floor(x)", "Round down", "floor(2.9) → 2"],
          ],
        },
        {
          title: "Constants",
          rows: [
            ["pi", "Circle constant π", "pi × 2 → 6.2832"],
            ["e", "Euler's number", "e^2 → 7.3891"],
          ],
        },
      ],
      aggregateGroups: [
        {
          title: "Magic words",
          rows: [
            ["sum / total / 合计", "Sum of the section (split by empty lines)", "24\n36\nsum → 60"],
            ["avg / average / 平均", "Arithmetic mean of the section", "10\n20\navg → 15"],
            [
              "prev",
              "Previous successful result; titles, comments and empty lines keep it, errors clear it",
              "12 × 3\nprev + 4 → 40",
            ],
          ],
        },
        {
          title: "Operators",
          rows: [
            [
              "of / on / off",
              "Percent phrases",
              "20% of 150 → 30；10% on 200 → 220；10% off 200 → 180",
            ],
            ["to / in / into / as", "Unit conversion", "5 km to m → 5,000 m"],
            ["plus / minus / times / divided by", "English operators", "8 times 9 → 72"],
          ],
        },
        {
          title: "Variables & labels",
          rows: [
            [
              "name = expression",
              "Define a variable, reusable below; reassigning updates later lines",
              "价格 = 128 → 128",
            ],
            [
              "label: expression",
              "Text label before the colon, not calculated",
              "合计: 36 + 6 → 42",
            ],
            [
              "Variable names",
              "Chinese or English letters, digits, underscore; can't start with a digit",
              "sum=9 → error",
            ],
            [
              "Reserved words",
              "Words with meaning are reserved and can't be variable names",
              "sum=9 → error",
            ],
          ],
        },
      ],
      keywordGroups: [
        {
          title: "Units & percentages",
          rows: [
            ["to / in / into / as", "Unit conversion", "5 km to m → 5,000 m"],
            ["of", "Percent of", "20% of 150 → 30"],
            ["on / off", "Percent add / subtract", "10% on 200 → 220；off → 180"],
          ],
        },
        {
          title: "Operators & line syntax",
          rows: [
            ["plus / minus / times / divided by", "English operators", "8 times 9 → 72"],
            ["number:number", "A ratio between two numbers, same as division", "16:9 → 1.7778"],
            [
              "% / ‰",
              "% is relative to the value on its left; ‰ counts per-mille (10‰ = 1%)",
              "200 + 10% → 220；200 + 10‰ → 202；50‰ → 0.05",
            ],
            ["# and //", "Comment or title, not calculated", "# Travel budget"],
          ],
        },
      ],
      unitGroups: [
        {
          title: "Metric & imperial (Chinese and English both work; mixed sums lean metric)",
          termLines: true,
          rows: [
            [
              "公里 / 千米 → km；米 → m；厘米 / 公分 → cm；毫米 / 微米 / 纳米 → mm / um / nm",
              "Length",
              "1英里 + 1公里 → 2.6093 km",
            ],
            [
              "英寸 / 英尺 / 码 → inch / foot / yard；英里 / 海里 → mile / nmi",
              "Length (imperial)",
              "10磅 to 千克 → 4.5359 kg",
            ],
            [
              "吨 → t；千克 / 公斤 → kg；克 → g；毫克 / 微克 → mg / ug",
              "Mass",
              "1 lb + 1 kg → 1.4536 kg",
            ],
            [
              "里 → 500 m；斤 → 500 g；两 → 50 g；钱 → 5 g；石 → 100 L",
              "Market units",
              "1斤 + 10两 → 2 jin",
            ],
            ["磅 / 盎司 / 英石 → lb / oz / stone", "Mass (imperial)", "2斤 to 克 → 1,000 g"],
            [
              "升 → l；毫升 / 厘升 / 分升 → ml / cl / dl；立方米 → m3",
              "Volume",
              "2加仑 to 升 → 7.5708 l",
            ],
            [
              "加仑 / 品脱 / 夸脱 → gallon / pint / quart；杯 / 汤匙 / 茶匙 → cup / tablespoon / teaspoon",
              "Volume (imperial)",
              "1 gal + 1 l → 4.7854 l",
            ],
            [
              "平方米 → m2；公顷 → hectare；亩 → 666.67 m2；英亩 / 平方英尺 → acre / sqft",
              "Area",
              "1亩 to 平方米 → 666.6667 m2",
            ],
            [
              "天 / 日 → day；周 / 星期 → week；月 → month；年 → year",
              "Duration",
              "3天 to 小时 → 72 hour",
            ],
            [
              "摄氏度 → degC；华氏度 → degF；开尔文 → K",
              "Temperature",
              "100 celsius to fahrenheit → 212 degf",
            ],
            [
              "公里每小时 / 千米每小时 → km/hour；英里每小时 / mph；节 → knot",
              "Speed",
              "20节 + 1 km/h → 38.04 km / hour",
            ],
          ],
        },
        {
          title: "Energy, power & more",
          termLines: true,
          rows: [
            [
              "焦 / 焦耳 → J；千焦 → kJ；卡 / 卡路里 → cal；千卡 / 大卡 → kcal",
              "Energy",
              "1卡 to 焦 → 4.184 j",
            ],
            [
              "瓦时 → Wh；千瓦时 → kWh；英热单位 → BTU；电子伏 → eV",
              "Energy",
              "1 kWh to J → 3,600,000 j",
            ],
            ["瓦 / 瓦特 → W；千瓦 → kW；马力 → hp", "Power", "1 hp to W → 745.6999 w"],
            [
              "牛 / 牛顿 → N；磅力 → lbf；帕 / 帕斯卡 → Pa；千帕 / 巴 / 标准大气压 → kPa / bar / atm",
              "Force & pressure",
              "1 atm to kPa → 101.325 kpa",
            ],
            [
              "安 / 伏 / 欧姆 / 赫兹 → A / V / ohm / Hz",
              "Electricity & frequency",
              "1 kHz to Hz → 1,000 hz",
            ],
            [
              "比特 / 字节 → bit / B；千字节 / 兆字节 / 吉字节 → kB / MB / GB",
              "Data",
              "1 GB to MB → 1,000 MB",
            ],
          ],
        },
        {
          title: "Mixing & display rules",
          termLines: true,
          rows: [
            ["Metric wins", "Imperial leans metric when mixed", "1 mile + 1 km → 2.609344 km"],
            [
              "Pure imperial",
              "Without metric in the line, smaller units win",
              "1 mile + 1 ft → 5,281 foot",
            ],
            [
              "Smaller units win",
              "Within a system, finer units win; metric > imperial > market",
              "2 km + 500 m → 2,500 m",
            ],
            [
              "Language priority",
              "Settings “unit style” > English > Chinese in the formula",
              "(1米+25毫米)×100元/米 → 102.5 cny",
            ],
            [
              "Canonical Chinese",
              "Multiple Chinese names converge to the canonical one (千克 > 公斤)",
              "70公斤 + 1千克 → 71 kg",
            ],
            ["Same-dimension division", "Cancels to a plain number", "10.2克 / 100克 → 0.102"],
            [
              "Written form kept",
              "Results keep the first operand's unit and prefix",
              "1500毫克 → 1,500 mg",
            ],
            [
              "Explicit to",
              "The target unit is shown as written, no further conversion",
              "5 km to mile → 3.1069 mile",
            ],
            [
              "Powers",
              "Use ^ for compound-unit powers; m/s2 is an unknown symbol",
              "1 m/s^2 → 1 m / second^2",
            ],
          ],
        },
        {
          title: "Currency & symbols",
          termLines: true,
          rows: [
            ["¥ → CNY；$ → USD；€ → EUR；£ → GBP", "Currency symbols", "$20 + 5 USD → 25 USD"],
            [
              "元 / 人民币 → CNY；美元 / 欧元 / 英镑 → USD / EUR / GBP",
              "Currency names",
              "¥30 + 12 CNY → 42 CNY",
            ],
            ["Currency rule", "Only same-currency amounts add up", "10 CNY + 5 USD → error"],
          ],
        },
      ],
    };
  }
  return {
    title: "像写字一样，自然地计算。",
    closeHelp: "关闭语法速查",
    tabsAria: "语法速查分类",
    errorWord: "报错",
    headers: ["写法", "作用", "例子"],
    notes: [
      "字母 x 也可以表示乘法，例如 2x3；[]、{} 和 () 都可以用作括号。括号最多嵌套 3 层，嵌套形态固定为 {[( )]}：最内层 ()，向外 []、{}。",
      "# 开头写标题，// 写注释，标签： 为算式加说明。空行开始一个新的汇总段落。",
    ],
    tabs: [
      { id: "examples", label: "算式示例" },
      { id: "functions", label: "函数与常量" },
      { id: "aggregates", label: "魔术词与变量" },
      { id: "keywords", label: "关键字" },
      { id: "units", label: "单位与符号" },
    ],
    examples: [
      ["四则与括号", "(18 + 24) × 3", "126"],
      ["定义变量", "价格 = 128\n价格 × 3", "384"],
      ["加上百分比", "200 + 10%", "220"],
      ["求百分比", "20% of 150", "30"],
      ["单位换算", "5 km to m", "5,000 m"],
      ["时间长度", "90 min to hour", "1.5 hour"],
      ["分段汇总", "24\n36\nsum", "60"],
      ["上一行结果", "12 × 3\nprev + 4", "40"],
    ],
    functionGroups: [
      {
        title: "函数",
        rows: [
          ["sqrt(x)", "平方根", "sqrt(144) → 12"],
          ["abs(x)", "绝对值", "abs(-5) → 5"],
          ["round(x, n)", "四舍五入，可带小数位", "round(2.345, 2) → 2.35"],
          ["ceil(x)", "向上取整", "ceil(2.1) → 3"],
          ["floor(x)", "向下取整", "floor(2.9) → 2"],
        ],
      },
      {
        title: "常量",
        rows: [
          ["pi", "圆周率 π", "pi × 2 → 6.2832"],
          ["e", "自然常数", "e^2 → 7.3891"],
        ],
      },
    ],
    aggregateGroups: [
      {
        title: "魔术词",
        rows: [
          ["sum / total / 合计", "汇总本段（空行分隔）所有成功计算行", "24\n36\nsum → 60"],
          ["avg / average / 平均", "本段成功行的算术平均", "10\n20\navg → 15"],
          ["prev", "上一个成功结果；标题、注释、空行不清除，错误会清除", "12 × 3\nprev + 4 → 40"],
        ],
      },
      {
        title: "操作符",
        rows: [
          ["of / on / off", "百分比短语", "20% of 150 → 30；10% on 200 → 220；10% off 200 → 180"],
          ["to / in / into / as", "单位转换", "5 km to m → 5,000 m"],
          ["plus / minus / times / divided by", "英文运算词", "8 times 9 → 72"],
        ],
      },
      {
        title: "变量与标签",
        rows: [
          ["名称 = 算式", "定义变量，可被后文引用，重新赋值会更新后文", "价格 = 128 → 128"],
          ["说明: 算式", "冒号前是文字标签，不参与计算", "合计: 36 + 6 → 42"],
          ["变量名规则", "支持中英文、数字和下划线，不能以数字开头", "sum=9 → 报错"],
          ["保留字", "有含义的词是保留字，不能做变量名", "sum=9 → 报错"],
        ],
      },
    ],
    keywordGroups: [
      {
        title: "单位与百分比",
        rows: [
          ["to / in / into / as", "单位转换词", "5 km to m → 5,000 m"],
          ["of", "百分比短语", "20% of 150 → 30"],
          ["on / off", "百分比加减", "10% on 200 → 220；off → 180"],
        ],
      },
      {
        title: "运算与行语法",
        rows: [
          ["plus / minus / times / divided by", "英文运算词", "8 times 9 → 72"],
          ["数字:数字", "两个数字之间是比率，等价除法", "16:9 → 1.7778"],
          [
            "% / ‰",
            "百分号右侧相对左值；千分号按千分之一（10‰ = 1%）",
            "200 + 10% → 220；200 + 10‰ → 202；50‰ → 0.05",
          ],
          ["# 和 //", "注释或标题，不计算", "# 旅行预算"],
        ],
      },
    ],
    unitGroups: [
      {
        title: "公制与英制（中英都认识，混算并入公制）",
        termLines: true,
        rows: [
          [
            "公里 / 千米 → km；米 → m；厘米 / 公分 → cm；毫米 / 微米 / 纳米 → mm / um / nm",
            "长度",
            "1英里 + 1公里 → 2.6093公里",
          ],
          [
            "英寸 / 英尺 / 码 → inch / foot / yard；英里 / 海里 → mile / nmi",
            "长度（英制）",
            "10磅 to 千克 → 4.5359千克",
          ],
          [
            "吨 → t；千克 / 公斤 → kg；克 → g；毫克 / 微克 → mg / ug",
            "质量",
            "1 lb + 1 kg → 1.4536 kg",
          ],
          [
            "里 → 500 m；斤 → 500 g；两 → 50 g；钱 → 5 g；石 → 100 L",
            "市制单位",
            "1斤 + 10两 → 2斤",
          ],
          ["磅 / 盎司 / 英石 → lb / oz / stone", "质量（英制）", "2斤 to 克 → 1,000克"],
          [
            "升 → l；毫升 / 厘升 / 分升 → ml / cl / dl；立方米 → m3",
            "体积",
            "2加仑 to 升 → 7.5708升",
          ],
          [
            "加仑 / 品脱 / 夸脱 → gallon / pint / quart；杯 / 汤匙 / 茶匙 → cup / tablespoon / teaspoon",
            "体积（英制）",
            "1 gal + 1 l → 4.7854 l",
          ],
          [
            "平方米 → m2；公顷 → hectare；亩 → 666.67 m2；英亩 / 平方英尺 → acre / sqft",
            "面积",
            "1亩 to 平方米 → 666.6667平方米",
          ],
          [
            "天 / 日 → day；周 / 星期 → week；月 → month；年 → year",
            "时长",
            "3天 to 小时 → 72小时",
          ],
          [
            "摄氏度 → degC；华氏度 → degF；开尔文 → K",
            "温度",
            "100 celsius to fahrenheit → 212 degf",
          ],
          [
            "公里每小时 / 千米每小时 → km/hour；英里每小时 / mph；节 → knot",
            "速度",
            "20节 + 1 km/h → 38.04公里/小时",
          ],
        ],
      },
      {
        title: "能量、功率与其他",
        termLines: true,
        rows: [
          [
            "焦 / 焦耳 → J；千焦 → kJ；卡 / 卡路里 → cal；千卡 / 大卡 → kcal",
            "能量",
            "1卡 to 焦 → 4.184焦",
          ],
          [
            "瓦时 → Wh；千瓦时 → kWh；英热单位 → BTU；电子伏 → eV",
            "能量",
            "1 kWh to J → 3,600,000 j",
          ],
          ["瓦 / 瓦特 → W；千瓦 → kW；马力 → hp", "功率", "1 hp to W → 745.6999 w"],
          [
            "牛 / 牛顿 → N；磅力 → lbf；帕 / 帕斯卡 → Pa；千帕 / 巴 / 标准大气压 → kPa / bar / atm",
            "力与压强",
            "1 atm to kPa → 101.325 kpa",
          ],
          ["安 / 伏 / 欧姆 / 赫兹 → A / V / ohm / Hz", "电学与频率", "1 kHz to Hz → 1,000 hz"],
          [
            "比特 / 字节 → bit / B；千字节 / 兆字节 / 吉字节 → kB / MB / GB",
            "数据",
            "1 GB to MB → 1,000 MB",
          ],
        ],
      },
      {
        title: "混算与显示规则",
        termLines: true,
        rows: [
          ["公制英制混算", "英制并入公制，结果以公制呈现", "1 mile + 1 km → 2.609344 km"],
          ["纯英制", "没有公制参与时向更小的单位靠拢", "1 mile + 1 ft → 5,281 foot"],
          ["颗粒对齐", "同制式内颗粒小的单位优先；公制 > 英制 > 市制", "2 km + 500 m → 2,500 m"],
          [
            "语言优先级",
            "设置「单位写法」> 算式中文 > 英文小写 > 英文大写",
            "(1米+25毫米)×100元/米 → 102.5元",
          ],
          [
            "中文写法收敛",
            "同一单位多种写法并存时取规范名（千克 > 公斤）",
            "70公斤 + 1千克 → 71千克",
          ],
          ["同量纲相除", "约分成纯数字", "10.2克 / 100克 → 0.102"],
          ["保留写法", "结果保留该行第一个操作数的单位与前缀", "1500毫克 → 1,500毫克"],
          ["显式 to", "目标单位不再自动换算，名称按语言优先级呈现", "5 km to mile → 3.1069 mile"],
          ["幂的写法", "复合单位幂用 ^，m/s2 会当成未知符号", "1 m/s^2 → 1 m / second^2"],
        ],
      },
      {
        title: "货币与符号",
        termLines: true,
        rows: [
          ["¥ → CNY；$ → USD；€ → EUR；£ → GBP", "货币符号", "$20 + 5 USD → 25 USD"],
          [
            "元 / 人民币 → CNY；美元 / 欧元 / 英镑 → USD / EUR / GBP",
            "货币中文名",
            "¥30 + 12 CNY → 42 CNY",
          ],
          ["币种规则", "同币种可加减", "10 CNY + 5 USD → 报错"],
        ],
      },
    ],
  };
}

// 单元格富文本：「报错/error」用出错颜色，「→」用强调色。
function makeRenderCell(errorWord: string) {
  return function renderCell(text: string) {
    const arrowParts = text.split("→");
    return arrowParts.map((part, partIndex) => {
      const segments = part.split(errorWord);
      const rendered = segments.map((segment, segmentIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态切分结果，位置即稳定键
        <span key={segmentIndex}>
          {segmentIndex > 0 && <span className="help-error-word">{errorWord}</span>}
          {segment}
        </span>
      ));
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态切分结果，位置即稳定键
        <span key={partIndex}>
          {partIndex > 0 && <span className="help-arrow">→</span>}
          {rendered}
        </span>
      );
    });
  };
}

// 单位清单一格：按「；」拆行，每行独立芯片，分号不显示。
function renderTermLines(text: string, renderCell: (text: string) => ReactNode) {
  return text.split("；").map((segment) => (
    <span key={segment} className="term-line">
      {renderCell(segment)}
    </span>
  ));
}

export function HelpDialog({
  lang,
  onClose,
  onInsert,
}: {
  lang: Lang;
  onClose: () => void;
  onInsert: (source: string) => void;
}) {
  const content = contentFor(lang);
  const renderCell = makeRenderCell(content.errorWord);
  const reservedGroups = reservedGroupsFor(lang);
  const [active, setActive] = useState<(typeof content.tabs)[number]["id"]>("examples");
  return (
    <Dialog className="help-dialog" label={content.tabsAria} onClose={onClose}>
      <div className="help-heading">
        <div>
          <h2 id="help-title">{content.title}</h2>
        </div>
        <IconButton title={content.closeHelp} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div
        className="help-tabs"
        role="tablist"
        aria-label={content.tabsAria}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = content.tabs.findIndex((tab) => tab.id === active);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % content.tabs.length
              : (index - 1 + content.tabs.length) % content.tabs.length;
          setActive(content.tabs[next].id);
          document.getElementById(`help-tab-${content.tabs[next].id}`)?.focus();
        }}
      >
        {content.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`help-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`help-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            className={active === tab.id ? "is-active" : ""}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="help-tabpanel"
        role="tabpanel"
        id="help-panel-examples"
        aria-labelledby="help-tab-examples"
        hidden={active !== "examples"}
      >
        <div className="syntax-examples">
          {content.examples.map(([name, expression, result]) => (
            <button
              type="button"
              key={name}
              onClick={() => {
                onInsert(`\n${expression}\n`);
                onClose();
              }}
            >
              <span>{name}</span>
              <code>{expression.replaceAll("\n", " → ")}</code>
              <strong>
                {result}
                <ArrowUpRight size={14} />
              </strong>
            </button>
          ))}
        </div>
        <div className="help-notes">
          <p>{content.notes[0]}</p>
          <p>{content.notes[1]}</p>
        </div>
      </div>
      {(
        [
          ["functions", content.functionGroups],
          ["aggregates", content.aggregateGroups],
          ["keywords", [...reservedGroups, ...content.keywordGroups]],
          ["units", content.unitGroups],
        ] as const
      ).map(([id, groups]) => (
        <div
          key={id}
          className="help-tabpanel"
          role="tabpanel"
          id={`help-panel-${id}`}
          aria-labelledby={`help-tab-${id}`}
          hidden={active !== id}
        >
          {groups.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <table>
                <thead>
                  <tr>
                    {content.headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(([term, role, example]) => (
                    <tr key={term}>
                      <td className={group.termLines ? "term-lines" : undefined}>
                        <code>
                          {group.termLines ? renderTermLines(term, renderCell) : renderCell(term)}
                        </code>
                      </td>
                      <td>{renderCell(role)}</td>
                      <td>
                        <code>{renderCell(example.replaceAll("\n", " → "))}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ))}
    </Dialog>
  );
}
