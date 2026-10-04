// 计算器独立窗口的内容：?view=calculator 时由 main.tsx 渲染。
// 窗口「关闭」在 Rust 侧转为隐藏（webview 常驻），算式与历史因此天然保留；
// app 退出即进程结束，下次打开是全新状态。
// 窗口有焦点时键盘整体接管：所有按键都输入算式，不认识的键一律忽略；
// 算式框不可聚焦（无光标进入即无输入法），窗口内不可能进入中文输入。

import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { BookOpen, Delete, History, PenLine } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { calculateInput } from "./domain/calculation.ts";
import { initialKeypad, type KeypadState, pressKeypad } from "./domain/keypad.ts";
import {
  CALCULATOR_HIDE_AFTER_MS,
  CALCULATOR_INSERT_EVENT,
  CALCULATOR_READY_EVENT,
  CALCULATOR_THEME_EVENT,
  enableTitleDragRegions,
  hideCalculatorWindow,
  isDesktopApp,
  NARROW_SIZE,
  readStoredTheme,
  WIDE_SIZE,
} from "./platform/storage.ts";
import { IconButton } from "./ui/IconButton.tsx";
import { playKeyClick } from "./ui/keySound.ts";

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

// 物理键 → 按键：回车是等于，C 是清空，x 与 * 都是乘号，/ 与 \ 都是除号（显示为 × ÷）。
// 表外的键一律忽略；Cmd/Ctrl/Alt 组合键在处理器里先行放行，不属于本表职责。
const keyboardKeys: Record<string, string> = {
  Enter: "=",
  "=": "=",
  Escape: "AC",
  c: "AC",
  C: "AC",
  Backspace: "Backspace",
  "*": "×",
  x: "×",
  X: "×",
  "×": "×",
  "/": "÷",
  "\\": "÷",
  "÷": "÷",
  "+": "+",
  "-": "-",
  "%": "%",
  "(": "(",
  ")": ")",
  ".": ".",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};

