import { X } from "lucide-react";
import { type FormatSettings, UNIT_STYLES, UNIT_SYSTEMS } from "../domain/formatting.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

const STYLE_OPTIONS: { value: FormatSettings["unitStyle"]; label: string }[] = [
  { value: "free", label: "自由" },
  { value: "chinese", label: "中文" },
  { value: "upper", label: "英文大写" },
  { value: "lower", label: "英文小写" },
];
const SYSTEM_OPTIONS: { value: FormatSettings["unitSystem"]; label: string }[] = [
  { value: "free", label: "自由" },
  { value: "metric", label: "公制" },
  { value: "imperial", label: "英制" },
  { value: "market", label: "市制" },
];

const TOGGLES: { key: keyof FormatSettings; label: string; hint: string }[] = [
  { key: "thousands", label: "千分位逗号", hint: "数字每三位加逗号，如 1,234,567" },
  { key: "unitSpace", label: "数字与单位之间空格", hint: "100L → 100 L" },
  { key: "percentSpace", label: "数字和百分号之间空格", hint: "10% → 10 %" },
  { key: "operatorSpace", label: "运算符两边空格", hint: "运算符为 + - * / =" },
  { key: "commentSpace", label: "注释符号后空格", hint: "#标题 → # 标题" },
];

export function FormatDialog({
  settings,
  onChange,
  onApply,
  onClose,
}: {
  settings: FormatSettings;
  onChange: (settings: FormatSettings) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog className="format-dialog" label="格式设置" onClose={onClose}>
      <div className="settings-heading">
        <div>
          <h2>格式</h2>
          <p>设置算式的书写规范，点「格式化本页」应用到当前笔记。</p>
        </div>
        <IconButton title="关闭格式设置" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>

      <fieldset className="settings-section" aria-labelledby="format-toggles-title">
        <legend id="format-toggles-title">空格与数字</legend>
        {TOGGLES.map(({ key, label, hint }) => (
          <label className="format-option" key={key}>
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}
            />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="settings-section" aria-labelledby="format-style-title">
        <legend id="format-style-title">单位使用</legend>
        <div className="format-radio-row" role="radiogroup" aria-labelledby="format-style-title">
          {UNIT_STYLES.map((value) => (
            <label className="format-pill" key={value}>
              <input
                type="radio"
                name="format-unit-style"
                value={value}
                checked={settings.unitStyle === value}
                onChange={() => onChange({ ...settings, unitStyle: value })}
              />
              {STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-section" aria-labelledby="format-system-title">
        <legend id="format-system-title">单位制</legend>
        <div className="format-radio-row" role="radiogroup" aria-labelledby="format-system-title">
          {UNIT_SYSTEMS.map((value) => (
            <label className="format-pill" key={value}>
              <input
                type="radio"
                name="format-unit-system"
                value={value}
                checked={settings.unitSystem === value}
                onChange={() => onChange({ ...settings, unitSystem: value })}
              />
              {SYSTEM_OPTIONS.find((option) => option.value === value)?.label ?? value}
            </label>
          ))}
        </div>
        <p className="setting-hint">
          自由：保留原文写法。公制/英制/市制：格式化时把一行里的其它制式换算过来（公制 &gt; 英制
          &gt; 市制）。
        </p>
      </fieldset>

      <div className="settings-footer">
        <button type="button" className="primary-button" onClick={onApply}>
          格式化本页
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          完成
        </button>
      </div>
    </Dialog>
  );
}
