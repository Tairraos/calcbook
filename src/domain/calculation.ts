import {
  all,
  type BigNumber,
  type ConstantNode,
  create,
  type FunctionNode,
  isBigNumber,
  isUnit,
  type MathNode,
  type OperatorNode,
  type SymbolNode,
  type Unit,
} from "mathjs";
import {
  attachMath,
  cancelSameDimension,
  caseUnitAliases,
  enToZh,
  isKnownUnitLower,
  parseUnitAliases,
  registerCustomUnits,
  type SeenUnit,
  scanUnitTokens,
  TO_IMPERIAL,
  TO_MARKET,
  TO_METRIC,
  type UnitSystemKind,
  unitKind,
  unitMagnitude,
} from "./units.ts";

const math = create(all, { number: "BigNumber", precision: 64, predictable: true });
registerCustomUnits(math);
attachMath(math);
const originalIsAlpha = math.parse.isAlpha;
math.parse.isAlpha = (character, previous, next) =>
  /^\p{L}$/u.test(character) || originalIsAlpha(character, previous, next);
for (const currency of ["CNY", "USD", "EUR", "GBP"]) math.createUnit(currency);

export type CalcValue = BigNumber | Unit;
type Scope = Map<string, CalcValue>;
export type LineResult = {
  kind: "empty" | "note" | "result" | "error";
  source: string;
  display?: string;
  raw?: string;
  error?: string;
};

const functions = new Set(["sqrt", "abs", "round", "ceil", "floor"]);
const operators = new Set([
  "add",
  "subtract",
  "multiply",
  "divide",
  "pow",
  "unaryMinus",
  "unaryPlus",
  "to",
]);
const constants = new Set(["pi", "e"]);
export const SUMMARIES: ReadonlySet<string> = new Set([
  "sum",
  "total",
  "合计",
  "avg",
  "average",
  "平均",
]);
const summaries = SUMMARIES;
const aliases: Record<string, string> = parseUnitAliases;
const currencySymbols: Record<string, string> = {
  "¥": "CNY",
  "￥": "CNY",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

// 把字母 x 在「两个操作数之间」时判为乘号（返回 * 的写法）。
// 引擎与全文格式化共用这一判定，保证格式化不改写算式语义。
export function normalizeMultiplication(expression: string): string {
  let normalized = "";
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (character === "x") {
      const left = normalized.trimEnd();
      const rest = expression.slice(index + 1);
      const numericOperands =
        (/[)%]$/.test(left) ||
          /(?<![\p{L}\p{N}_.])(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/u.test(left)) &&
        /^\s*[\d.(+-]/.test(rest);
      const spacedOperands =
        /[\p{L}\p{N}_)%]\s+$/u.test(normalized) && /^\s+[\p{L}\p{N}_(.+-]/u.test(rest);
      if (numericOperands || spacedOperands) {
        normalized += "*";
        continue;
      }
    }
    normalized += character;
  }
  return normalized;
}

function normalize(source: string): string {
  let expression = source
    .replace(/[×✕]/g, "*")
    .replace(/÷/g, "/")
    .replace(/(?<=\d)\s*[:：]\s*(?=\d)/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/[（[{]/g, "(")
    .replace(/[）\]}]/g, ")")
    .replace(/％/g, "%")
    .replace(
      /[¥￥$€£]\s*(\d+(?:\.\d+)?)/g,
      (match, number: string) => `${number} ${currencySymbols[match[0]]}`,
    )
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(
      /[\p{L}_][\p{L}\p{N}_]*/gu,
      (word) =>
        aliases[word] ?? aliases[word.toLowerCase()] ?? caseUnitAliases[word.toLowerCase()] ?? word,
    )
    .replace(/\b(?:in|into|as)\b/g, "to")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\btimes\b/g, "*")
    .replace(/\bdivided by\b/g, "/");
  expression = normalizeMultiplication(expression);
  const percent = expression.match(/^(-?\d+(?:\.\d+)?)%\s+(of|on|off)\s+(.+)$/);
  if (percent) {
    const [, amount, operation, base] = percent;
    expression =
      operation === "of"
        ? `(${base}) * (${amount} / 100)`
        : `(${base}) ${operation === "on" ? "+" : "-"} ${amount}%`;
  }
  return expression;
}