export function CalculatorWindow() {
  const [state, setState] = useState<KeypadState>(initialKeypad);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  // 按压态对应的物理键 code，keyup 按 code 配对清除（Shift 组合键松开顺序不影响）
  const pressedCodeRef = useRef<string | null>(null);
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

  // 主题跟随主窗口：启动读工作区，挂载完成后向主窗要一次当前配色（防创建期竞态），
  // 之后主窗切换配色时经事件同步。
  useEffect(() => {
    document.documentElement.dataset.theme = readStoredTheme();
    if (!isDesktopApp) return;
    void emit(CALCULATOR_READY_EVENT).catch(() => {});
    const unlisten = listen<string>(CALCULATOR_THEME_EVENT, (event) => {
      document.documentElement.dataset.theme = event.payload === "dark" ? "dark" : "light";
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // 标题栏为 Overlay：顶部留出红绿灯区域并作为拖拽区（按钮不受影响）。
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void enableTitleDragRegions().then((handler) => {
      dispose = handler;
    });
    return () => dispose?.();
  }, []);

  // 失焦 5 分钟未被再次激活就自动收起；最小化也算失焦。
  useEffect(() => {
    if (!isDesktopApp) return;
    const current = getCurrentWindow();
    let timer: number | undefined;
    const unlisten = current.onFocusChanged(({ payload: focused }) => {
      clearTimeout(timer);
      if (!focused)
        timer = window.setTimeout(() => void hideCalculatorWindow(), CALCULATOR_HIDE_AFTER_MS);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
      clearTimeout(timer);
    };
  }, []);

  // 全窗口键盘接管：识别到的键直接驱动对应按键（按压态 + 按键音），长按自动重复不重复发声；
  // Tab/空格拦下避免挪焦点或触发按钮，其余键原样忽略；Cmd/Ctrl/Alt 组合键留给系统快捷键。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = keyboardKeys[event.key];
      if (key) {
        event.preventDefault();
        // 按压态配对记物理键 code：Shift 先松开时 event.key 会变（Shift+8 的 * 松开成 8），code 不变
        pressedCodeRef.current = event.code;
        setPressedKey(key);
        if (!event.repeat) playKeyClick();
        setState((before) => pressKeypad(before, key));
      } else if (event.key === "Tab" || event.key === " ") {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === pressedCodeRef.current) {
        pressedCodeRef.current = null;
        setPressedKey(null);
      }
    };
    const onBlur = () => {
      pressedCodeRef.current = null;
      setPressedKey(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // 算式屏底色跟随窗口焦点：输入框不可聚焦，窗口有焦点即处于「可输入」状态。
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.calcFocus = document.hasFocus() ? "on" : "off";
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      delete document.documentElement.dataset.calcFocus;
    };
  }, []);

  function toggleHistory() {
    setHistoryOpen((open) => {
      const next = !open;
      if (isDesktopApp) {
        const size = next ? WIDE_SIZE : NARROW_SIZE;
        void getCurrentWindow()
          .setSize(new LogicalSize(size.width, size.height))
          .catch(() => {});
      }
      return next;
    });
  }

  async function insert(expression: string) {
    try {
      await emit(CALCULATOR_INSERT_EVENT, expression);
    } catch {
      // 非 Tauri 环境按钮已禁用；发送失败不惊扰用户。
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refit after React updates the displayed text.
  useLayoutEffect(() => {
    const answer = answerRef.current;
    const text = answerTextRef.current;
    if (!answer || !text) return;
    const fit = () => {
      text.style.fontSize = "34px";
      const width = text.getBoundingClientRect().width;
      if (width && answer.clientWidth)
        text.style.fontSize = `${Math.min(34, Math.floor((34 * (answer.clientWidth - 2)) / width))}px`;
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
    <div className="calculator-window">
      <div className="calc-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className={`calculator-inner ${historyOpen ? "has-history" : ""}`}>
        <div className="calc-main">
          <div className="calc-header" data-tauri-drag-region>
            <IconButton
              className="calc-history-toggle"
              title={historyOpen ? "隐藏最近计算" : "显示最近计算"}
              aria-pressed={historyOpen}
              onClick={toggleHistory}
            >
              <BookOpen size={13} />
              历史
            </IconButton>
          </div>
          <div className="calc-screen">
            <div className="calc-screen-caption">
              {/* 出错时原位替换「随手算一算」，错误消失再换回来——不新增行，键盘不抖动。 */}
              <span className={state.error ? "calc-error" : undefined} role="status">
                {state.error ?? "随手算一算"}
              </span>
            </div>
            <input
              className="calc-expression"
              aria-label="计算器算式"
              placeholder="输入算式"
              value={state.expression}
              readOnly
              tabIndex={-1}
              spellCheck={false}
              autoComplete="off"
              maxLength={200}
              onMouseDown={(event) => {
                // 算式框不接受光标：聚焦就可能激活输入法转入中文；输入只走键盘接管与按键。
                event.preventDefault();
              }}
            />
            <output ref={answerRef} className="calc-answer" aria-label="计算器结果" title={display}>
              <span ref={answerTextRef}>{display}</span>
            </output>
          </div>
          <div className="keypad">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={keyLabels[key] ?? key}
                className={`calc-key ${key === "=" ? "key-equals" : ""} ${/[÷×+-]/.test(key) ? "key-operator" : ""} ${["AC", "(", ")", "Backspace", "±", "%"].includes(key) ? "key-function" : ""} ${key === pressedKey ? "is-pressed" : ""}`}
                onPointerDown={(event) => {
                  if (event.button === 0) {
                    event.preventDefault();
                    playKeyClick();
                  }
                }}
                onClick={() => press(key)}
              >
                {key === "Backspace" ? <Delete size={19} /> : key === "-" ? "−" : key}
              </button>
            ))}
          </div>
        </div>
        {historyOpen && (
          <aside className="calc-history-sidebar" aria-label="最近计算">
            <div className="calc-history-heading">
              <span>
                <History size={14} />
                最近计算
              </span>
              {state.history.length > 0 && (
                <button
                  type="button"
                  className="history-clear"
                  title="清空计算历史"
                  onClick={() => setState((before) => ({ ...before, history: [] }))}
                >
                  清空
                </button>
              )}
            </div>
            {state.history.length === 0 ? (
              <div className="history-empty">
                <span className="history-empty-line" />
                <span>按下等号，把结果留在这里</span>
              </div>
            ) : (
              <div className="calc-history">
                {state.history.map((item) => (
                  <div className="calc-history-row" key={item.expression}>
                    <button
                      type="button"
                      className="history-use"
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
                      <strong>= {item.result}</strong>
                    </button>
                    <button
                      type="button"
                      className="history-insert"
                      disabled={!isDesktopApp}
                      title="把这条算式插入笔记"
                      onClick={() => void insert(item.expression)}
                    >
                      <PenLine size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
