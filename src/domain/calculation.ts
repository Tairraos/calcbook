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

// 括号按嵌套层级自动换形：最内层 ()，向外 []、{}（{[( )]}，最多 3 层）。
// 计算器输入时实时应用，全文格式化把用户写法收敛到同一形态；
// 求值前三种括号等价（normalize 统一成圆括号），换形不改语义。
// 超过 3 层的写法没有定义形态（求值必报「括号嵌套层数越限」），原样返回。
export function restyleBrackets(expression: string): string {
  const chars = [...expression];
  const depthOf = new Map<number, number>();
  const stack: number[] = [];
  let maxDepth = 0;
  for (let index = 0; index < chars.length; index++) {
    const character = chars[index];
    if ("([{".includes(character)) {
      const depth = stack.length + 1;
      depthOf.set(index, depth);
      if (depth > maxDepth) maxDepth = depth;
      stack.push(index);
    } else if (")]}".includes(character)) {
      const open = stack.pop();
      if (open !== undefined) depthOf.set(index, depthOf.get(open) as number);
    }
  }
  if (maxDepth > 3) return expression;
  // 从内向外数层级：最内层 0 → ()，1 → []，2 → {}（不成对的关括号按第 1 层处理）
  const styles = ["()", "[]", "{}"];
  let out = "";
  for (let index = 0; index < chars.length; index++) {
    const character = chars[index];
    if ("([{".includes(character) || ")]}".includes(character)) {
      const fromInner = maxDepth - (depthOf.get(index) ?? 1);
      const style = styles[Math.min(Math.max(fromInner, 0), 2)];
      out += "([{".includes(character) ? style[0] : style[1];
    } else {
      out += character;
    }
  }
  return out;
}

// 括号嵌套层数：最多 3 层（{[()]}），超出报错。normalize 已把三种括号统一成圆括号。
function checkBracketDepth(expression: string): void {
  let depth = 0;
  for (const character of expression) {
    if (character === "(") {
      if (++depth > 3) throw new Error("括号嵌套层数越限");
    } else if (character === ")") {
      depth--;
    }
  }
}

// % 计算规则（1.6.19）：
// - 唯一的 %/‰ 数字且位于末尾、左侧是顶层 + 或 -：相对其紧邻的左操作数
//   （200 + 10% = 200 + (200×10/100)；100 + 200 + 10% = 100 + 200 + (200×10/100)）。
// - 其余情况（多个、不在末尾、×÷ 之后）：%数字等同小数（N/100、N/1000）。
// mathjs 无法脱糖作为左操作数的 %，也不满足「紧邻操作数」的取基方式，全部在此自行改写。
const PERCENT_TOKEN = /(\d+(?:\.\d+)?)([%‰])/g;

// 紧跟在 percent 左侧的顶层 ± 运算符（含其前缀深度检查）；无则返回 null。
function trailingRelativePercent(
  expression: string,
): { number: string; sign: string; opIndex: number } | null {
  const tokens = [...expression.matchAll(PERCENT_TOKEN)];
  if (tokens.length !== 1) return null;
  const token = tokens[0];
  const start = token.index ?? 0;
  const numberEnd = start + token[0].length;
  // percent 之后只允许一层包住它的 `)`（(10%) 形态），且该括号必须包到表达式末尾
  if (expression[numberEnd] === ")") {
    let depth = 0;
    let open = -1;
    for (let j = numberEnd; j >= 0; j--) {
      const c = expression[j];
      if (c === ")") depth++;
      else if (c === "(") {
        depth--;
        if (depth === 0) {
          open = j;
          break;
        }
      }
    }
    if (open < 0 || numberEnd !== expression.length - 1) return null;
    if (expression.slice(open + 1, start).trim() !== "") return null;
  } else if (numberEnd !== expression.length) {
    return null;
  }
  let i = start - 1;
  while (i >= 0 && /\s/.test(expression[i])) i--;
  // 已验证的包裹括号：(10%) 的 ( 不挡运算符
  if (expression[i] === "(" && expression[numberEnd] === ")") {
    i--;
    while (i >= 0 && /\s/.test(expression[i])) i--;
  }
  const opIndex = i;
  const ch = expression[opIndex];
  if (ch !== "+" && ch !== "-") return null;
  let depth = 0;
  for (let j = 0; j < opIndex; j++) {
    const c = expression[j];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
  }
  if (depth !== 0) return null;
  return { number: token[1], sign: token[2], opIndex };
}

// 从运算符往回取紧邻的左操作数（数字/变量/括号组，含 ×÷ 链）。
function percentOperand(text: string, operatorIndex: number): string {
  let depth = 0;
  let i = operatorIndex - 1;
  while (i >= 0) {
    const ch = text[i];
    if (depth === 0 && (ch === "+" || ch === "-")) break;
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) break;
      depth--;
    }
    i--;
  }
  return text.slice(i + 1, operatorIndex).trim();
}

// 求值前的 % 脱糖：相对位展开为 操作数×(N/100|1000)，其余转为小数。
function desugarPercents(expression: string): string {
  const relative = trailingRelativePercent(expression);
  if (relative) {
    const operand = percentOperand(expression, relative.opIndex);
    if (operand) {
      const per = relative.sign === "‰" ? "1000" : "100";
      return `${expression.slice(0, relative.opIndex + 1)} (${operand} * (${relative.number}/${per}))`;
    }
  }
  return expression.replace(PERCENT_TOKEN, (_, n, sign) => `(${n}/${sign === "‰" ? 1000 : 100})`);
}