function validValue(value: unknown): CalcValue {
  if (!isBigNumber(value) && !isUnit(value)) throw new Error("这里只支持数字和单位计算");
  const numeric: unknown = isUnit(value) ? value.value : value;
  if (numeric === null) throw new Error("请在单位前输入数字");
  const decimal = isBigNumber(numeric) ? numeric : math.bignumber(numeric as number);
  if (!decimal.isFinite()) throw new Error("结果无效，请检查除零或函数的取值范围");
  if (decimal.abs().gt("1e308")) throw new Error("数值过大，请控制在 1e308 以内");
  return value;
}

// mathjs 的类型把 prefix 标成 string，运行时是带 name 的前缀对象；拼出规范 token。
function canonicalToken(component: { prefix: unknown; unit: { name: string } }): string {
  const prefix = (component.prefix as unknown as { name?: string } | string) ?? "";
  const prefixName = typeof prefix === "string" ? prefix : (prefix.name ?? "");
  return `${prefixName}${component.unit.name}`;
}

function validateTree(tree: MathNode, scope: Scope): SeenUnit[] {
  let count = 0;
  const seen = new Map<string, SeenUnit>();
  const addSeen = (token: string, chinese: boolean) => {
    const key = token.toLowerCase();
    const upper = !chinese && /[A-Z]/.test(token) && token === token.toUpperCase();
    const existing = seen.get(key);
    if (existing) {
      existing.chinese ||= chinese;
      existing.upper ||= upper;
      return;
    }
    seen.set(key, {
      token,
      written: token,
      chinese,
      upper,
      kind: unitKind(token),
      mag: unitMagnitude(token),
    });
  };
  const see = (name: string) => {
    if (scope.has(name)) {
      const scopedValue = scope.get(name);
      if (isUnit(scopedValue)) {
        for (const component of scopedValue.units) {
          addSeen(canonicalToken(component), false);
        }
      }
      return;
    }
    addSeen(name, false);
  };
  const walk = (node: MathNode, depth: number) => {
    if (++count > 160 || depth > 32) throw new Error("算式太复杂，请拆成多行");
    switch (node.type) {
      case "ConstantNode": {
        const value: unknown = (node as ConstantNode).value;
        validValue(typeof value === "number" ? math.bignumber(value) : value);
        break;
      }
      case "SymbolNode": {
        const name = (node as SymbolNode).name;
        if (
          !scope.has(name) &&
          !constants.has(name) &&
          !functions.has(name) &&
          !math.Unit.isValuelessUnit(name)
        ) {
          throw new Error(`“${name}”尚未定义`);
        }
        if (!constants.has(name) && !functions.has(name)) see(name);
        break;
      }
      case "OperatorNode":
        if (!operators.has((node as OperatorNode).fn)) throw new Error("暂不支持这个运算符");
        break;
      case "FunctionNode":
        if (!functions.has((node as FunctionNode).fn.name)) throw new Error("暂不支持这个函数");
        break;
      case "ParenthesisNode":
        break;
      default:
        throw new Error("仅支持算式，不支持脚本、数组或属性访问");
    }
    node.forEach((child) => {
      walk(child, depth + 1);
    });
  };
  walk(tree, 0);
  // Check powers inside out, before evaluating an enclosing exponent tower.
  const checkPowers = (node: MathNode) => {
    node.forEach(checkPowers);
    if (node.type === "OperatorNode" && (node as OperatorNode).fn === "pow") {
      const exponent = validValue((node as OperatorNode).args[1].evaluate(scope));
      if (!isBigNumber(exponent) || exponent.abs().gt(1000))
        throw new Error("指数绝对值不能超过 1000");
    }
  };
  checkPowers(tree);
  return [...seen.values()];
}

