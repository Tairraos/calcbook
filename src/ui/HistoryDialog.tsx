import { CalendarArrowUp, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { parseNoteBody } from "../domain/format.ts";
import type { Lang } from "../domain/messages.ts";
import type { HistoryEntry } from "../domain/notebook.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";
import { makeT } from "./i18n.ts";

// 时间桶 → 友好时间：秒级 `年-月-日-时-分-秒` 显示「9月30日 19:05:30」（英文「Sep 30, 19:05:30」），
// 整点/旧版 `年-月-日-时` 显示「9月30日 19时」（英文「Sep 30, 19:00」）；解析失败原样显示。
export function historyLabel(bucket: string, lang: Lang = "zh"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?$/.exec(bucket);
  if (!match) return bucket;
  const [, year, month, day, hour, minute, second] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!Number.isInteger(monthNumber) || !Number.isInteger(dayNumber)) return bucket;
  if (lang === "en") {
    const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date(Number(year), monthNumber - 1, dayNumber),
    );
    return minute !== undefined && second !== undefined
      ? `${label}, ${hour}:${minute}:${second}`
      : `${label}, ${hour}:00`;
  }
  return minute !== undefined && second !== undefined
    ? `${monthNumber}月${dayNumber}日 ${hour}:${minute}:${second}`
    : `${monthNumber}月${dayNumber}日 ${hour}时`;
}

// 固定尺寸弹窗：左侧历史列表（时间 + 恢复/删除按钮）、右侧内容预览。
// 列表由 App 加载后传入，这里只负责展示与选择；删除经确认弹窗后回调 App。
export function HistoryDialog({
  lang,
  entries,
  onClose,
  onRestore,
  onDelete,
}: {
  lang: Lang;
  entries: HistoryEntry[] | null;
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => Promise<void>;
}) {
  const t = makeT(lang);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setSelectedName(entries?.[0]?.name ?? null);
  }, [entries]);
  const selected = entries?.find((entry) => entry.name === selectedName) ?? null;
  return (
    <Dialog className="history-dialog" label={t("historyLabel")} onClose={onClose}>
      <header className="history-head">
        <h2>{t("historyLabel")}</h2>
        <IconButton title={t("closeHistory")} onClick={onClose} className="history-close">
          <X size={17} />
        </IconButton>
        <p>{t("historyIntro")}</p>
      </header>
      <div className="history-body">
        <nav className="history-list" aria-label={t("historyListAria")}>
          {(entries ?? []).map((entry) => (
            <div
              key={entry.name}
              className={`history-item ${selectedName === entry.name ? "is-selected" : ""}`}
            >
              <button
                type="button"
                className="history-item-time"
                onClick={() => setSelectedName(entry.name)}
              >
                {historyLabel(entry.name, lang)}
              </button>
              <IconButton
                title={t("restoreTo", { label: historyLabel(entry.name, lang) })}
                onClick={() => onRestore(entry)}
              >
                <CalendarArrowUp size={15} />
              </IconButton>
              <IconButton
                title={t("deleteHistoryOf", { label: historyLabel(entry.name, lang) })}
                onClick={() => setPendingDelete(entry)}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
          {entries !== null && entries.length === 0 && (
            <p className="history-empty">{t("historyEmpty")}</p>
          )}
        </nav>
        <section className="history-preview" aria-label={t("historyPreviewAria")}>
          {selected ? (
            <pre>{parseNoteBody(selected.content)}</pre>
          ) : (
            <p className="history-empty">
              {entries === null ? t("historyLoading") : t("historyPickOne")}
            </p>
          )}
        </section>
      </div>
      {pendingDelete && (
        <Dialog
          className="confirm-dialog"
          label={t("deleteHistoryConfirmLabel")}
          onClose={() => {
            if (!deleting) setPendingDelete(null);
          }}
        >
          <div className="settings-heading">
            <div>
              <h2>{t("deleteThisHistory")}</h2>
              <p>{t("deleteHistoryConfirm", { label: historyLabel(pendingDelete.name, lang) })}</p>
            </div>
          </div>
          <div className="settings-footer">
            <span role="note">{t("deleteHistoryFooter")}</span>
            <button
              type="button"
              className="primary-button danger-button"
              disabled={deleting}
              onClick={() => {
                const entry = pendingDelete;
                setDeleting(true);
                void onDelete(entry)
                  .then(() => setPendingDelete(null))
                  .finally(() => setDeleting(false));
              }}
            >
              {deleting ? t("deleting") : t("delete")}
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
