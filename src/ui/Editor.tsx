// biome-ignore-all lint/suspicious/noArrayIndexKey: This stateless text mirror is keyed by line/token position to preserve the native textarea.
import { Check, Copy, TriangleAlert } from "lucide-react";
import { type RefObject, useState } from "react";
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
};

function Highlight({ line }: { line: LineResult }) {
  if (line.kind === "heading") return <span className="syntax-heading">{line.source}</span>;
  if (line.kind === "note") return <span className="syntax-comment">{line.source}</span>;
  return line.source.split(/(\d+(?:\.\d+)?|[=+\-×÷*/%()[\]{}:：])/g).map((part, index) => (
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
}: Props) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const count = Math.max(13, results.length + 2);
  const height = count * 34 + 32;
  const selectLine = (target: HTMLTextAreaElement) =>
    onActiveLine(target.value.slice(0, target.selectionStart).split("\n").length - 1);
  return (
    <div className="editor-scroll">
      <div className="editor-columns-label" aria-hidden="true">
        <span>笔记与算式</span>
        <span>结果</span>
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
            onSelect={(event) => selectLine(event.currentTarget)}
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
