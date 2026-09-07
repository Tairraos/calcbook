import { CornerDownLeft, Delete, History, Keyboard, RotateCcw, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useLayoutEffect, useRef } from "react";
import { calculateInput } from "../domain/calculation.ts";
import { type KeypadState, pressKeypad } from "../domain/keypad.ts";
import type { CalculatorMode } from "../domain/notebook.ts";
import { IconButton } from "./IconButton.tsx";

const keys = [
  "AC",
  "(",
  ")",
  "Backspace",
  "7",
  "8",
  "9",
  "÷",
  "4",
  "5",
  "6",
  "×",
  "1",
  "2",
  "3",
  "-",
  "±",
  "0",
  ".",
  "+",
  "%",
  "=",
];
const keyLabels: Record<string, string> = {
  AC: "清空",
  Backspace: "退格",
  "±": "正负切换",
  "÷": "除",
  "×": "乘",
  "-": "减",
  "+": "加",
  "=": "等于",
  "%": "百分比",
  "(": "左括号",
  ")": "右括号",
  ".": "小数点",
};

export function Calculator({
  onClose,
  onInsert,
  canInsert,
  state,
  setState,
  mode,
}: {
  onClose: () => void;
  onInsert: (expression: string) => void;
  canInsert: boolean;
  state: KeypadState;
  setState: Dispatch<SetStateAction<KeypadState>>;
  mode: CalculatorMode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLOutputElement>(null);
  const answerTextRef = useRef<HTMLSpanElement>(null);
  const outcome = state.expression ? calculateInput(state.expression) : null;
  const display =
    state.result !== null
      ? state.display
      : outcome?.ok
        ? outcome.display
        : state.expression
          ? "…"
          : "0";
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refit after React updates the displayed text.
  useLayoutEffect(() => {
    const answer = answerRef.current;
    const text = answerTextRef.current;
    if (!answer || !text) return;
    const fit = () => {
      text.style.fontSize = "38px";
      const width = text.getBoundingClientRect().width;
      if (width && answer.clientWidth)
        text.style.fontSize = `${Math.min(38, Math.floor((38 * (answer.clientWidth - 2)) / width))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(answer);
    return () => observer.disconnect();
  }, [display]);
  function press(key: string) {
    setState((before) => pressKeypad(before, key));
  }
  return (
    <aside className="calculator-panel" aria-label="普通计算器">
      <div className="panel-heading">
        <span>
          计算器 <span className="small-tag">标准</span>
        </span>
        <IconButton title="收起计算器" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="calculator-inner">
        <div className="calc-screen">
          <div className="calc-screen-caption">
            <span>随手算一算</span>
            <Keyboard size={14} />
          </div>
          <input
            ref={inputRef}
            className="calc-expression"
            aria-label="计算器算式"
            placeholder="输入算式"
            value={state.expression}
            spellCheck={false}
            autoComplete="off"
            maxLength={200}
            onChange={(event) =>
              setState((before) => ({
                ...before,
                expression: event.target.value,
                result: null,
                error: null,
              }))
            }
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" || event.key === "=" || event.key === "Escape") {
                event.preventDefault();
                if (event.key === "Escape" && mode === "dialog") onClose();
                else press(event.key);
              } else if (
                state.result !== null &&
                (/^[\d.(+\-*/%]$/.test(event.key) || event.key === "Backspace") &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                press(event.key);
              }
            }}
          />
          <output ref={answerRef} className="calc-answer" aria-label="计算器结果" title={display}>
            <span ref={answerTextRef}>{display}</span>
          </output>
          <div className="calc-error" role="status">
            {state.error ?? ""}
          </div>
        </div>
        <div className="keypad">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={keyLabels[key] ?? key}
              className={`calc-key ${key === "=" ? "key-equals" : ""} ${/[÷×+-]/.test(key) ? "key-operator" : ""} ${["AC", "(", ")", "Backspace", "±", "%"].includes(key) ? "key-function" : ""}`}
              onPointerDown={(event) => {
                if (event.button === 0) event.preventDefault();
              }}
              onClick={(event) => {
                press(key);
                if (event.detail > 0 && document.activeElement !== inputRef.current)
                  inputRef.current?.focus({ preventScroll: true });
              }}
            >
              {key === "Backspace" ? <Delete size={19} /> : key === "-" ? "−" : key}
            </button>
          ))}
        </div>
        <button
          className="insert-result"
          type="button"
          disabled={!outcome?.ok || !canInsert}
          onClick={() => onInsert(state.expression)}
        >
          <CornerDownLeft size={15} />
          写入当前笔记
        </button>
        <div className="calc-history-heading">
          <span>
            <History size={14} />
            最近计算
          </span>
          {state.history.length > 0 && (
            <IconButton
              title="清空计算历史"
              onClick={() => setState((before) => ({ ...before, history: [] }))}
            >
              <RotateCcw size={13} />
            </IconButton>
          )}
        </div>
        {state.history.length === 0 ? (
          <div className="history-empty">
            <span className="history-empty-line" />
            <span>按下等号，把结果留在这里</span>
          </div>
        ) : (
          <div className="calc-history">
            {state.history.slice(0, 4).map((item) => (
              <button
                type="button"
                key={item.expression}
                onClick={() =>
                  setState((before) => ({
                    ...before,
                    expression: item.result,
                    result: null,
                    error: null,
                  }))
                }
                title="使用这个结果继续计算"
              >
                <span>{item.expression}</span>
                <strong>= {item.display}</strong>
              </button>
            ))}
          </div>
        )}
        <p className="calculator-tip">一个答案，也可以是一段思路的开始。</p>
      </div>
    </aside>
  );
}