export type ResultLanguage = "chinese" | "upper" | "lower";

// 结果后缀按算式语言呈现：中文 → 中文单位名（无空格），大写 → 全大写，否则小写。
export function formatUnitSuffix(
  formatted: string,
  language: ResultLanguage,
  chineseNames: Record<string, string> = {},
): string {
  const split = formatted.indexOf(" ");
  if (split === -1) return formatted;
  const suffix = formatted.slice(split + 1).replace(/([A-Za-z][A-Za-z0-9]*)/g, (token) => {
    if (language === "upper") return token.toUpperCase();
    if (language === "chinese")
      return (
        chineseNames[token.toLowerCase()] ?? enToZh[token] ?? enToZh[token.toLowerCase()] ?? token
      );
    return isKnownUnitLower(token.toLowerCase()) ? token.toLowerCase() : token;
  });
  const result = formatted.slice(0, split + 1) + suffix;
  if (language === "chinese") return result.replace(/ +(\P{ASCII})|(\P{ASCII}) +/gu, "$1$2");
  return result;
}

// 显示数值：小数最多 4 位（四舍五入），≥1e10 转科学计数法（尾数同为 4 位）。
// 千位分隔只作用于整数部分——4 位小数会被全串正则误切（666.6667 → 666.6,667）。
function formatDisplayNumber(numeric: BigNumber | number): string {
  const decimal = isBigNumber(numeric) ? numeric : math.bignumber(numeric);
  const rounded = decimal.toDecimalPlaces(4);
  if (rounded.abs().gte("1e10")) {
    return decimal.toExponential(4).replace(/\.?0+e/, "e");
  }
  if (rounded.isZero()) return "0";
  const [intPart, decimalPart] = rounded.toFixed().split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart ? `${grouped}.${decimalPart}` : grouped;
}

export function formatValue(
  value: CalcValue,
  language: ResultLanguage = "lower",
  chineseNames: Record<string, string> = {},
): { raw: string; display: string } {
  const raw = formatUnitSuffix(
    math.format(value, { precision: 14, lowerExp: -8, upperExp: 16 }),
    language,
    chineseNames,
  );
  const display = formatUnitSuffix(math.format(value, formatDisplayNumber), language, chineseNames);
  return { raw, display };
}

// 显式转换（to / in / into / as，normalize 后统一是 to）时以用户指定的目标单位为准。
function hasExplicitConversion(tree: MathNode): boolean {
  let found = false;
  const walk = (node: MathNode): void => {
    if (found) return;
    if (node.type === "OperatorNode" && (node as OperatorNode).fn === "to") {
      found = true;
      return;
    }
    node.forEach(walk);
  };
  walk(tree);
  return found;
}

// 赋值名撞上保留字时给出具体类别：单位、函数、常量、汇总、转换关键字都不可用作变量。
const conversionKeywords = new Set(["to", "in", "as", "of", "on", "off"]);
function reservedConflict(name: string): string | null {
  if (functions.has(name)) return `保留字冲突：“${name}”是函数名，请换一个变量名`;
  if (constants.has(name)) return `保留字冲突：“${name}”是常量名，请换一个变量名`;
  if (summaries.has(name)) return `保留字冲突：“${name}”是汇总关键字，请换一个变量名`;
  if (name === "prev") return `保留字冲突：“prev”指上一行的结果，请换一个变量名`;
  if (conversionKeywords.has(name)) return `保留字冲突：“${name}”是单位转换关键字，请换一个变量名`;
  if (aliases[name] || math.Unit.isValuelessUnit(name))
    return `保留字冲突：“${name}”是单位名，请换一个变量名`;
  return null;
}

