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
  const result = pressKeypad({ ...initialKeypad, expression: "1e20" }, "=");
  assert.equal(pressKeypad(pressKeypad(result, "±"), "=").result, "-1e+20");
});
