import { ArrowUpRight, X } from "lucide-react";
import { useState } from "react";
import { UNITS } from "../domain/units.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

const examples = [
  ["四则与括号", "(18 + 24) × 3", "126"],
  ["定义变量", "价格 = 128\n价格 × 3", "384"],
  ["加上百分比", "200 + 10%", "220"],
  ["求百分比", "20% of 150", "30"],
  ["单位换算", "5 km to m", "5,000 m"],
  ["时间长度", "90 min to hour", "1.5 hour"],
  ["分段汇总", "24\n36\nsum", "60"],
  ["上一行结果", "12 × 3\nprev + 4", "40"],
];

// termLines：写法列是一串单位清单，按「；」分词后每项独占一行、需要时折行，
// 避免整列被最长的一项撑宽。
type ReferenceGroup = { title: string; rows: [string, string, string][]; termLines?: boolean };

const functionGroups: ReferenceGroup[] = [
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
];

const aggregateGroups: ReferenceGroup[] = [
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
];

// 保留字全表：单位（中英对照，来自单位登记表；中文别名并入同一格——公斤是千克的别名，
// 同样是保留字，必须可见）+ 函数/常量/汇总/关键字。
const unitReservedRows: ReferenceGroup["rows"] = [];
const chineseAliases = (entry: (typeof UNITS)[number]) =>
  (entry.aliases ?? []).filter((alias) => /\p{Script=Han}/u.test(alias));
for (let index = 0; index < UNITS.length; index += 4) {
  const chunk = UNITS.slice(index, index + 4);
  unitReservedRows.push([
    chunk
      .map((entry) => [entry.zh, ...chineseAliases(entry)].join(" / ") + ` → ${entry.en}`)
      .join("；"),
    "单位",
    "-",
  ]);
}
const reservedGroups: ReferenceGroup[] = [
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

const keywordGroups: ReferenceGroup[] = [
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
];

const unitGroups: ReferenceGroup[] = [
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
      ["里 → 500 m；斤 → 500 g；两 → 50 g；钱 → 5 g；石 → 100 L", "市制单位", "1斤 + 10两 → 2斤"],
      ["磅 / 盎司 / 英石 → lb / oz / stone", "质量（英制）", "2斤 to 克 → 1,000克"],
      ["升 → l；毫升 / 厘升 / 分升 → ml / cl / dl；立方米 → m3", "体积", "2加仑 to 升 → 7.5708升"],
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
      ["天 / 日 → day；周 / 星期 → week；月 → month；年 → year", "时长", "3天 to 小时 → 72小时"],
      ["摄氏度 → degC；华氏度 → degF；开尔文 → K", "温度", "100 celsius to fahrenheit → 212 degf"],
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
      ["瓦时 → Wh；千瓦时 → kWh；英热单位 → BTU；电子伏 → eV", "能量", "1 kWh to J → 3,600,000 j"],
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
        "设置「单位写法」> 中文 > 英文小写 > 英文大写",
        "(1米+25毫米)×100元/米 → 102.5元",
      ],
      ["中文写法收敛", "同一单位多种写法并存时取规范名（千克 > 公斤）", "70公斤 + 1千克 → 71千克"],
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
];

const tabs = [
  { id: "examples", label: "算式示例" },
  { id: "functions", label: "函数与常量" },
  { id: "aggregates", label: "魔术词与变量" },
  { id: "keywords", label: "关键字" },
  { id: "units", label: "单位与符号" },
] as const;

// 单元格富文本：「报错」用出错颜色，「→」用强调色。
function renderCell(text: string) {
  const arrowParts = text.split("→");
  return arrowParts.map((part, partIndex) => {
    const segments = part.split("报错");
    const rendered = segments.map((segment, segmentIndex) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: 静态切分结果，位置即稳定键
      <span key={segmentIndex}>
        {segmentIndex > 0 && <span className="help-error-word">报错</span>}
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
}

// 单位清单一格：按「；」拆行，每行独立芯片，分号不显示。
function renderTermLines(text: string) {
  return text.split("；").map((segment) => (
    <span key={segment} className="term-line">
      {renderCell(segment)}
    </span>
  ));
}

function ReferenceTable({ title, rows, termLines }: ReferenceGroup) {
  return (
    <section>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>写法</th>
            <th>作用</th>
            <th>例子</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([term, role, example]) => (
            <tr key={term}>
              <td className={termLines ? "term-lines" : undefined}>
                <code>{termLines ? renderTermLines(term) : renderCell(term)}</code>
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
  );
}

export function HelpDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (source: string) => void;
}) {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("examples");
  return (
    <Dialog className="help-dialog" label="语法速查" onClose={onClose}>
      <div className="help-heading">
        <div>
          <h2 id="help-title">像写字一样，自然地计算。</h2>
        </div>
        <IconButton title="关闭语法速查" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div
        className="help-tabs"
        role="tablist"
        aria-label="语法速查分类"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = tabs.findIndex((tab) => tab.id === active);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % tabs.length
              : (index - 1 + tabs.length) % tabs.length;
          setActive(tabs[next].id);
          document.getElementById(`help-tab-${tabs[next].id}`)?.focus();
        }}
      >
        {tabs.map((tab) => (
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
          {examples.map(([name, expression, result]) => (
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
          <p>
            字母 <code>x</code> 也可以表示乘法，例如 <code>2x3</code>；<code>[]</code>、
            <code>{"{}"}</code> 和 <code>()</code> 都可以用作括号。括号最多嵌套 3 层，嵌套形态固定为{" "}
            <code>{"{[( )]}"}</code>：最内层 <code>()</code>，向外 <code>[]</code>、
            <code>{"{}"}</code>。
          </p>
          <p>
            <code>#</code> 开头写标题，<code>{"//"}</code> 写注释，<code>标签：</code>{" "}
            为算式加说明。空行开始一个新的汇总段落。
          </p>
        </div>
      </div>
      {(
        [
          ["functions", functionGroups],
          ["aggregates", aggregateGroups],
          ["keywords", [...reservedGroups, ...keywordGroups]],
          ["units", unitGroups],
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
            <ReferenceTable key={group.title} {...group} />
          ))}
        </div>
      ))}
    </Dialog>
  );
}