// 结果单位规则：制式优先级 公制 > 英制 > 市制；同制式内向更小的单位靠拢；
// 结果的单位语言跟随算式（中文 > 大写英文 > 小写英文）。
function applyResultUnitRule(
  value: CalcValue,
  seen: SeenUnit[],
  forcedLanguage?: ResultLanguage,
): { value: CalcValue; language: ResultLanguage } {
  const language: ResultLanguage =
    forcedLanguage ??
    (seen.some((unit) => unit.chinese)
      ? "chinese"
      : seen.some((unit) => unit.upper)
        ? "upper"
        : "lower");
  if (!isUnit(value)) return { value, language };
  // 汇总 seen：行内 token + 结果自身分量（scope 变量的分量已在树里收集）。
  const present: SeenUnit[] = [...seen];
  for (const component of value.units) {
    const token = canonicalToken(component);
    if (!present.some((unit) => unit.token.toLowerCase() === token.toLowerCase())) {
      present.push({
        token,
        written: token,
        chinese: false,
        upper: /[A-Z]/.test(token) && token === token.toUpperCase(),
        kind: unitKind(component.unit.name),
        mag: unitMagnitude(token),
      });
    }
  }
  const target = (["metric", "imperial", "market"] as const).find((system) =>
    present.some((unit) => unit.kind === system),
  );
  if (target) {
    const dimensions = JSON.stringify(value.dimensions);
    const candidates = present
      .filter(
        (unit) =>
          unit.kind === target &&
          !unit.token.includes("/") &&
          JSON.stringify(math.unit(1, unit.token).dimensions) === dimensions,
      )
      .sort((a, b) => a.mag - b.mag);
    if (candidates.length && candidates[0].token) {
      try {
        const converted = value.to(candidates[0].token);
        converted.fixPrefix = false;
        converted.skipAutomaticSimplification = true;
        return { value: converted, language };
      } catch {
        // 换算失败保持原样
      }
    } else if (value.units.length === 1) {
      // 没有同量纲候选（如速度 km/hour）：按制式换算表整支换算。
      const map = target === "metric" ? TO_METRIC : target === "imperial" ? TO_IMPERIAL : TO_MARKET;
      const fallback = map[value.units[0].unit.name];
      if (fallback && fallback !== value.units[0].unit.name) {
        try {
          const converted = value.to(fallback);
          converted.fixPrefix = false;
          converted.skipAutomaticSimplification = true;
          return { value: converted, language };
        } catch {
          // 换算失败保持原样
        }
      }
    }
  }
  value.skipAutomaticSimplification = true;
  return { value, language };
}

// 算式语言：中文 > 大写英文 > 小写英文。
function seenLanguage(seen: SeenUnit[]): ResultLanguage {
  return seen.some((unit) => unit.chinese)
    ? "chinese"
    : seen.some((unit) => unit.upper)
      ? "upper"
      : "lower";
}

// 复合单位（如速度）在制式不同时按分量换算到目标制式。
function convertCompoundComponents(value: Unit, target: UnitSystemKind): Unit {
  const numerator: string[] = [];
  const denominator: string[] = [];
  let changed = false;
  for (const component of value.units) {
    const canonical = canonicalToken(component);
    const kind = unitKind(component.unit.name);
    let replacement = canonical;
    if (kind !== target && kind !== "neutral" && kind !== "none") {
      const map = target === "metric" ? TO_METRIC : target === "imperial" ? TO_IMPERIAL : TO_MARKET;
      const candidate = map[component.unit.name];
      if (candidate && !candidate.includes("/")) {
        replacement = candidate;
        changed = true;
      }
    }
    const token =
      Math.abs(component.power) === 1 ? replacement : `${replacement}^${Math.abs(component.power)}`;
    (component.power < 0 ? denominator : numerator).push(token);
  }
  if (!changed || !numerator.length) return value;
  try {
    const target2 = denominator.length
      ? `${numerator.join(" * ")} / ${denominator.join(" / ")}`
      : numerator.join(" * ");
    const converted = value.to(target2);
    converted.fixPrefix = false;
    converted.skipAutomaticSimplification = true;
    return converted;
  } catch {
    return value;
  }
}

