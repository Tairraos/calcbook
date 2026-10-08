import { ExternalLink, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { type FormatSettings, UNIT_STYLES, UNIT_SYSTEMS } from "../domain/formatting.ts";
import type { Lang } from "../domain/messages.ts";
import { DEFAULT_HISTORY_LIMIT_KB, MAX_HISTORY_LIMIT_KB } from "../domain/notebook.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";
import { formatBuildTime, makeT } from "./i18n.ts";

// 选项标签按界面语言显示；存进工作区的仍是 value 本身。
const STYLE_LABELS = {
  free: { zh: "自由", en: "Free" },
  chinese: { zh: "中文", en: "中文" },
  upper: { zh: "英文大写", en: "EN upper" },
  lower: { zh: "英文小写", en: "EN lower" },
} as const;
const SYSTEM_LABELS = {
  free: { zh: "自由", en: "Free" },
  metric: { zh: "公制", en: "Metric" },
  imperial: { zh: "英制", en: "Imperial" },
  market: { zh: "市制", en: "Market" },
} as const;

const TOGGLES: {
  key:
    | "thousands"
    | "resultThousands"
    | "unitSpace"
    | "percentSpace"
    | "operatorSpace"
    | "commentSpace";
  labelKey: Parameters<ReturnType<typeof makeT>>[0];
}[] = [
  { key: "thousands", labelKey: "toggleNoteThousands" },
  { key: "resultThousands", labelKey: "toggleResultThousands" },
  { key: "unitSpace", labelKey: "toggleUnitSpace" },
  { key: "percentSpace", labelKey: "togglePercentSpace" },
  { key: "operatorSpace", labelKey: "toggleOperatorSpace" },
  { key: "commentSpace", labelKey: "toggleCommentSpace" },
];

export function SettingsDialog({
  lang,
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
  lang: Lang;
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
  const t = makeT(lang);
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
      if (await onChangeDirectory()) setMessage(t("storageMoved"));
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
      label={t("settingsLabel")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="settings-heading">
        <div>
          <h2>{t("settingsLabel")}</h2>
          <p>{t("settingsTagline")}</p>
        </div>
        <IconButton title={t("closeSettings")} onClick={onClose} disabled={busy}>
          <X size={19} />
        </IconButton>
      </div>

      <div className="settings-body">
        <section className="settings-section" aria-labelledby="storage-title">
          <div className="settings-row">
            <h3 id="storage-title">{t("storageTitle")}</h3>
            <button
              className="secondary-button"
              type="button"
              disabled={!canChooseDirectory || busy}
              onClick={() => void changeDirectory()}
            >
              <FolderOpen size={14} />
              {busy ? t("choosing") : t("chooseFolder")}
            </button>
          </div>
          <code className="storage-path" title={directory}>
            {directory}
          </code>
          <p className="setting-hint" title={defaultDirectory}>
            {canChooseDirectory ? t("storageHintDesktop") : t("storageHintWeb")}
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
            <h3 id="history-title">{t("historyTitle")}</h3>
            <span className="history-limit">
              <span className="history-limit-label">{t("historyPerNote")}</span>
              <input
                className="history-limit-input"
                inputMode="numeric"
                autoComplete="off"
                value={limitDraft ?? String(historyLimitKB)}
                aria-label={t("historyPerNoteAria")}
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
          <p className="setting-hint">{t("historyHint", { default: DEFAULT_HISTORY_LIMIT_KB })}</p>
        </section>

        <section className="settings-section" aria-labelledby="format-toggles-title">
          <div className="settings-row">
            <h3 id="format-toggles-title">{t("formatSpaces")}</h3>
          </div>
          <div className="format-toggles">
            {TOGGLES.map(({ key, labelKey }) => (
              <label className="format-option" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(format[key])}
                  onChange={(event) => onChangeFormat({ ...format, [key]: event.target.checked })}
                />
                <span>
                  <strong>{t(labelKey)}</strong>
                  <small>{TOGGLE_HINTS[lang][key]}</small>
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
                {t("formatUnitStyle")}
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
                    {STYLE_LABELS[value][lang]}
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
                {t("formatUnitSystem")}
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
                    {SYSTEM_LABELS[value][lang]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <p className="setting-hint">{t("systemHint")}</p>
        </section>

        <section className="settings-section about-section" aria-labelledby="about-title">
          <div className="about-brand">
            <div>
              <h3 id="about-title">{t("aboutTitle")}</h3>
              <span>{t("aboutTagline")}</span>
            </div>
          </div>
          <dl className="about-details">
            <div>
              <dt>{t("version")}</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>{t("buildTime")}</dt>
              <dd>
                <time dateTime={buildTime}>{formatBuildTime(buildTime, lang)}</time>
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
          {saveError || (saveStatus === "saved" ? t("settingsSaved") : t("saving"))}
        </span>
        <button type="button" className="primary-button" onClick={onClose} disabled={busy}>
          {t("done")}
        </button>
      </div>
    </Dialog>
  );
}

// 开关示例（小字）：按语言成对维护，键与 TOGGLES 对齐。
const TOGGLE_HINTS: Record<
  Lang,
  Record<
    | "thousands"
    | "resultThousands"
    | "unitSpace"
    | "percentSpace"
    | "operatorSpace"
    | "commentSpace",
    string
  >
> = {
  zh: {
    thousands: "正文 1,234,567",
    resultThousands: "结果列 1,234,567",
    unitSpace: "100L → 100 L",
    percentSpace: "10% → 10 %",
    operatorSpace: "+ - × ÷ / =",
    commentSpace: "#标题 → # 标题",
  },
  en: {
    thousands: "Body 1,234,567",
    resultThousands: "Results 1,234,567",
    unitSpace: "100L → 100 L",
    percentSpace: "10% → 10 %",
    operatorSpace: "+ - × ÷ / =",
    commentSpace: "#Title → # Title",
  },
};
