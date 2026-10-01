// biome-ignore-all lint/suspicious/noArrayIndexKey: This stateless text mirror is keyed by line/token position to preserve the native textarea.
import { Check, Copy, TriangleAlert } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useState,
} from "react";
import type { LineResult } from "../domain/calculation.ts";
import { MAX_NOTE_LENGTH } from "../domain/notebook.ts";

type Props = {
  body: string;
  results: LineResult[];
  onChange: (body: string) => void;
  onCopy: (text: string) => void;
  activeLine: number;
  onActiveLine: (line: number) => void;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  readOnly?: boolean;
  // 一次性删除 5 行以上（大选区剪切/删除）时先回调，用于破坏性操作前留档。
  onDestructiveChange?: () => void;
};

const writeToClipboard = (text: string): Promise<void> =>
  typeof navigator.clipboard?.writeText === "function"
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("剪贴板不可用"));

function Highlight({ line }: { line: LineResult }) {
  if (line.kind === "note") return <span className="syntax-comment">{line.source}</span>;
  // 行尾注释（// 或 #）用注释色渲染；计算结果落在右侧结果区
  const comment = /^(.*?)(\s(?:\/\/|#).*)$/.exec(line.source);
  const source = comment ? comment[1] : line.source;
  const parts = source.split(/(\d+(?:\.\d+)?|[=+\-×÷*/%()[\]{}:：])/g).map((part, index) => (
    <span
      key={`${index}-${part}`}
      className={
        /^\d/.test(part)
          ? "syntax-number"
          : /^[=+\-×÷*/%()[\]{}:：]$/.test(part)
            ? "syntax-operator"
            : undefined
      }
    >
      {part}
    </span>
  ));
  return comment ? (
    <>
      {parts}
      <span className="syntax-comment">{comment[2]}</span>
    </>
  ) : (
    parts
  );
}

export function Editor({
  body,
  results,
  onChange,
  onCopy,
  activeLine,
  onActiveLine,
  editorRef,
  readOnly,
  onDestructiveChange,
}: Props) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const count = Math.max(13, results.length + 2);
  const height = count * 34 + 32;
  const selectLine = (target: HTMLTextAreaElement) =>
    onActiveLine(target.value.slice(0, target.selectionStart).split("\n").length - 1);
  // 便捷输入：插入的字符没有换行，行号不变；新值提交后再把光标落到插入点之后。
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  useEffect(() => {
    if (pendingCaret === null) return;
    setPendingCaret(null);
    const textarea = editorRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pendingCaret, pendingCaret);
  }, [pendingCaret, editorRef]);
  function insertSymbol(symbol: string) {
    const textarea = editorRef.current;
    if (!textarea || readOnly) return;
    // 输入框有焦点（按钮按下时不抢焦点）就替换选中内容，否则追加到末尾。
    const editing = document.activeElement === textarea;
    const start = editing ? textarea.selectionStart : body.length;
    const end = editing ? textarea.selectionEnd : body.length;
    const next = body.slice(0, start) + symbol + body.slice(end);
    if (next.length > MAX_NOTE_LENGTH) return;
    setPendingCaret(start + symbol.length);
    onChange(next);
  }
  // 一次性删除 5 行以上（选区跨 5 个换行）属于破坏性操作：剪切/删除发生前先留档。
  const maybeRecordDestructive = (textarea: HTMLTextAreaElement) => {
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return;
    if (value.slice(selectionStart, selectionEnd).split("\n").length >= 5) onDestructiveChange?.();
  };
  // 无选区时 Cmd/Ctrl+C 复制整行、Cmd/Ctrl+X 剪切整行（含行尾换行）；有选区走原生行为。
  // 剪切删除走「选中整行 + execCommand」，保留 textarea 原生撤销栈。
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    if (event.nativeEvent.isComposing) return;
    // 大选区删除（Delete/Backspace）与 Cmd/Ctrl+X 有选区剪切：先留档再放行
    if (!event.metaKey && !event.ctrlKey && (event.key === "Delete" || event.key === "Backspace")) {
      if (!readOnly) maybeRecordDestructive(textarea);
      return;
    }
    if (event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "x" && textarea.selectionStart !== textarea.selectionEnd) {
      if (!readOnly) maybeRecordDestructive(textarea);
      return; // 有选区剪切交给 onCut / 原生行为
    }
    if ((key !== "c" && key !== "x") || textarea.selectionStart !== textarea.selectionEnd) return;
    const value = textarea.value;
    const caret = textarea.selectionStart;
    const start = value.lastIndexOf("\n", caret - 1) + 1;
    const newline = value.indexOf("\n", caret);
    const textEnd = newline === -1 ? value.length : newline;
    const line = value.slice(start, textEnd);
    if (key === "c") {
      event.preventDefault();
      writeToClipboard(line).catch(() => {
        // 写剪贴板失败：临时选中整行退回原生复制，随后恢复光标
        textarea.setSelectionRange(start, textEnd);
        document.execCommand("copy");
        textarea.setSelectionRange(caret, caret);
      });
      return;
    }
    if (readOnly) return;
    event.preventDefault();
    // 剪切进剪贴板的内容带行尾换行：粘贴时整行落位，不必手动补换行
    const cutText = value.slice(start, newline === -1 ? value.length : newline + 1);
    void writeToClipboard(cutText).catch(() => {});
    textarea.setSelectionRange(start, newline === -1 ? value.length : newline + 1);
    if (!document.execCommand("delete")) textarea.setSelectionRange(caret, caret);
  }
  return (
    <div className="editor-scroll">
      <div className="editor-columns-label">
        <span className="editor-columns-title">
          <span aria-hidden="true">笔记与算式</span>
          {!readOnly && (
            <span className="quick-insert">
              <span aria-hidden="true">（便捷输入：</span>
              <button
                type="button"
                className="quick-insert-key"
                title="插入乘号 ×"
                aria-label="插入乘号"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSymbol("×")}
              >
                ×
              </button>
              <button
                type="button"
                className="quick-insert-key"
                title="插入除号 ÷"
                aria-label="插入除号"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSymbol("÷")}
              >
                ÷
              </button>
              <span aria-hidden="true">）</span>
            </span>
          )}
        </span>
        <span aria-hidden="true">结果</span>
      </div>
      <div className="editor-grid" style={{ minHeight: height }}>
        <div className="line-numbers" aria-hidden="true">
          {Array.from({ length: count }, (_, index) => (
            <div key={`line-${index}`} className={index === activeLine ? "is-active" : undefined}>
              {index + 1}
            </div>
          ))}
        </div>
        <div className="editor-code">
          <div
            className="editor-highlight"
            aria-hidden="true"
            style={{ transform: `translateX(-${scrollLeft}px)` }}
          >
            {results.map((line, index) => (
              <div
                className={`code-line ${index === activeLine ? "is-active" : ""}`}
                key={`source-${index}`}
              >
                <Highlight line={line} />
                {"\u200b"}
              </div>
            ))}
            {!body && <span className="editor-placeholder">写下一个想法，或试试 12 × 8</span>}
          </div>
          <textarea
            ref={editorRef}
            aria-label="笔记内容"
            className="editor-input"
            value={body}
            onChange={(event) => {
              onChange(event.target.value);
              selectLine(event.target);
            }}
            onKeyDown={handleKeyDown}
            onCut={(event) => {
              // 右键菜单剪切与有选区的 Cmd/Ctrl+X 都走原生 cut 事件
              if (!readOnly) maybeRecordDestructive(event.currentTarget);
            }}
            onSelect={(event) => selectLine(event.currentTarget)}
            onClick={(event) => selectLine(event.currentTarget)}
            onKeyUp={(event) => selectLine(event.currentTarget)}
            onBlur={(event) => selectLine(event.currentTarget)}
            onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            maxLength={MAX_NOTE_LENGTH}
            readOnly={readOnly}
          />
        </div>
        <section className="editor-results" aria-label="逐行计算结果">
          {results.map((line, index) => (
            <div
              className={`result-row ${index === activeLine ? "is-active" : ""}`}
              key={`result-${index}`}
              data-testid={`result-line-${index + 1}`}
            >
              {line.kind === "result" && (
                <button
                  type="button"
                  className="line-result"
                  title={`复制结果：${line.raw}`}
                  aria-label={`复制第 ${index + 1} 行结果：${line.display}`}
                  onClick={() => {
                    onCopy(line.raw ?? "");
                    setCopiedLine(index);
                    setTimeout(() => setCopiedLine(null), 1200);
                  }}
                >
                  <span>{line.display}</span>
                  {copiedLine === index ? (
                    <Check size={12} />
                  ) : (
                    <Copy size={12} className="copy-result-icon" />
                  )}
                </button>
              )}
              {line.kind === "error" && (
                <button
                  type="button"
                  className="line-error"
                  title={line.error}
                  aria-label={`第 ${index + 1} 行：${line.error}`}
                >
                  <TriangleAlert size={13} />
                  <span>检查算式</span>
                  <span className="error-tooltip" role="tooltip">
                    {line.error}
                  </span>
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
