// 笔记内查找替换的纯匹配引擎：不依赖 React、DOM、Tauri 或持久化（架构不变量 1）。
// 三个开关与 VS Code 对齐：正则、大小写敏感、全词（\b 边界；中文无词边界，全词对纯中文词不生效）。

export type SearchOptions = {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
};

export type MatchRange = { start: number; end: number };

export type Matcher = {
  // 空查询或非法正则时为 null；error 只描述正则语法错误
  pattern: RegExp | null;
  error: string | null;
};

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildMatcher(query: string, options: SearchOptions): Matcher {
  if (!query) return { pattern: null, error: null };
  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return { pattern: new RegExp(source, options.caseSensitive ? "g" : "gi"), error: null };
  } catch (reason) {
    return {
      pattern: null,
      error: `正则表达式无效：${reason instanceof Error ? reason.message : String(reason)}`,
    };
  }
}

// 全局扫描所有匹配。空匹配（如 a*、^）命中后强制前进一位，避免死循环。
export function findMatches(body: string, pattern: RegExp): MatchRange[] {
  const matches: MatchRange[] = [];
  pattern.lastIndex = 0;
  for (;;) {
    const found = pattern.exec(body);
    if (!found) break;
    matches.push({ start: found.index, end: found.index + found[0].length });
    if (found[0].length === 0) pattern.lastIndex += 1;
    if (pattern.lastIndex > body.length) break;
  }
  return matches;
}

// 从 offset（含）起的第一个匹配下标；无则回绕到 0，仍无返回 -1。
export function matchIndexAtOrAfter(matches: MatchRange[], offset: number): number {
  if (matches.length === 0) return -1;
  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index].start >= offset) return index;
  }
  return 0;
}

// 循环导航：direction 为 1 或 -1，首尾回绕。
export function stepMatchIndex(current: number, direction: 1 | -1, total: number): number {
  if (total === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

// 全部替换。literal 为 true 时替换串按字面插入（$ 不具特殊含义）；
// 为 false（正则模式）时交给 String.replace 原生解析 $&、$1–$9。
export function replaceAllText(
  body: string,
  pattern: RegExp,
  replacement: string,
  literal: boolean,
): { text: string; count: number } {
  const count = findMatches(body, pattern).length;
  if (count === 0) return { text: body, count: 0 };
  pattern.lastIndex = 0;
  const text = literal
    ? body.replace(pattern, () => replacement)
    : body.replace(pattern, replacement);
  return { text, count };
}
