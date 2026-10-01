import { ExternalLink, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { type FormatSettings, UNIT_STYLES, UNIT_SYSTEMS } from "../domain/formatting.ts";
import { DEFAULT_HISTORY_LIMIT_KB, MAX_HISTORY_LIMIT_KB } from "../domain/notebook.ts";
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
  { key: "operatorSpace", label: "运算符两边空格", hint: "+ - × ÷ / =" },
  { key: "commentSpace", label: "注释符号后空格", hint: "#标题 → # 标题" },
];

export function SettingsDialog({
  directory,
  defaultDirectory,
  canChooseDirectory,
  format,
  onChangeFormat,
  historyLimitKB,
  onChangeHistoryLimit,
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
  historyLimitKB: number;
  onChangeHistoryLimit: (limitKB: number) => void;
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
  // 历史空间输入的草稿：只允许数字，失焦或回车时钳制提交
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const commitHistoryLimit = () => {
    const draft = limitDraft;
    setLimitDraft(null);
    if (draft === null) return;
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_HISTORY_LIMIT_KB) {
      onChangeHistoryLimit(parsed);
    }
  };
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

        <section className="settings-section" aria-labelledby="history-title">
          <div className="settings-row">
            <h3 id="history-title">编辑历史</h3>
            <span className="history-limit">
              <span className="history-limit-label">为每个笔记分配历史版本空间</span>
              <input
                className="history-limit-input"
                inputMode="numeric"
                autoComplete="off"
                value={limitDraft ?? String(historyLimitKB)}
                aria-label="为每个笔记分配历史版本空间（KB）"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                  setLimitDraft(digits);
                }}
                onBlur={commitHistoryLimit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              KB
            </span>
          </div>
          <p className="setting-hint">
            默认 {DEFAULT_HISTORY_LIMIT_KB} KB。设为 0 关闭历史，将删除所有历史版本记录——
            编辑到哪篇或重启应用时才删除，重启前可反悔；达到上限时从最早的快照开始淘汰，
            最新一份始终保留。
          </p>
        </section>

        <section className="settings-section" aria-labelledby="format-toggles-title">
          <div className="settings-row">
            <h3 id="format-toggles-title">格式化 - 空格与数字</h3>
          </div>
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
        </section>

        <section className="settings-section" aria-labelledby="format-style-title">
          <div className="format-radio-groups">
            <div
              role="radiogroup"
              aria-labelledby="format-style-title"
              className="format-radio-col"
            >
              <p className="format-group-label" id="format-style-title">
                格式化 - 单位写法
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
                格式化 - 单位制
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
        </section>

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
