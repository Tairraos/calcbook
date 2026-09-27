import { evaluateNotebook } from "./calculation.ts";

// Numi 保存时把成功计算的结果追加在整行末尾（`源表达式 = 结果`），导入时按同一规则剥离，
// 让内存里的 body 始终只有用户写下的源表达式。
const APPENDED_RESULT = /^(.*)\s+=\s+([-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*[^\s=]+)*)$/;
const BARE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export function stripResult(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return line;
  const match = APPENDED_RESULT.exec(trimmed);
  if (!match) return line;
  const [, source, result] = match;
  // `名称 = 值` 是用户自己写的赋值，不是 Numi 追加的结果；只有左侧还含有 `=`（赋值 + 结果）
  // 或左侧本身是算式时，才把右侧当成自动生成的结果剥掉。
  if (!source.includes("=") && BARE_NAME.test(source)) return line;
  return result ? source : line;
}

export function parseNoteBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").split("\n").map(stripResult).join("\n");
}

export function serializeNoteBody(body: string): string {
  return evaluateNotebook(body)
    .map((line) => {
      const source = stripResult(line.source.trimEnd());
      return line.kind === "result" && line.display !== undefined
        ? `${source} = ${line.display}`
        : source;
    })
    .join("\n");
}
