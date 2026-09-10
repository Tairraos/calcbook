import { ArrowUpRight, X } from "lucide-react";
import { useState } from "react";
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

type ReferenceGroup = { title: string; rows: [string, string, string][] };

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
      ["pi", "圆周率 π", "pi × 2 → 6.283"],
      ["e", "自然常数", "e^2 → 7.389"],
    ],
  },
];

const aggregateGroups: ReferenceGroup[] = [
  {
    title: "汇总",
    rows: [
      ["sum / total / 合计", "汇总本段（空行分隔）所有成功计算行", "24\n36\nsum → 60"],
      ["avg / average / 平均", "本段成功行的算术平均", "10\n20\navg → 15"],
    ],
  },
  {
    title: "变量与标签",
    rows: [
      ["prev", "上一个成功结果；标题、注释、空行不清除，错误会清除", "12 × 3\nprev + 4 → 40"],
      ["名称 = 算式", "定义变量，可被后文引用，重新赋值会更新后文", "价格 = 128 → 128"],
      ["说明: 算式", "冒号前是文字标签，不参与计算", "合计: 36 + 6 → 42"],
      ["变量名规则", "支持中英文、数字和下划线，不能以数字开头", "sum=9 → 报错"],
      ["保留字", "有含义的词是保留字，不能做变量名", "sum=9 → 报错"],
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
      ["数字:数字", "两个数字之间是比率，等价除法", "16:9 → 1.778"],
      ["%", "右侧百分比相对左值", "200 + 10% → 220"],
      ["# 和 //", "注释或标题，不计算", "# 旅行预算"],
    ],
  },
];

const unitGroups: ReferenceGroup[] = [
  {
    title: "中文单位别名",
    rows: [
      ["公里 / 千米 → km；米 → m；厘米 → cm；毫米 → mm", "长度", "5 公里 to 米 → 5,000 m"],
      ["千克 → kg；克 → g", "质量", "2 千克 + 500 g → 2.5 kg"],
      ["分钟 → minute；小时 → hour；秒 → second", "时长", "90 分钟 to hour → 1.5 hour"],
      ["元 / 人民币 → CNY", "货币", "¥30 + 12 CNY → 42 CNY"],
    ],
  },
  {
    title: "英文与符号",
    rows: [
      ["min / minutes → minute；hrs / hours → hour", "时长别名", "90 min to hour → 1.5 hour"],
      ["¥ → CNY；$ → USD；€ → EUR；£ → GBP", "货币符号", "$20 + 5 USD → 25 USD"],
      ["币种规则", "同币种可加减", "10 CNY + 5 USD → 报错"],
    ],
  },
];

const tabs = [
  { id: "examples", label: "算式示例" },
  { id: "functions", label: "函数与常量" },
  { id: "aggregates", label: "汇总与变量" },
  { id: "keywords", label: "关键字" },
  { id: "units", label: "单位与符号" },
] as const;

function ReferenceTable({ title, rows }: ReferenceGroup) {
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
              <td>
                <code>{term}</code>
              </td>
              <td>{role}</td>
              <td>
                <code>{example.replaceAll("\n", " → ")}</code>
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
            <code>{"{}"}</code> 和 <code>()</code> 都可以用作括号。
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
          ["keywords", keywordGroups],
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
            <ReferenceTable key={group.title} title={group.title} rows={group.rows} />
          ))}
        </div>
      ))}
    </Dialog>
  );
}
