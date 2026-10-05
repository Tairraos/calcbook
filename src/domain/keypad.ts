import { calculateInput, restyleBrackets } from "./calculation.ts";

// result 是可复用继续计算的结果值（与显示一致的四位精度），expression 保留原始算式供回看与写回笔记。
export type HistoryItem = { expression: string; result: string };
export type KeypadState = {
  expression: string;
  display: string;
  result: string | null;
  error: string | null;
  history: HistoryItem[];
};
export const initialKeypad: KeypadState = {
  expression: "",
  display: "0",
  result: null,
  error: null,
  history: [],
};

// 未闭合的开括号数（计算器输入期三种括号等价，直接按字符计数）。
function unclosedDepth(expression: string): number {
  let depth = 0;
  for (const character of expression) {
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character) && depth > 0) depth--;
  }
  return depth;
}

// 无效括号（1.6.15）：括号里只有纯数字的括号（如 2×(8)、嵌套的 2×((8))）不影响求值，
// 等号时逐层删掉再计算，历史与「插入笔记」存删除后的算式。
// 带负号的 (-8) 与百分号 (50%) 保留（前者括号有区分作用，后者剥离会改变
// mathjs 对百分比与加减号的解析路径导致报错）；输入守卫保证数字不与括号直接粘连，
// 删除不会产生 5(8)→58 这类并排。
function stripNumberOnlyBrackets(source: string): string {
  let current = source;
  for (;;) {
    const next = current.replace(/[([{]([^([{)\]}]+)[)\]}]/g, (pair, content: string) =>
      /^\d+(?:\.\d+)?$/.test(content) ? content : pair,
    );
    if (next === current) return next;
    current = next;
  }
}

export function pressKeypad(state: KeypadState, key: string): KeypadState {
  if (key === "AC" || key === "Escape") return { ...initialKeypad, history: state.history };
  if (key === "=" || key === "Enter") {
    if (!state.expression || state.result !== null) return state;
    // 容错（1.6.13/1.6.14/1.6.15）：等号时先剥掉末尾悬挂的运算符，再自动补齐未闭合的
    // 关括号，然后删除括号里只有数字的无效括号；补整/删除后仍是错误表达式的，
    // 显示具体错误（结果位置不出现数值）。历史存最终算式。
    let source = state.expression;
    while (source.length > 1 && /[+\-*/×÷]$/.test(source)) source = source.slice(0, -1);
    const missing = unclosedDepth(source);
    if (missing > 0) source = restyleBrackets(source + ")".repeat(missing));
    source = stripNumberOnlyBrackets(source);
    const outcome = calculateInput(source);
    if (!outcome.ok) return { ...state, error: outcome.error };
    // 算式框、续算基值与历史条目一律用不带千分位逗号的同值（1.6.14）：
    // ± / 退格 / 宽度检查都按纯数字处理——在带逗号的显示值上按 ± 会产出 3,(-999) 这类坏算式。
    // 结果大字（display）仍按显示约定带千分位。
    const plain = outcome.display.replace(/,/g, "");
    return {
      ...state,
      // 等号后算式框与结果列同时变成结果值；续算、退格都基于显示精度。
      expression: plain,
      result: plain,
      display: outcome.display,
      error: null,
      history: [
        { expression: source, result: plain },
        ...state.history.filter((item) => item.expression !== source),
      ].slice(0, 20),
    };
  }
  let expression = state.result === null ? state.expression : state.result;
  if (key === "Backspace") expression = expression.slice(0, -1);
  else if (key === "±") {
    if (!expression) return state;
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(expression))
      expression = expression.startsWith("-") ? expression.slice(1) : `-${expression}`;
    else if (/\(-(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\)$/i.test(expression))
      expression = expression.replace(/\(-((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\)$/i, "$1");
    else {
      // 包裹成 (-N) 会新增一层括号嵌套：已在第 3 层内时不再包裹，防越限
      if (unclosedDepth(expression) >= 3) return state;
      expression = expression.replace(/((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i, "(-$1)");
    }
  } else {
    if (!/^[\d.+\-*/()%×÷]$/.test(key)) return state;
    if (state.result !== null && /^[\d.(]$/.test(key)) expression = "";
    if (expression.length >= 200) return state;
    // 输入容错（1.6.13）：数字不跟在关括号后（)8 的 8 没有反应）；% 只跟在数字后
    //（单独输入、跟在运算符/关括号后都没反应，连续 % 天然只留一个）。
    if (/^\d$/.test(key) && /[)\]}]$/.test(expression)) return state;
    if (key === "%") {
      if (!/\d$/.test(expression)) return state;
    } else if (key === ".") {
      // 小数点：连续输入只留一个；不跟在关括号/百分号后（开括号/运算符后先补 0）
      if (/\d*\.\d*$/.test(expression) || /[)%\]}]$/.test(expression)) return state;
      if (!expression || /[+\-*/×÷(]$/.test(expression)) expression += "0";
    } else if (key === ")") {
      // 没有未闭合的开括号时关括号没反应；也只能跟在数字/百分号/关括号后
      if (!/[\d%)\]}]$/.test(expression) || unclosedDepth(expression) === 0) return state;
    } else if (key === "(") {
      // 括号最多 3 层；跟在数字/百分号/关括号后自动补乘号（8( → 8×(，一输完立刻出现）
      if (unclosedDepth(expression) >= 3) return state;
      if (/[\d.%)\]}]$/.test(expression)) expression += "×";
    }
    if (/^[+*/×÷]$/.test(key) && !expression) return state;
    // 运算符连续输入就是修改：末尾运算符被新运算符替换（+ 再 - 只留 -）
    if (/^[+\-*/×÷]$/.test(key) && /[+\-*/×÷]$/.test(expression))
      expression = expression.slice(0, -1);
    if (/^[+\-*/×÷]$/.test(key) && /\($/.test(expression) && key !== "-") return state; // 开括号后只接受 -（负数），其余运算符拒绝
    if (/^\d$/.test(key) && expression === "0") expression = "";
    // 数字宽度封顶（1.6.11）：整数 16 位、小数 4 位——继续输入该数字超限时按键无反应。
    // 只查正在输入的这一段（从上一运算符/括号之后），算式其余部分不参与。
    if (/^[\d.]$/.test(key)) {
      const segment = expression.split(/[+\-*/×÷(){}[\]%]/).pop() ?? "";
      const [integer = "", decimal = ""] = `${segment}${key}`.split(".");
      if (integer.replace(/^0+(?=\d)/, "").length > 16 || decimal.length > 4) return state;
    }
    if (key === "(" || key === ")") expression = restyleBrackets(expression + key);
    else expression += key;
  }
  return { ...state, expression, display: expression || "0", result: null, error: null };
}
