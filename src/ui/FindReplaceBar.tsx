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
import type { Lang } from "../domain/messages.ts";
import type { SearchOptions } from "../domain/search.ts";
import { IconButton } from "./IconButton.tsx";
import { makeT } from "./i18n.ts";

type Props = {
  lang: Lang;
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
  titleKey: "caseSensitive" | "wholeWord" | "useRegex";
  Icon?: typeof CaseSensitive;
  // lucide 的 Regex 图标圆点悬在半空、更像中文句号，正则开关改用 ASCII 文本字形 ".*"
  glyph?: string;
}[] = [
  { key: "caseSensitive", titleKey: "caseSensitive", Icon: CaseSensitive },
  { key: "wholeWord", titleKey: "wholeWord", Icon: WholeWord },
  { key: "regex", titleKey: "useRegex", glyph: ".*" },
];

// 输入法组合中的 Enter/Escape 属于组词，不触发导航或关闭
const isComposing = (event: ReactKeyboardEvent) => event.nativeEvent.isComposing;

export function FindReplaceBar({
  lang,
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
  const t = makeT(lang);
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
  // 焦点在开关/导航/关闭按钮上时 Esc 也要关闭：输入框的 Esc 已被各自的
  // onKeyDown preventDefault，这里只接住其余目标（按钮）上的按键
  function handleBarKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || isComposing(event) || event.defaultPrevented) return;
    onClose();
  }
  const hasMatches = matchCount > 0;
  const countLabel = error
    ? t("regexError")
    : !query
      ? ""
      : hasMatches
        ? `${activeIndex + 1}/${matchCount}`
        : t("noResults");
  return (
    <div
      className="find-bar"
      role="dialog"
      aria-label={t("findReplaceLabel")}
      onKeyDown={handleBarKeyDown}
    >
      <div className="find-row">
        {canReplace ? (
          <IconButton
            title={replaceOpen ? t("collapseReplace") : t("expandReplace")}
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
            aria-label={t("findLabel")}
            aria-invalid={error !== null}
            placeholder={t("findPlaceholder")}
            value={query}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={handleQueryKeyDown}
          />
          {OPTION_TOGGLES.map(({ key, titleKey, Icon, glyph }) => (
            <button
              key={key}
              type="button"
              className={`find-toggle ${options[key] ? "is-active" : ""}`}
              title={t(titleKey)}
              aria-label={t(titleKey)}
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
        <IconButton title={t("prevMatch")} disabled={!hasMatches} onClick={onPrevious}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton title={t("nextMatch")} disabled={!hasMatches} onClick={onNext}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton title={t("closeEsc")} onClick={onClose}>
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
              aria-label={t("replaceLabel")}
              placeholder={options.regex ? t("replacePlaceholderRegex") : t("replaceLabel")}
              value={replacement}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => onReplacement(event.target.value)}
              onKeyDown={handleReplaceKeyDown}
            />
          </div>
          <IconButton
            title={t("replaceCurrent")}
            disabled={!hasMatches || activeIndex < 0}
            onClick={onReplace}
          >
            <Replace size={14} />
          </IconButton>
          <IconButton title={t("replaceAll")} disabled={!hasMatches} onClick={onReplaceAll}>
            <ReplaceAll size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
