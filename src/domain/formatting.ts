// 全文格式化：按用户的格式设置重排笔记里的算式写法。默认不自动执行，
// 只在点击「格式化」时对整篇运行一次。
import {
  enToZh,
  parseUnitAliases,
  TO_IMPERIAL,
  TO_MARKET,
  TO_METRIC,
  type UnitSystemKind,
  unitKind,
  zhToCanonical,
} from "./units.ts";

export const UNIT_STYLES = ["free", "chinese", "upper", "lower"] as const;
export const UNIT_SYSTEMS = ["free", "metric", "imperial", "market"] as const;
export type UnitStyle = (typeof UNIT_STYLES)[number];
export type UnitSystemSetting = (typeof UNIT_SYSTEMS)[number];

export type FormatSettings = {
  thousands: boolean; // 数字千分位逗号
  unitSpace: boolean; // 数字和单位之间空格
  percentSpace: boolean; // 数字和百分号之间空格
  operatorSpace: boolean; // 运算符（+ - * / =）两边空格
  commentSpace: boolean; // 注释符号后空格
  unitStyle: UnitStyle;
  unitSystem: UnitSystemSetting;
};

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  thousands: false,
  unitSpace: false,
  percentSpace: false,
  operatorSpace: true,
  commentSpace: true,
  unitStyle: "free",
  unitSystem: "free",
};

// 强制规则：操作符词（of/to…）两边必须空格；函数前必须空格；括号与数字之间永远不留空格；
// 标签统一英文冒号加单空格。这些均不可配置。
const OPERATOR_WORDS = new Set([
  "of",
  "on",
  "off",
  "to",
  "in",
  "into",
  "as",
  "plus",
  "minus",
  "times",
  "divided",
]);
const FUNCTION_NAMES = new Set(["sqrt", "abs", "round", "ceil", "floor"]);

