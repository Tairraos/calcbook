import { ExternalLink, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { UNIT_MODES, type UnitMode } from "../domain/units.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

const UNIT_MODE_OPTIONS: { value: UnitMode; label: string; hint: string }[] = [
  {
    value: "free",
    label: "自由单位",
    hint: "整篇可用各种单位；同一行中英文混用时统一成中文，公制英制混算时结果并入公制。",
  },
  {
    value: "chinese",
    label: "中文单位",
    hint: "光标离开刚算完的行时，把该行单位改写成中文，如 100L → 100升。",
  },
  {
    value: "english",
    label: "英文单位",
    hint: "光标离开刚算完的行时，把该行单位改写成英文，如 100升 → 100 L。",
  },
];

export function SettingsDialog({
  directory,
  defaultDirectory,
  canChooseDirectory,
  unitMode,
  onChangeUnitMode,
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
  unitMode: UnitMode;
  onChangeUnitMode: (mode: UnitMode) => void;
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

      <fieldset className="settings-section" aria-labelledby="units-title">
        <legend id="units-title">单位写法</legend>
        <div className="unit-mode-group" role="radiogroup" aria-labelledby="units-title">
          {UNIT_MODES.map((value) => {
            const option = UNIT_MODE_OPTIONS.find((item) => item.value === value);
            if (!option) return null;
            return (
              <label className="unit-mode-option" key={value}>
                <input
                  type="radio"
                  name="unit-mode"
                  value={value}
                  checked={unitMode === value}
                  onChange={() => onChangeUnitMode(value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            );
          })}
        </div>
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
