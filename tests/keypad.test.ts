import assert from "node:assert/strict";
import test from "node:test";
import { calculateInput } from "../src/domain/calculation.ts";
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
test("three-place display never rounds the value used for continuation or history", () => {
  const state = type(["1", "÷", "7", "="]);
  assert.equal(state.display, "0.143");
  assert.ok(state.result && state.result.length > 60);
  assert.equal(state.history[0].result, state.result);
  assert.equal(state.history[0].display, "0.143");
  const continued = ["×", "7", "="].reduce(pressKeypad, state);
  const direct = calculateInput("(1/7)*7");
  assert.ok(direct.ok);
  assert.equal(continued.result, direct.raw);
  assert.equal(continued.display, "1");
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