export function parseFormatSettings(input: unknown): FormatSettings {
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
    typeof value === "string" && (values as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  return {
    thousands: bool(record.thousands, DEFAULT_FORMAT_SETTINGS.thousands),
    unitSpace: bool(record.unitSpace, DEFAULT_FORMAT_SETTINGS.unitSpace),
    percentSpace: bool(record.percentSpace, DEFAULT_FORMAT_SETTINGS.percentSpace),
    operatorSpace: bool(record.operatorSpace, DEFAULT_FORMAT_SETTINGS.operatorSpace),
    commentSpace: bool(record.commentSpace, DEFAULT_FORMAT_SETTINGS.commentSpace),
    unitStyle: oneOf(record.unitStyle, UNIT_STYLES, DEFAULT_FORMAT_SETTINGS.unitStyle),
    unitSystem: oneOf(record.unitSystem, UNIT_SYSTEMS, DEFAULT_FORMAT_SETTINGS.unitSystem),
  };
}

export type ConvertQuantity = (value: number, from: string, to: string) => number | null;

// 把中英写法都归到规范英文单位名；不是已知单位时返回 null。
function canonicalUnit(word: string): string | null {
  if (zhToCanonical[word]) return zhToCanonical[word];
  if (word in parseUnitAliases) return parseUnitAliases[word];
  const lower = word.toLowerCase();
  if (lower in parseUnitAliases) return parseUnitAliases[lower];
  return null;
}

function targetForSystem(unit: string, system: UnitSystemSetting): string | null {
  if (system === "metric") return TO_METRIC[unit] ?? null;
  if (system === "imperial") return TO_IMPERIAL[unit] ?? null;
  if (system === "market") return TO_MARKET[unit] ?? null;
  return null;
}

type Token = {
  kind: "number" | "word" | "operator" | "bracket" | "percent" | "colon";
  text: string;
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /(\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?)|([\p{L}_][\p{L}\p{N}_]*)|([+\-*/×÷^=])|([()[\]{}])|(%)|(:)/gu;
  let lastIndex = 0;
  for (const match of expression.matchAll(pattern)) {
    if (match.index > lastIndex) {
      // 出现在 token 之间的杂散字符（不该有）：原样保留，避免丢内容。
      tokens.push({ kind: "word", text: expression.slice(lastIndex, match.index).trim() });
    }
    const text = match[0];
    const kind = match[1]
      ? "number"
      : match[2]
        ? "word"
        : match[3]
          ? "operator"
          : match[4]
            ? "bracket"
            : match[5]
              ? "percent"
              : "colon";
    tokens.push({ kind, text });
    lastIndex = match.index + text.length;
  }
  if (lastIndex < expression.length) {
    const rest = expression.slice(lastIndex).trim();
    if (rest) tokens.push({ kind: "word", text: rest });
  }
  return tokens.filter((token) => token.text !== "");
}

function groupNumber(numberText: string): string {
  const [integer, rest] = numberText.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === undefined ? grouped : `${grouped}.${rest}`;
}

function isConversionWord(word: string): boolean {
  return ["to", "in", "into", "as", "TO", "IN", "INTO", "AS"].includes(word);
}

// 单行算式格式化。label 由调用方处理；convert 由 calculation.ts 注入（需要 mathjs 实例）。
export function formatExpression(
  expression: string,
  settings: FormatSettings,
  convert: ConvertQuantity,
): string {
  let tokens = tokenize(expression);
  const hasConversionWord = tokens.some(
    (token) => token.kind === "word" && isConversionWord(token.text),
  );

  // 制式换算：把数字+单位对换算成目标制式（显式 to 转换的行保持原样）。
  if (settings.unitSystem !== "free" && !hasConversionWord) {
    // 行内已有的目标制式单位（记原始写法，换算后沿用它的拼写）。
    const lineUnits = new Map<string, { kind: UnitSystemKind; original: string }>();
    tokens.forEach((token, index) => {
      if (token.kind !== "word") return;
      const previous = tokens[index - 1];
      if (index === 0 || (previous?.kind !== "number" && previous?.kind !== "word")) return;
      const unit = canonicalUnit(token.text);
      if (!unit) return;
      const kind = unitKind(unit);
      if (kind === "neutral" || kind === "none") return;
      if (!lineUnits.has(unit)) lineUnits.set(unit, { kind, original: token.text });
    });
    const nextTokens: Token[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      const next = tokens[index + 1];
      if (
        token.kind === "number" &&
        next?.kind === "word" &&
        !(index > 0 && previous?.kind === "operator" && false)
      ) {
        const unit = canonicalUnit(next.text);
        const system = unit ? unitKind(unit) : ("none" as UnitSystemKind);
        if (unit && system !== settings.unitSystem && system !== "neutral" && system !== "none") {
          let target: string | null = null;
          for (const info of lineUnits.values()) {
            if (info.kind !== settings.unitSystem) continue;
            target = info.original;
            break;
          }
          if (!target) target = targetForSystem(unit, settings.unitSystem);
          const numeric = Number(token.text.replace(/,/g, ""));
          if (target && target !== unit && Number.isFinite(numeric)) {
            const converted = convert(numeric, unit, target);
            if (converted !== null && Number.isFinite(converted)) {
              nextTokens.push({
                kind: "number",
                text: String(Number(converted.toPrecision(10))),
              });
              nextTokens.push({
                kind: "word",
                text: settings.unitStyle === "upper" ? target.toUpperCase() : target,
              });
              index++;
              continue;
            }
          }
        }
      }
      nextTokens.push(token);
    }
    tokens = nextTokens;
  }

  // 单位风格改写（中文/大写/小写）
  if (settings.unitStyle === "chinese" || settings.unitStyle === "upper") {
    tokens = tokens.map((token) => {
      if (token.kind !== "word" || isConversionWord(token.text)) return token;
      const canonical = canonicalUnit(token.text);
      if (!canonical) return token;
      if (settings.unitStyle === "chinese") {
        const zh = enToZh[canonical];
        return zh ? { ...token, text: zh } : token;
      }
      return { ...token, text: token.text.toUpperCase() };
    });
  }

  // 重建：按设置插空格；强制规则（操作符词/函数/括号/标签）不依赖配置。
  const out: string[] = [];
  tokens.forEach((token, index) => {
    const previous = index > 0 ? tokens[index - 1] : null;
    if (previous) {
      const closing = token.kind === "bracket" && ")]}".includes(token.text);
      const previousOpening = previous.kind === "bracket" && "([{".includes(previous.text);
      let space = false;
      if (token.kind === "operator") {
        const unary =
          token.text === "-" && (index === 0 || previous.kind === "operator" || previousOpening);
        space = settings.operatorSpace && !unary;
      } else if (previous.kind === "operator") {
        const previousUnary =
          previous.text === "-" &&
          (index - 1 === 0 ||
            (tokens[index - 2] &&
              (tokens[index - 2].kind === "operator" ||
                (tokens[index - 2].kind === "bracket" && "([{".includes(tokens[index - 2].text)))));
        space = settings.operatorSpace && !previousUnary && !closing;
      } else if (token.kind === "percent") {
        space = settings.percentSpace;
      } else if (token.kind === "colon" || previous.kind === "colon") {
        space = false; // 比率 16:9 紧凑；标签冒号统一英文冒号加单空格
      } else if (token.kind === "word" && FUNCTION_NAMES.has(token.text)) {
        space = !previousOpening; // 函数前必须空格
      } else if (
        (token.kind === "word" && OPERATOR_WORDS.has(token.text)) ||
        (previous.kind === "word" && OPERATOR_WORDS.has(previous.text))
      ) {
        space = !previousOpening && !closing; // 操作符词（of、to…）两边必须空格
      } else if (token.kind === "bracket") {
        space = false; // 括号和数字/词之间永远不留空格
      } else if (previous.kind === "bracket") {
        space = false;
      } else if (token.kind === "word" && previous.kind === "number") {
        space = settings.unitSpace;
      } else if (token.kind === "word" && previous.kind === "percent") {
        space = settings.unitSpace;
      } else if (token.kind === "word" && previous.kind === "word") {
        space = true;
      } else if (previous.kind === "word") {
        space = true;
      }
      if (space) out.push(" ");
    }
    out.push(
      token.kind === "number"
        ? settings.thousands
          ? groupNumber(token.text.replace(/,/g, ""))
          : token.text.replace(/,/g, "")
        : token.text,
    );
  });

  return out.join("").replace(/ {2,}/g, " ").trim();
}

// 整行格式化：拆注释、格式化算式、按设置接回注释。
export function formatLine(
  line: string,
  settings: FormatSettings,
  convert: ConvertQuantity,
): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  // 注释起点：// 总是；# 在行首或空白后。
  let commentIndex = trimmed.indexOf("//");
  const hashMatch = /^(\s*)(#)/.exec(trimmed) ?? /(\s)#/.exec(trimmed);
  if (hashMatch) {
    const hashIndex = hashMatch.index + hashMatch[1].length;
    if (commentIndex === -1 || hashIndex < commentIndex) commentIndex = hashIndex;
  }
  if (commentIndex === -1) {
    const label = labelSplit(trimmed);
    if (!label) return formatExpression(trimmed, settings, convert);
    return `${label.label} ${collapseLine(label.expression, settings, convert)}`;
  }
  const head = trimmed.slice(0, commentIndex);
  const comment = trimmed.slice(commentIndex);
  const symbol = comment.startsWith("//") ? "//" : "#";
  const rest = comment.slice(symbol.length).trim();
  const commentText = `${symbol}${settings.commentSpace && rest ? " " : ""}${rest}`;
  if (!head.trim()) return commentText;
  const label = labelSplit(head);
  const formattedHead = label
    ? `${label.label} ${collapseLine(label.expression, settings, convert)}`
    : collapseLine(head, settings, convert);
  return `${formattedHead} ${commentText}`.replace(/ {2,}/g, " ").trimEnd();
}

function labelSplit(text: string): { label: string; expression: string } | null {
  const index = text.search(/[:：]/);
  if (index === -1) return null;
  const head = text.slice(0, index).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(head)) return null; // 16:9 比率
  return { label: `${head}${text[index]}`, expression: text.slice(index + 1).trim() };
}

function collapseLine(text: string, settings: FormatSettings, convert: ConvertQuantity): string {
  return formatExpression(text, settings, convert);
}

export function formatNoteBody(
  body: string,
  settings: FormatSettings,
  convert: ConvertQuantity,
): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => formatLine(line, settings, convert))
    .join("\n");
}
