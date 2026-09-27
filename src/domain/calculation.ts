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
  caseUnitAliases,
  cancelSameDimension,
  isKnownUnitLower,
  parseUnitAliases,
  preferMetric,
  registerCustomUnits,
  type UnitSides,
  unitKind,
  valueSides,
} from "./units.ts";

const math = create(all, { number: "BigNumber", precision: 64, predictable: true });
registerCustomUnits(math);
const originalIsAlpha = math.parse.isAlpha;
math.parse.isAlpha = (character, previous, next) =>
  /^\p{L}$/u.test(character) || originalIsAlpha(character, previous, next);
for (const currency of ["CNY", "USD", "EUR", "GBP"]) math.createUnit(currency);

export type CalcValue = BigNumber | Unit;
type Scope = Map<string, CalcValue>;
export type LineResult = {
  kind: "empty" | "note" | "heading" | "result" | "error";
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
const summaries = new Set(["sum", "total", "合计", "avg", "average", "平均"]);
const aliases: Record<string, string> = parseUnitAliases;
const currencySymbols: Record<string, string> = {
  "¥": "CNY",
  "￥": "CNY",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

function normalizeMultiplication(expression: string): string {
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
    .replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (word) =>
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

function validateTree(tree: MathNode, scope: Scope): UnitSides {
  let count = 0;
  const sides: UnitSides = { imperial: false, metric: false };
  const see = (name: string) => {
    if (scope.has(name)) {
      const fromScope = valueSides(scope.get(name));
      sides.imperial ||= fromScope.imperial;
      sides.metric ||= fromScope.metric;
      return;
    }
    const kind = unitKind(name);
    if (kind === "imperial") sides.imperial = true;
    if (kind === "metric") sides.metric = true;
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
  return sides;
}

// 结果里的英文单位统一成小写缩写（规则允许保留英文时）；小写形式经单位表可重新解析。
function lowercaseUnitSuffix(formatted: string): string {
  const split = formatted.indexOf(" ");
  if (split === -1) return formatted;
  const suffix = formatted.slice(split + 1).replace(/([A-Za-z][A-Za-z0-9]*)/g, (token) =>
    isKnownUnitLower(token.toLowerCase()) ? token.toLowerCase() : token,
  );
  return formatted.slice(0, split + 1) + suffix;
}

export function formatValue(value: CalcValue): { raw: string; display: string } {
  const raw = lowercaseUnitSuffix(math.format(value, { precision: 14, lowerExp: -8, upperExp: 16 }));
  const display = raw.replace(/^(-?\d+)(?=\.|\s|$)/, (digits) =>
    digits.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
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
  const used = validateTree(tree, scope);
  let value = validValue(tree.evaluate(scope));
  if (isUnit(value)) {
    const cancelled = cancelSameDimension(value);
    if (cancelled.cancelled) {
      value = cancelled.value as CalcValue;
      if (isUnit(value)) value.skipAutomaticSimplification = true;
    } else if (hasExplicitConversion(tree)) {
      // 显式 to 的目标单位原样呈现，不做公制合并、不做自动换档。
      value.fixPrefix = true;
      value.skipAutomaticSimplification = true;
    } else {
      // 公制英制混用时把英制并入公制；保留用户写下的单位与前缀，不做自动换档。
      const preferred = preferMetric(value, used);
      if (preferred.converted) value = preferred.value as Unit;
      else value.fixPrefix = true;
      // createUnit 注册的自定义单位会成为 mathjs 自动简化的目标（如 km/h 被简写成 knot）；
      // 显示一律保留原单位，需要换算时用显式 to。
      value.skipAutomaticSimplification = true;
    }
  }
  const percentage = Boolean((tree as MathNode & { isPercentage?: boolean }).isPercentage);
  return { value, percentage, ...formatValue(value) };
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
  let blockHasError = false;
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((source): LineResult => {
      const trimmed = source.trim();
      if (!trimmed) {
        block = [];
        blockHasError = false;
        return { source, kind: "empty" };
      }
      if (trimmed.startsWith("#")) return { source, kind: "heading" };
      if (trimmed.startsWith("//")) return { source, kind: "note" };
      let expression = trimmed.split("//")[0].trim();
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
        if (isSummary) {
          if (blockHasError) throw new Error("本段含有错误，请修正后再汇总");
          if (!block.length) throw new Error("本段还没有可汇总的结果");
          value = block
            .slice(1)
            .reduce<CalcValue>((total, item) => validValue(math.add(total, item)), block[0]);
          if (["avg", "average", "平均"].includes(expression))
            value = validValue(math.divide(value, math.bignumber(block.length)));
          // 段内公制英制混用时，汇总结果同样并入公制。
          const used = block.reduce<UnitSides>(
            (sides, item) => {
              const part = valueSides(item);
              return {
                imperial: sides.imperial || part.imperial,
                metric: sides.metric || part.metric,
              };
            },
            { imperial: false, metric: false },
          );
          const preferred = preferMetric(value, used);
          if (preferred.converted) value = preferred.value as Unit;
          else if (isUnit(value)) value.fixPrefix = true;
          if (isUnit(value)) value.skipAutomaticSimplification = true;
        } else {
          const calculation = calculate(expression, scope, percentages);
          value = calculation.value;
          percentage = calculation.percentage;
          block.push(value);
        }
        if (name) {
          scope.set(name, value);
          if (percentage) percentages.add(name);
        }
        scope.set("prev", value);
        percentages.delete("prev");
        if (percentage) percentages.add("prev");
        return { source, kind: "result", ...formatValue(value) };
      } catch (error) {
        scope.delete("prev");
        percentages.delete("prev");
        blockHasError = true;
        return { source, kind: "error", error: readableError(error) };
      }
    });
}

export function calculateInput(expression: string) {
  try {
    const { value } = calculate(expression);
    const display = math.format(value, (numeric: BigNumber | number) => {
      const decimal = isBigNumber(numeric) ? numeric : math.bignumber(numeric);
      const rounded = decimal.toDecimalPlaces(3);
      if (rounded.abs().gte("1e10")) {
        return decimal.toExponential(3).replace(/\.?0+e/, "e");
      }
      if (rounded.isZero()) return "0";
      return rounded.toFixed().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    });
    return {
      ok: true as const,
      raw: lowercaseUnitSuffix(math.format(value, { precision: 64, lowerExp: -8, upperExp: 16 })),
      display: lowercaseUnitSuffix(display),
    };
  } catch (error) {
    return { ok: false as const, error: readableError(error) };
  }
}