export function calculate(
  source: string,
  scope: Scope = new Map(),
  percentages = new Set<string>(),
) {
  if (source.length > 1000) throw new Error("单行算式最多 1000 个字符");
  const expression = normalize(source.trim()).replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (name) => {
    const value = scope.get(name);
    return percentages.has(name) && isBigNumber(value) ? `${value.times(100).toString()}%` : name;
  });
  if (!expression) throw new Error("先输入一个算式");
  const tree = math.parse(expression);
  // 行内单位 token（大小写/中文）+ 作用域变量携带的单位
  const seen = [...scanUnitTokens(source), ...validateTree(tree, scope)];
  // 同一单位有多种中文写法（公斤/千克）时冲突用规范名；只有一种写法则保留原写法。
  const writtenForms = new Map<string, Set<string>>();
  for (const unit of seen) {
    if (!unit.chinese) continue;
    const key = unit.token.toLowerCase();
    const forms = writtenForms.get(key) ?? new Set<string>();
    forms.add(unit.written);
    writtenForms.set(key, forms);
  }
  const chineseNames: Record<string, string> = {};
  for (const [canonical, forms] of writtenForms) {
    chineseNames[canonical] =
      forms.size === 1 ? [...forms][0] : (enToZh[canonical] ?? [...forms][0]);
  }
  let value = validValue(tree.evaluate(scope));
  let language: ResultLanguage = "lower";
  if (isUnit(value)) {
    const cancelled = cancelSameDimension(value);
    const explicit = hasExplicitConversion(tree);
    language = explicit ? seenLanguage(seen) : "lower";
    if (cancelled.cancelled) {
      value = cancelled.value as CalcValue;
      language = explicit ? language : "lower";
    } else if (explicit) {
      // 显式 to 的目标单位原样呈现，不做制式合并、不做最小单位靠拢。
      value.fixPrefix = true;
      value.skipAutomaticSimplification = true;
    } else {
      const applied = applyResultUnitRule(value, seen);
      value = applied.value as Unit;
      language = applied.language;
    }
    if (isUnit(value) && !explicit) {
      // 复合单位在制式不同时的分量换算（速度等）。
      const target = (["metric", "imperial", "market"] as const).find((system) =>
        seen.some((unit) => unit.kind === system),
      );
      if (target) value = convertCompoundComponents(value, target);
      value.fixPrefix = true;
      value.skipAutomaticSimplification = true;
    }
  }
  const percentage = Boolean((tree as MathNode & { isPercentage?: boolean }).isPercentage);
  return {
    value,
    percentage,
    language,
    chineseNames,
    ...formatValue(value, language, chineseNames),
  };
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : "无法计算这一行";
  if (/Units do not match|different base|units must match|unit mismatch/i.test(message)) {
    return "单位不兼容；不同货币暂不支持换算";
  }
  if (
    /Unexpected|Syntax|Value expected|Parenthesis|End of expression|operator|Cannot convert/i.test(
      message,
    )
  ) {
    return "算式还不完整，检查数字、单位和括号";
  }
  return message;
}

