import { CalendarArrowUp, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { parseNoteBody } from "../domain/format.ts";
import type { HistoryEntry } from "../domain/notebook.ts";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";

// 时间桶 → 友好时间：秒级 `年-月-日-时-分-秒` 显示「9月30日 19:05:30」，
// 整点/旧版 `年-月-日-时` 显示「9月30日 19时」；解析失败原样显示。
export function historyLabel(bucket: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?$/.exec(bucket);
  if (!match) return bucket;
  const [, , month, day, hour, minute, second] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!Number.isInteger(monthNumber) || !Number.isInteger(dayNumber)) return bucket;
  return minute !== undefined && second !== undefined
    ? `${monthNumber}月${dayNumber}日 ${hour}:${minute}:${second}`
    : `${monthNumber}月${dayNumber}日 ${hour}时`;
}

// 固定尺寸弹窗：左侧历史列表（时间 + 恢复/删除按钮）、右侧内容预览。
// 列表由 App 加载后传入，这里只负责展示与选择；删除经确认弹窗后回调 App。
export function HistoryDialog({
  entries,
  onClose,
  onRestore,
  onDelete,
}: {
  entries: HistoryEntry[] | null;
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => Promise<void>;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setSelectedName(entries?.[0]?.name ?? null);
  }, [entries]);
  const selected = entries?.find((entry) => entry.name === selectedName) ?? null;
  return (
    <Dialog className="history-dialog" label="历史记录" onClose={onClose}>
      <header className="history-head">
        <h2>历史记录</h2>
        <IconButton title="关闭历史记录" onClick={onClose} className="history-close">
          <X size={17} />
        </IconButton>
        <p>每小时留一份快照；恢复前，当前内容会先存入历史。</p>
      </header>
      <div className="history-body">
        <nav className="history-list" aria-label="历史版本列表">
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
                {historyLabel(entry.name)}
              </button>
              <IconButton
                title={`恢复到 ${historyLabel(entry.name)}`}
                onClick={() => onRestore(entry)}
              >
                <CalendarArrowUp size={15} />
              </IconButton>
              <IconButton
                title={`删除 ${historyLabel(entry.name)} 的历史`}
                onClick={() => setPendingDelete(entry)}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
          {entries !== null && entries.length === 0 && (
            <p className="history-empty">还没有历史记录。编辑笔记时会自动按小时留档。</p>
          )}
        </nav>
        <section className="history-preview" aria-label="历史内容预览">
          {selected ? (
            <pre>{parseNoteBody(selected.content)}</pre>
          ) : (
            <p className="history-empty">
              {entries === null ? "正在读取历史…" : "选择左侧的时间查看内容"}
            </p>
          )}
        </section>
      </div>
      {pendingDelete && (
        <Dialog
          className="confirm-dialog"
          label="删除历史确认"
          onClose={() => {
            if (!deleting) setPendingDelete(null);
          }}
        >
          <div className="settings-heading">
            <div>
              <h2>删除这条历史</h2>
              <p>
                将永久删除 {historyLabel(pendingDelete.name)} 的历史版本，无法恢复。
                笔记本身与其它历史不受影响。
              </p>
            </div>
          </div>
          <div className="settings-footer">
            <span role="note">这条历史对应的快照文件会一并删除。</span>
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
              {deleting ? "正在删除…" : "删除"}
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
