import { evaluateNotebook, SUMMARIES } from "./calculation.ts";

// 保存时把成功计算的结果追加在整行末尾（`源表达式 = 结果`），导入时按同一规则剥离，
// 让内存里的 body 始终只有用户写下的源表达式。
const APPENDED_RESULT = /^(.*)\s+=\s+([-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*[^\s=]+)*)$/;
const BARE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export function stripResult(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return line;
  const match = APPENDED_RESULT.exec(trimmed);
  if (!match) return line;
  const [, source, result] = match;
  // `名称 = 值` 是用户自己写的赋值，不是自动追加的结果；只有左侧还含有 `=`（赋值 + 结果）
  // 或左侧本身是算式时，才把右侧当成自动生成的结果剥掉。
  let bareKeep = false;
  if (!source.includes("=") && BARE_NAME.test(source)) {
    // 例外：`sum = 60` 这类保留字行是保存时追加的结果，剥掉后还原成汇总行。
    if (!SUMMARIES.has(source) && source !== "prev") return line;
    bareKeep = true;
  }
  if (!result) return line;
  // 结果后面可能跟着行内注释：剥掉 ` = 结果`，注释保留在算式尾部。
  const commentMatch = /\s((?:\/\/|#).*)$/.exec(result);
  const comment = commentMatch ? ` ${commentMatch[1]}` : "";
  if (comment && bareKeep) return `${source}${comment}`;
  return comment ? `${source}${comment}` : source;
}

export function parseNoteBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").split("\n").map(stripResult).join("\n");
}

// 行内注释起点：// 与 # 作用一致，都是注释标记。
function commentIndex(source: string): number {
  const slash = source.indexOf("//");
  const hash = source.indexOf("#");
  if (slash === -1) return hash;
  if (hash === -1) return slash;
  return Math.min(slash, hash);
}

export function serializeNoteBody(
  body: string,
  options: {
    unitStyle?: "free" | "chinese" | "lower" | "upper";
    lang?: "zh" | "en";
  } = {},
): string {
  return evaluateNotebook(body, options)
    .map((line) => {
      const source = stripResult(line.source.trimEnd());
      if (line.kind !== "result" || line.display === undefined) return source;
      // 行内注释保留在行尾，结果插在算式与注释之间：`5 × 2 = 10 //棒冰`
      const comment = commentIndex(source);
      if (comment === -1) return `${source} = ${line.display}`;
      return `${source.slice(0, comment).trimEnd()} = ${line.display} ${source.slice(comment)}`;
    })
    .join("\n");
}