// % 计算的规范书写形式（格式化与计算器历史用，1.6.19）：
// 相对位展开为 <操作数> × (N%)，其余 %数字 加括号标记小数语义（已加括号的不重复）。
export function formatPercentForm(expression: string): string {
  const relative = trailingRelativePercent(expression);
  if (relative) {
    const operand = percentOperand(expression, relative.opIndex);
    if (operand) {
      const op = expression[relative.opIndex];
      return `${expression.slice(0, relative.opIndex).trimEnd()} ${op} (${operand} × (${relative.number}${relative.sign}))`;
    }
  }
  // of/on/off 短语里的 % 不加括号（保持短语可被 normalize 识别重排）
  return expression.replace(/(?<!\()(\d+(?:\.\d+)?)([%‰])(?!\))(?!\s*(?:of|on|off)\b)/g, "($1$2)");
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
  // 百分比短语（of/on/off）：重排为标准形态，语义交给统一的 % 脱糖
  //（of = 乘、on = 加、off = 减；10% on 200 → 200 + 10% → 相对 220）
  const phrase = expression.match(/^(-?\d+(?:\.\d+)?)([%‰])\s+(of|on|off)\s+(.+)$/);
  if (phrase) {
    const [, amount, sign, operation, base] = phrase;
    const op = operation === "of" ? "*" : operation === "on" ? "+" : "-";
    expression = `(${base}) ${op} (${amount}${sign})`;
  }
  // 变量后缀 ‰ 按数值处理（x‰ → (x/1000)）；数字后缀的 %/‰ 由 desugarPercents 统一处理
  expression = expression.replace(/([\p{L}_][\p{L}\p{N}_]*)‰/gu, "($1/1000)");
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
  unitSpacing = true,
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
  // unitSpacing=false 时数字与单位紧贴（结果区显示约定）；中文分支本就去除中西文间空格
  const result = formatted.slice(0, unitSpacing ? split + 1 : split) + suffix;
  if (language === "chinese") return result.replace(/ +(\P{ASCII})|(\P{ASCII}) +/gu, "$1$2");
  return result;
}

// 数字宽度：输入数字整数部分最长 16 位、小数部分最长 4 位，超出不计算。
// 在 normalize 之后逐个扫描数字字面量（千分位逗号此时已剥离）。
function checkNumberWidth(expression: string): void {
  for (const match of expression.matchAll(/\d*\.?\d+/g)) {
    const [integer = "", decimal = ""] = match[0].split(".");
    if (integer.replace(/^0+(?=\d)/, "").length > 16 || decimal.length > 4)
      throw new Error("数字宽度超限");
  }
}

// 显示数值：小数最多 4 位（四舍五入），整数部分最长 16 位。
// 千位分隔只作用于整数部分——4 位小数会被全串正则误切（666.6667 → 666.6,667）。
// 舍入后整数部分超过 16 位（含进位到 17 位）报「计算结果数字宽度超限」，
// 与输入侧的「数字宽度超限」区分，不用科学计数法。
function formatDisplayNumber(numeric: BigNumber | number, thousands = true): string {
  const decimal = isBigNumber(numeric) ? numeric : math.bignumber(numeric);
  const rounded = decimal.toDecimalPlaces(4);
  if (rounded.abs().trunc().toFixed().length > 16) throw new Error("计算结果数字宽度超限");
  if (rounded.isZero()) return "0";
  const [intPart, decimalPart] = rounded.toFixed().split(".");
  const grouped = thousands ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : intPart;
  return decimalPart ? `${grouped}.${decimalPart}` : grouped;
}

export function formatValue(
  value: CalcValue,
  language: ResultLanguage = "lower",
  chineseNames: Record<string, string> = {},
  options: { unitSpacing?: boolean; thousands?: boolean } = {},
): { raw: string; display: string } {
  const raw = formatUnitSuffix(
    math.format(value, { precision: 14, lowerExp: -8, upperExp: 16 }),
    language,
    chineseNames,
  );
  const display = formatUnitSuffix(
    math.format(value, (numeric) => formatDisplayNumber(numeric, options.thousands ?? true)),
    language,
    chineseNames,
    options.unitSpacing ?? true,
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
  const rewritten = normalize(source.trim()).replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (name) => {
    const value = scope.get(name);
    return percentages.has(name) && isBigNumber(value) ? `${value.times(100).toString()}%` : name;
  });
  // 百分比标志：整个算式就是一个 %/‰ 数字时，赋值变量携带相对语义（折扣 = 10% → 200 - 折扣 = 180）
  const percentage = /^\(?\s*\d+(?:\.\d+)?[‰%]\s*\)?$/.test(rewritten.trim());
  const expression = desugarPercents(rewritten);
  if (!expression) throw new Error("先输入一个算式");
  checkNumberWidth(expression);
  checkBracketDepth(expression);
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

export function evaluateNotebook(
  text: string,
  options: { unitSpacing?: boolean; resultThousands?: boolean } = {},
): LineResult[] {
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
          ...formatValue(value, language, chineseNames, {
            unitSpacing: options.unitSpacing ?? true,
            thousands: options.resultThousands ?? true,
          }),
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
    const display = math.format(value, (numeric) => formatDisplayNumber(numeric, true));
    return {
      ok: true as const,
      raw: formatUnitSuffix(
        math.format(value, { precision: 64, lowerExp: -8, upperExp: 16 }),
        language,
      ),
      display: formatUnitSuffix(display, language, {}, false),
    };
  } catch (error) {
    return { ok: false as const, error: readableError(error) };
  }
}