export function evaluateNotebook(text: string): LineResult[] {
  const scope: Scope = new Map();
  const percentages = new Set<string>();
  let block: CalcValue[] = [];
  let blockLanguages: ResultLanguage[] = [];
  let blockHasError = false;
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((source): LineResult => {
      const trimmed = source.trim();
      if (!trimmed) {
        block = [];
        blockLanguages = [];
        blockHasError = false;
        return { source, kind: "empty" };
      }
      // # 与 // 作用一致：整行是注释（可当标题），尾部注释剥离后重算。
      if (trimmed.startsWith("#") || trimmed.startsWith("//")) return { source, kind: "note" };
      let expression = trimmed.split("//")[0].split("#")[0].trim();
      const label = expression.search(/[:：]/);
      // 冒号前是纯数字时是比率（16:9），不是“说明: 算式”的标签分隔符。
      if (label >= 0 && !/^-?\d+(?:\.\d+)?$/.test(expression.slice(0, label).trim())) {
        expression = expression.slice(label + 1).trim();
      }
      const assignment = expression.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.*)$/u);
      const name = assignment?.[1];
      if (assignment) expression = assignment[2];
      const isSummary = summaries.has(expression);
      const intent =
        assignment ||
        isSummary ||
        expression === "prev" ||
        scope.has(expression) ||
        constants.has(expression) ||
        /^[\d.()（[{}\]+\-¥￥$€£]/.test(expression) ||
        /[=+*/^%×÷−-]/.test(expression) ||
        /\s-\s/.test(expression) ||
        /\b(?:plus|minus|times|divided by)\b/.test(expression) ||
        /\s+x\s+/.test(expression) ||
        /^[\p{L}_][\p{L}\p{N}_]*\s*[([{]/u.test(expression);
      if (!intent) return { source, kind: "note" };
      try {
        if (name) {
          const conflict = reservedConflict(name);
          if (conflict) throw new Error(conflict);
          scope.delete(name);
          percentages.delete(name);
        }
        let value: CalcValue;
        let percentage = false;
        let language: ResultLanguage = "lower";
        let chineseNames: Record<string, string> = {};
        if (isSummary) {
          if (blockHasError) throw new Error("本段含有错误，请修正后再汇总");
          if (!block.length) throw new Error("本段还没有可汇总的结果");
          value = block
            .slice(1)
            .reduce<CalcValue>((total, item) => validValue(math.add(total, item)), block[0]);
          if (["avg", "average", "平均"].includes(expression))
            value = validValue(math.divide(value, math.bignumber(block.length)));
          // 汇总同样按「制式优先级 + 最小单位」规则呈现。
          const seenUnits: SeenUnit[] = [];
          for (const item of block) {
            if (!isUnit(item)) continue;
            for (const component of item.units) {
              const token = canonicalToken(component);
              if (!seenUnits.some((unit) => unit.token.toLowerCase() === token.toLowerCase())) {
                seenUnits.push({
                  token,
                  written: token,
                  chinese: false,
                  upper: /[A-Z]/.test(token) && token === token.toUpperCase(),
                  kind: unitKind(component.unit.name),
                  mag: unitMagnitude(token),
                });
              }
            }
          }
          const blockLanguage: ResultLanguage = blockLanguages.some((item) => item === "chinese")
            ? "chinese"
            : blockLanguages.some((item) => item === "upper")
              ? "upper"
              : "lower";
          const applied = applyResultUnitRule(value, seenUnits, blockLanguage);
          value = applied.value as CalcValue;
          language = applied.language;
        } else {
          const calculation = calculate(expression, scope, percentages);
          value = calculation.value;
          percentage = calculation.percentage;
          language = calculation.language;
          chineseNames = calculation.chineseNames;
          block.push(value);
          blockLanguages.push(calculation.language);
        }
        if (name) {
          scope.set(name, value);
          if (percentage) percentages.add(name);
        }
        scope.set("prev", value);
        percentages.delete("prev");
        if (percentage) percentages.add("prev");
        return {
          source,
          kind: "result",
          ...formatValue(value, language, chineseNames),
        };
      } catch (error) {
        scope.delete("prev");
        percentages.delete("prev");
        blockHasError = true;
        return { source, kind: "error", error: readableError(error) };
      }
    });
}

// 文本格式化用的单位换算（需要已注册自定义单位的 mathjs 实例）。
export function convertUnitQuantity(value: number, from: string, to: string): number | null {
  try {
    const converted = math.unit(value, from).to(to);
    const number = Number(converted.toNumber(to));
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

export function calculateInput(expression: string) {
  try {
    const { value, language } = calculate(expression);
    const display = math.format(value, formatDisplayNumber);
    return {
      ok: true as const,
      raw: formatUnitSuffix(
        math.format(value, { precision: 64, lowerExp: -8, upperExp: 16 }),
        language,
      ),
      display: formatUnitSuffix(display, language),
    };
  } catch (error) {
    return { ok: false as const, error: readableError(error) };
  }
}
