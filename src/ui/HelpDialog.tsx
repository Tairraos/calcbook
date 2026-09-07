import { ArrowUpRight, X } from "lucide-react";
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

export function HelpDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (source: string) => void;
}) {
  return (
    <Dialog className="help-dialog" label="语法速查" onClose={onClose}>
      <div className="help-heading">
        <div>
          <span className="eyebrow">A LITTLE FIELD GUIDE</span>
          <h2 id="help-title">像写字一样，自然地计算。</h2>
        </div>
        <IconButton title="关闭语法速查" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <p className="help-intro">点一个例子，放进笔记试试看。更改数字，结果会自动更新。</p>
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
          <code>x</code> 也可以表示乘法，例如 <code>2x3</code>；<code>[]</code>、<code>{"{}"}</code>{" "}
          和 <code>()</code> 都可以用作括号。
        </p>
        <p>
          <code>#</code> 开头写标题，<code>{"//"}</code> 写注释，<code>标签：</code>{" "}
          为算式加说明。空行开始一个新的汇总段落。
        </p>
        <p>
          支持中英文变量、常用单位、同币种金额，以及 sqrt / abs / round / ceil /
          floor。不同币种暂不换算。
        </p>
      </div>
      <div className="help-shortcuts">
        <span>
          <kbd>⌘ / Ctrl</kbd> <kbd>N</kbd> 新建
        </span>
        <span>
          <kbd>⌘ / Ctrl</kbd> <kbd>K</kbd> 搜索
        </span>
        <span>
          <kbd>⌘ / Ctrl</kbd> <kbd>⇧ C</kbd> 复制行结果
        </span>
      </div>
    </Dialog>
  );
}
