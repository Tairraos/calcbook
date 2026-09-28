import { ExternalLink, FolderOpen, X } from "lucide-react";
import { useState } from "react";
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
  { key: "thousands", label: "千分位逗号", hint: "1,234,567" },
  { key: "unitSpace", label: "数字与单位空格", hint: "100L → 100 L" },
  { key: "percentSpace", label: "百分号前空格", hint: "10% → 10 %" },
  { key: "operatorSpace", label: "运算符两边空格", hint: "+ - * / =" },
  { key: "commentSpace", label: "注释符号后空格", hint: "#标题 → # 标题" },
];

export function SettingsDialog({
  directory,
  defaultDirectory,
  canChooseDirectory,
  format,
  onChangeFormat,
  version,
  buildTime,
  githubUrl,
  saveStatus,
  saveError,
  onChangeDirectory,
  onOpenProject,
  onClose,
}: {
  directory: string;
  defaultDirectory: string;
  canChooseDirectory: boolean;
  format: FormatSettings;
  onChangeFormat: (settings: FormatSettings) => void;
  version: string;
  buildTime: string;
  githubUrl: string;
  saveStatus: string;
  saveError: string;
  onChangeDirectory: () => Promise<boolean>;
  onOpenProject: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function changeDirectory() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      if (await onChangeDirectory()) setMessage("存储位置已更新，现有笔记已复制过去。");
    } catch (reason) {
      setFailed(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      className="settings-dialog"
      label="设置"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="settings-heading">
        <div>
          <h2>设置</h2>
          <p>给你的思路，选一个舒服的空间。</p>
        </div>
        <IconButton title="关闭设置" onClick={onClose} disabled={busy}>
          <X size={19} />
        </IconButton>
      </div>

      <div className="settings-body">
        <section className="settings-section" aria-labelledby="storage-title">
          <div className="settings-row">
            <h3 id="storage-title">文件存放位置</h3>
            <button
              className="secondary-button"
              type="button"
              disabled={!canChooseDirectory || busy}
              onClick={() => void changeDirectory()}
            >
              <FolderOpen size={14} />
              {busy ? "正在更改…" : "选择文件夹"}
            </button>
          </div>
          <code className="storage-path" title={directory}>
            {directory}
          </code>
          <p className="setting-hint" title={defaultDirectory}>
            {canChooseDirectory
              ? "默认 ~/.calcbook。更改位置会复制当前笔记，原文件仍会保留。"
              : "浏览器预览保存在此浏览器中。桌面版默认使用 ~/.calcbook，可选择其他文件夹。"}
          </p>
          {message && (
            <p
              className={`setting-message ${failed ? "save-error" : ""}`}
              role={failed ? "alert" : "status"}
            >
              {message}
            </p>
          )}
        </section>

        <fieldset className="settings-section" aria-labelledby="format-title">
          <legend id="format-title">格式</legend>
          <p className="setting-hint format-lead">
            算式的书写规范，改动立即生效；点顶栏「格式化」应用到当前笔记。
          </p>
          <p className="format-group-label" id="format-toggles-title">
            空格与数字
          </p>
          <div className="format-toggles">
            {TOGGLES.map(({ key, label, hint }) => (
              <label className="format-option" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(format[key])}
                  onChange={(event) => onChangeFormat({ ...format, [key]: event.target.checked })}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="format-radio-groups">
            <div
              role="radiogroup"
              aria-labelledby="format-style-title"
              className="format-radio-col"
            >
              <p className="format-group-label" id="format-style-title">
                单位写法
              </p>
              <div className="format-radio-row">
                {UNIT_STYLES.map((value) => (
                  <label className="format-pill" key={value}>
                    <input
                      type="radio"
                      name="format-unit-style"
                      value={value}
                      checked={format.unitStyle === value}
                      onChange={() => onChangeFormat({ ...format, unitStyle: value })}
                    />
                    {STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value}
                  </label>
                ))}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-labelledby="format-system-title"
              className="format-radio-col"
            >
              <p className="format-group-label" id="format-system-title">
                单位制
              </p>
              <div className="format-radio-row">
                {UNIT_SYSTEMS.map((value) => (
                  <label className="format-pill" key={value}>
                    <input
                      type="radio"
                      name="format-unit-system"
                      value={value}
                      checked={format.unitSystem === value}
                      onChange={() => onChangeFormat({ ...format, unitSystem: value })}
                    />
                    {SYSTEM_OPTIONS.find((option) => option.value === value)?.label ?? value}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <p className="setting-hint">
            自由：保留原文写法。公制/英制/市制：格式化时把一行里的其它制式换算过来（公制 &gt; 英制
            &gt; 市制）。
          </p>
        </fieldset>

        <section className="settings-section about-section" aria-labelledby="about-title">
          <div className="about-brand">
            <div>
              <h3 id="about-title">关于 Calcbook</h3>
              <span>一个优雅的笔记计算器，像写字一样计算。</span>
            </div>
          </div>
          <dl className="about-details">
            <div>
              <dt>版本</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>构建时间</dt>
              <dd>
                <time dateTime={buildTime}>
                  {new Date(buildTime).toLocaleString("zh-CN", { hour12: false })}
                </time>
              </dd>
            </div>
          </dl>
          <a
            className="project-link"
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void onOpenProject().catch((reason: unknown) => {
                setFailed(true);
                setMessage(reason instanceof Error ? reason.message : String(reason));
              });
            }}
          >
            GitHub · Tairraos/calcbook
            <ExternalLink size={12} />
          </a>
        </section>
      </div>

      <div className="settings-footer">
        <span className={saveError ? "save-error" : ""} role="status">
          {saveError || (saveStatus === "saved" ? "设置已自动保存" : "正在保存…")}
        </span>
        <button type="button" className="primary-button" onClick={onClose} disabled={busy}>
          完成
        </button>
      </div>
    </Dialog>
  );
}
