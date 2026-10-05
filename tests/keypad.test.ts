import assert from "node:assert/strict";
import test from "node:test";
import { initialKeypad, pressKeypad } from "../src/domain/keypad.ts";

const type = (keys: string[]) => keys.reduce(pressKeypad, initialKeypad);
test("keypad shares percentage and decimal semantics with notes", () => {
  assert.equal(type(["2", "0", "0", "+", "1", "0", "%", "="]).result, "220");
  assert.equal(type(["0", ".", "1", "+", "0", ".", "2", "="]).result, "0.3");
});
test("continue from a result and keep history on clear", () => {
  const state = type(["2", "+", "3", "="]);
  assert.equal(pressKeypad(pressKeypad(pressKeypad(state, "×"), "4"), "=").result, "20");
  assert.equal(pressKeypad(state, "8").expression, "8");
  assert.equal(pressKeypad(state, "AC").history.length, 1);
  assert.equal(pressKeypad(state, "=").history.length, 1);
});
test("editing controls and invalid arithmetic", () => {
  assert.equal(type([".", "5", "="]).result, "0.5");
  assert.equal(type(["1", ".", ".", "2"]).expression, "1.2");
  assert.equal(type(["8", "8", "Backspace"]).expression, "8");
  assert.equal(type(["2", "+", "3", "±", "="]).result, "-1");
  assert.equal(type(["8", "÷", "0", "="]).result, null);
  assert.ok(type(["8", "÷", "0", "="]).error);
});
test("equals rewrites input and result to the same four-place value", () => {
  const state = type(["1", "÷", "3", "="]);
  assert.equal(state.expression, "0.3333");
  assert.equal(state.display, "0.3333");
  assert.equal(state.result, "0.3333");
  assert.equal(state.history[0].expression, "1÷3");
  assert.equal(state.history[0].result, "0.3333");
  assert.equal(pressKeypad(state, "Backspace").expression, "0.333");
});
test("continuation, sign toggle and history reuse run on the displayed precision", () => {
  const state = type(["1", "÷", "7", "="]);
  assert.equal(state.display, "0.1429");
  const continued = ["×", "7", "="].reduce(pressKeypad, state);
  assert.equal(continued.display, "1.0003");
  assert.equal(continued.expression, "1.0003");
  assert.equal(pressKeypad(state, "AC").history[0].result, "0.1429");
});
test("sign toggle preserves scientific notation and leading decimals", () => {
  for (const [expression, toggled] of [
    ["1e20", "-1e20"],
    [".5", "-.5"],
    ["2+1e20", "2+(-1e20)"],
  ]) {
    const state = { ...initialKeypad, expression };
    assert.equal(pressKeypad(state, "±").expression, toggled);
    assert.equal(pressKeypad(pressKeypad(state, "±"), "±").expression, expression);
  }
  // 数字宽度上限（1.6.10）：1e20 是 21 位整数，等号后报「计算结果数字宽度超限」而非科学计数法结果
  const overflow = pressKeypad({ ...initialKeypad, expression: "1e20" }, "=");
  assert.equal(overflow.result, null);
  assert.equal(overflow.error, "计算结果数字宽度超限");
});
test("brackets restyle by nesting depth and input guards block invalid expressions", () => {
  // 用户约定：((8 + 2) × 3) × 4 输入时自动变成 [(8+2)×3]×4——外层随嵌套变 [] {}
  const user = type(["(", "(", "8", "+", "2", ")", "×", "3", ")", "×", "4"]);
  assert.equal(user.expression, "[(8+2)×3]×4");
  assert.equal(type(["(", "(", "(", "1", "+", "2", ")", ")", ")"]).expression, "{[(1+2)]}");
  assert.equal(type(["(", "(", "(", "1", "+", "2", ")", ")", ")", "×", "3", "="]).result, "9");
  // 同层的兄弟括号：关括号后的开括号自动补 ×（1.6.13 容错）
  assert.equal(type(["(", "8", "+", "2", ")", "(", "3"]).expression, "(8+2)×(3");
  assert.equal(type(["(", "8", "+", "2", ")", "(", "3", ")", ")"]).expression, "(8+2)×(3)");
  // 守卫：开括号跟数字自动补 ×、关括号必须有未闭合的开括号且不能紧跟开括号/运算符、最多 3 层
  assert.equal(type(["2", "("]).expression, "2×(");
  assert.equal(type([")"]).expression, "");
  assert.equal(type(["(", ")"]).expression, "(");
  assert.equal(type(["2", "+", ")"]).expression, "2+");
  assert.equal(type(["(", "+"]).expression, "(");
  assert.equal(type(["(", "-", "3", ")"]).expression, "(-3)");
  assert.equal(type(["(", "(", "(", "1", "+", "("]).expression, "{[(1+");
  // 运算符不连续：末尾运算符被替换（含 -，负数用 ± 键）；% 只跟在数字后
  assert.equal(type(["2", "+", "×"]).expression, "2×");
  assert.equal(type(["2", "+", "-"]).expression, "2-");
  assert.equal(type(["2", "+", "%"]).expression, "2+");
  assert.equal(type(["(", "0", ".", "5", "%", ")"]).expression, "(0.5%)");
});
test("expression after equals carries no thousands separators", () => {
  // 结果大字仍带千分位；算式框、续算基值与历史条目是同值的纯数字形态
  const state = type([..."3999", "="]);
  assert.equal(state.display, "3,999");
  assert.equal(state.expression, "3999");
  assert.equal(state.result, "3999");
  assert.equal(state.history[0].result, "3999");
  // ± 在纯数字形态上正常翻转，不再产出 3,(-999) 这类坏算式
  const toggled = pressKeypad(state, "±");
  assert.equal(toggled.expression, "-3999");
  assert.equal(pressKeypad(toggled, "=").result, "-3999");
  // 续算与 16 位结果同样不带逗号
  assert.equal(pressKeypad(state, "+").expression, "3999+");
  const big = type([..."9999999999999999", "="]);
  assert.equal(big.expression, "9999999999999999");
  assert.equal(big.display, "9,999,999,999,999,999");
});
test("input tolerance on equals: auto-close brackets and strip dangling operators", () => {
  // 有开括号没关括号：等号自动补齐关括号后再算
  const closed = type(["(", "8", "+", "2", "="]);
  assert.equal(closed.result, "10");
  assert.equal(closed.history[0].expression, "(8+2)");
  assert.equal(type(["(", "(", "(", "1", "+", "2", "="]).result, "3");
  assert.equal(type(["(", "8", "+", "2", "=", "×", "3", "="]).result, "30");
  // 补齐后仍是错误表达式 → 显示错误，不给出数值
  const bad = type(["2", "×", "(", "="]);
  assert.equal(bad.result, null);
  assert.ok(bad.error);
  // 末尾悬挂的运算符：等号先剥掉再算（2+ = → 2）
  assert.equal(type(["2", "+", "="]).result, "2");
  assert.equal(type(["2", "+", "3", "×", "="]).result, "5");
  // 负数参与运算用 ± 键：8÷2± → 8÷(-2) → -4
  assert.equal(type(["8", "÷", "2", "±", "="]).result, "-4");
});
test("digit input is capped at 16 integer digits and 4 decimals", () => {
  // 整数到 16 位后再按数字无反应
  const full = type([..."9999999999999999"]);
  assert.equal(full.expression, "9999999999999999");
  assert.equal(type([..."9999999999999999", "7"]).expression, "9999999999999999");
  // 小数满 4 位后再按数字无反应
  const decimal = type([..."0.1234"]);
  assert.equal(decimal.expression, "0.1234");
  assert.equal(type([..."0.1234", "5"]).expression, "0.1234");
  // 运算符后是新的一段数字，可以继续输入
  const next = type([..."9999999999999999", "+", "1"]);
  assert.equal(next.expression, "9999999999999999+1");
  // 前导零也计入小数位（与笔记侧字面规则一致）：0.0001 之后第 5 位小数被拦
  assert.equal(type(["0", ".", "0", "0", "0", "1", "2"]).expression, "0.0001");
  // 退格后可以继续输入
  assert.equal(pressKeypad(full, "Backspace").expression, "999999999999999");
});
