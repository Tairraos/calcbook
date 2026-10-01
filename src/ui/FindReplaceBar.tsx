import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { SearchOptions } from "../domain/search.ts";
import { IconButton } from "./IconButton.tsx";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  options: SearchOptions;
  onToggleOption: (key: keyof SearchOptions) => void;
  // 正则语法错误；非空时输入框标红、计数区显示提示
  error: string | null;
  matchCount: number;
  activeIndex: number;
  replaceOpen: boolean;
  onToggleReplace: () => void;
  // 只读（废纸篓）模式为 false：隐藏替换入口与替换行
  canReplace: boolean;
  replacement: string;
  onReplacement: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
  replaceRef: RefObject<HTMLInputElement | null>;
};

const OPTION_TOGGLES: {
  key: keyof SearchOptions;
  title: string;
  Icon?: typeof CaseSensitive;
  // lucide 的 Regex 图标圆点悬在半空、更像中文句号，正则开关改用 ASCII 文本字形 ".*"
  glyph?: string;
}[] = [
  { key: "caseSensitive", title: "区分大小写", Icon: CaseSensitive },
  { key: "wholeWord", title: "全词匹配（中文无词边界，对纯中文词不生效）", Icon: WholeWord },
  { key: "regex", title: "使用正则表达式", glyph: ".*" },
];

// 输入法组合中的 Enter/Escape 属于组词，不触发导航或关闭
const isComposing = (event: ReactKeyboardEvent) => event.nativeEvent.isComposing;

export function FindReplaceBar({
  query,
  onQuery,
  options,
  onToggleOption,
  error,
  matchCount,
  activeIndex,
  replaceOpen,
  onToggleReplace,
  canReplace,
  replacement,
  onReplacement,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
  queryRef,
  replaceRef,
}: Props) {
  function handleQueryKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (isComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
  function handleReplaceKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (isComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onReplace();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
  const hasMatches = matchCount > 0;
  const countLabel = error
    ? "正则错误"
    : !query
      ? ""
      : hasMatches
        ? `${activeIndex + 1}/${matchCount}`
        : "无结果";
  return (
    <div className="find-bar" role="dialog" aria-label="查找替换">
      <div className="find-row">
        {canReplace ? (
          <IconButton
            title={replaceOpen ? "收起替换" : "展开替换"}
            aria-expanded={replaceOpen}
            onClick={onToggleReplace}
          >
            {replaceOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        ) : (
          <span className="find-row-spacer" aria-hidden="true" />
        )}
        <div className={`find-input-wrap ${error ? "has-error" : ""}`} title={error ?? undefined}>
          <input
            ref={queryRef}
            className="find-input"
            aria-label="查找内容"
            aria-invalid={error !== null}
            placeholder="查找"
            value={query}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={handleQueryKeyDown}
          />
          {OPTION_TOGGLES.map(({ key, title, Icon, glyph }) => (
            <button
              key={key}
              type="button"
              className={`find-toggle ${options[key] ? "is-active" : ""}`}
              title={title}
              aria-label={title}
              aria-pressed={options[key]}
              onClick={() => onToggleOption(key)}
            >
              {glyph ? (
                <span className="find-toggle-glyph" aria-hidden="true">
                  {glyph}
                </span>
              ) : Icon ? (
                <Icon size={13} />
              ) : null}
            </button>
          ))}
        </div>
        <span
          className={`find-count ${error || (query && !hasMatches) ? "is-alert" : ""}`}
          role="status"
          aria-live="polite"
        >
          {countLabel}
        </span>
        <IconButton title="上一个匹配（Shift+Enter）" disabled={!hasMatches} onClick={onPrevious}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton title="下一个匹配（Enter）" disabled={!hasMatches} onClick={onNext}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton title="关闭（Esc）" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {canReplace && replaceOpen && (
        <div className="find-row">
          <span className="find-row-spacer" aria-hidden="true" />
          <div className="find-input-wrap">
            <input
              ref={replaceRef}
              className="find-input"
              aria-label="替换为"
              placeholder={options.regex ? "替换为（支持 $&、$1–$9）" : "替换为"}
              value={replacement}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => onReplacement(event.target.value)}
              onKeyDown={handleReplaceKeyDown}
            />
          </div>
          <IconButton
            title="替换当前匹配（Enter）"
            disabled={!hasMatches || activeIndex < 0}
            onClick={onReplace}
          >
            <Replace size={14} />
          </IconButton>
          <IconButton title="全部替换" disabled={!hasMatches} onClick={onReplaceAll}>
            <ReplaceAll size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
