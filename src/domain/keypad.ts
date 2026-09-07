import { calculateInput } from "./calculation.ts";

export type HistoryItem = { expression: string; result: string; display: string };
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

export function pressKeypad(state: KeypadState, key: string): KeypadState {
  if (key === "AC" || key === "Escape") return { ...initialKeypad, history: state.history };
  if (key === "=" || key === "Enter") {
    if (!state.expression || state.result !== null) return state;
    const outcome = calculateInput(state.expression);
    if (!outcome.ok) return { ...state, error: outcome.error };
    return {
      ...state,
      result: outcome.raw,
      display: outcome.display,
      error: null,
      history: [
        { expression: state.expression, result: outcome.raw, display: outcome.display },
        ...state.history.filter((item) => item.expression !== state.expression),
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
    else expression = expression.replace(/((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i, "(-$1)");
  } else {
    if (!/^[\d.+\-*/()%×÷]$/.test(key)) return state;
    if (state.result !== null && /^[\d.(]$/.test(key)) expression = "";
    if (expression.length >= 200) return state;
    if (/^[+*/×÷]$/.test(key) && !expression) return state;
    if (/^[+*/×÷]$/.test(key) && /[+\-*/×÷]$/.test(expression))
      expression = expression.slice(0, -1);
    if (key === "." && /\d*\.\d*$/.test(expression)) return state;
    if (key === "." && (!expression || /[+\-*/×÷(]$/.test(expression))) expression += "0";
    if (/^\d$/.test(key) && expression === "0") expression = "";
    expression += key;
  }
  return { ...state, expression, display: expression || "0", result: null, error: null };
}
