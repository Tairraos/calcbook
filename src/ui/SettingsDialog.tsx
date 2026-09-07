import { Check, ExternalLink, FolderOpen, PanelRight, PanelsTopLeft, X } from "lucide-react";
import { useState } from "react";
import type { CalculatorMode, Theme } from "../domain/notebook.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

const themeGroups: { label: string; themes: { id: Theme; name: string }[] }[] = [
  {
    label: "浅色",
    themes: [
      { id: "paper", name: "纸白" },
      { id: "sand", name: "暖砂" },
      { id: "mist", name: "雾蓝" },
    ],
  },
  {
    label: "深色",
    themes: [
      { id: "forest", name: "苔夜" },
      { id: "midnight", name: "午夜" },
      { id: "graphite", name: "石墨" },
    ],
  },
];

export function SettingsDialog({
  theme,
  calculatorMode,
  directory,
  defaultDirectory,
  canChooseDirectory,
  version,
  buildTime,
  githubUrl,
  saveStatus,
  saveError,
  onThemeChange,
  onCalculatorModeChange,
  onChangeDirectory,
  onOpenProject,
  onClose,
}: {
  theme: Theme;
  calculatorMode: CalculatorMode;
  directory: string;
  defaultDirectory: string;
  canChooseDirectory: boolean;
  version: string;
  buildTime: string;
  githubUrl: string;
  saveStatus: string;
  saveError: string;
  onThemeChange: (theme: Theme) => void;
  onCalculatorModeChange: (mode: CalculatorMode) => void;
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

      <fieldset className="settings-section theme-settings" disabled={busy}>
        <legend>主题配色</legend>
        {themeGroups.map((group) => (
          <div className="theme-group" key={group.label}>
            <span className="theme-group-name">{group.label}</span>
            <div className="theme-options">
              {group.themes.map((option) => (
                <label
                  className={`theme-option ${theme === option.id ? "is-selected" : ""}`}
                  key={option.id}
                >
                  <input
                    type="radio"
                    name="theme"
                    aria-label={`${option.name}（${group.label}）`}
                    value={option.id}
                    checked={theme === option.id}
                    onChange={() => onThemeChange(option.id)}
                    className="visually-hidden"
                  />
                  <span className="theme-preview" data-theme={option.id} aria-hidden="true">
                    <span className="theme-preview-sidebar" />
                    <span className="theme-preview-text">
                      12 × 8<span />
                      <span />
                    </span>
                    <strong>96</strong>
                  </span>
                  <span className="theme-option-name">
                    {option.name}
                    {theme === option.id && <Check size={13} />}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="settings-section" disabled={busy}>
        <legend>简易计算器</legend>
        <div className="calculator-options">
          <label className={`mode-option ${calculatorMode === "sidebar" ? "is-selected" : ""}`}>
            <input
              type="radio"
              name="calculator-mode"
              value="sidebar"
              checked={calculatorMode === "sidebar"}
              onChange={() => onCalculatorModeChange("sidebar")}
            />
            <PanelRight size={17} />
            <span>边栏显示</span>
          </label>
          <label className={`mode-option ${calculatorMode === "dialog" ? "is-selected" : ""}`}>
            <input
              type="radio"
              name="calculator-mode"
              value="dialog"
              checked={calculatorMode === "dialog"}
              onChange={() => onCalculatorModeChange("dialog")}
            />
            <PanelsTopLeft size={17} />
            <span>弹窗显示</span>
          </label>
        </div>
        <p className="setting-hint">从顶部打开计算器；弹窗模式下，点击外部任意位置即可关闭。</p>
      </fieldset>

      <section className="settings-section about-section" aria-labelledby="about-title">
        <div className="about-brand">
          <img src="/favicon.svg" alt="" width="33" height="33" />
          <div>
            <h3 id="about-title">关于 Calcbook</h3>
            <span>把计算写进笔记。</span>
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
