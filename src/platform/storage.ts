import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseNoteBody, serializeNoteBody } from "../domain/format.ts";
import { parseWorkspace, type Workspace } from "../domain/notebook.ts";

export const STORAGE_KEY = "calcbook.workspace.v1";
export type StorageInfo = { directory: string; defaultDirectory: string; canChoose: boolean };
export const hasNativeTitlebar = isTauri();
export const isDesktopApp = isTauri();

// 计算器独立窗口：窗口由 Rust 按需创建，「关闭」即隐藏，状态常驻到 app 退出。
export const CALCULATOR_INSERT_EVENT = "calculator://insert";
export const CALCULATOR_VISIBILITY_EVENT = "calculator://visible";
export const CALCULATOR_THEME_EVENT = "calculator://theme";
export const CALCULATOR_READY_EVENT = "calculator://ready";
// 失焦 5 分钟未被再次激活自动收起。
export const CALCULATOR_HIDE_AFTER_MS = 5 * 60 * 1000;
export const NARROW_SIZE = { width: 300, height: 500 };
// 侧栏 300px；计算器主体保持 300px 面积不变。
export const WIDE_SIZE = { width: 600, height: 500 };

export type CalculatorStatus = { visible: boolean; minimized: boolean };

export async function toggleCalculator(): Promise<CalculatorStatus> {
  if (!isTauri()) throw new Error("计算器窗口仅在桌面版可用。");
  return invoke("toggle_calculator");
}

export async function calculatorStatus(): Promise<CalculatorStatus> {
  if (!isTauri()) return { visible: false, minimized: false };
  return invoke("calculator_state");
}

export async function hideCalculatorWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_calculator");
}

// 计算器子窗口启动时读取工作区配色；主题变化经 CALCULATOR_THEME_EVENT 增量同步。
export function readStoredTheme(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const theme = raw ? (JSON.parse(raw)?.theme ?? "paper") : "paper";
    return theme === "midnight" ? "midnight" : "paper";
  } catch {
    return "paper";
  }
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return isTauri()
    ? invoke("storage_info")
    : { directory: "此浏览器的本地存储", defaultDirectory: "~/.calcbook", canChoose: false };
}

export async function chooseStorageDirectory(): Promise<StorageInfo | null> {
  if (!isTauri()) throw new Error("请在桌面应用中选择文件存储位置。");
  return invoke("choose_storage_directory");
}

export async function openProject(url: string): Promise<void> {
  if (isTauri()) await invoke("open_project");
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const data: unknown = isTauri()
    ? await invoke("load_workspace")
    : (() => {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw === null ? null : JSON.parse(raw);
      })();
  if (data === null) return null;
  const workspace = parseWorkspace(data);
  // 桌面版正文来自 Numi 兼容的 .txt：导入时剥掉保存时自动追加的 “= 结果”，内存里只留源表达式。
  return isTauri()
    ? {
        ...workspace,
        notes: workspace.notes.map((note) => ({ ...note, body: parseNoteBody(note.body) })),
      }
    : workspace;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const validated = parseWorkspace(workspace);
  if (isTauri()) {
    await invoke("save_workspace", {
      workspace: {
        ...validated,
        // 保存时按 Numi 格式把计算结果写回行尾，文件可直接用 Numi 打开。
        notes: validated.notes.map((note) => ({ ...note, body: serializeNoteBody(note.body) })),
      },
    });
    return;
  }
  const previous = localStorage.getItem(STORAGE_KEY);
  if (previous !== null) parseWorkspace(JSON.parse(previous));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
}

export type ImportedNote = { title: string; body: string };

// 桌面版用原生文件对话框选一个 Numi 兼容的 .txt；返回 null 表示用户取消。
export async function importNoteFile(): Promise<ImportedNote | null> {
  if (!isTauri()) throw new Error("请在桌面应用中使用导入功能。");
  const imported = await invoke<{ title: string; content: string } | null>("import_note");
  return imported === null
    ? null
    : { title: imported.title, body: parseNoteBody(imported.content) };
}

export async function guardNativeClose(
  flush: () => Promise<void>,
  failed: (message: string) => void,
) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  return window.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await flush();
      await window.destroy();
    } catch {
      failed("保存失败，窗口已保留。请重试保存或导出笔记后再关闭。");
    }
  });
}

// data-tauri-drag-region 只对标记元素本身生效；这里补上区域内子元素与空白处的拖拽。
export async function enableTitleDragRegions(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  const onMouseDown = (event: MouseEvent) => {
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element)) return;
    if (target.hasAttribute("data-tauri-drag-region")) return; // 由 Tauri 核心处理
    if (target.closest("button, input, textarea, select, a, label, [contenteditable]")) return;
    if (!target.closest("[data-tauri-drag-region]")) return;
    event.preventDefault();
    void window.startDragging();
  };
  document.addEventListener("mousedown", onMouseDown);
  return () => document.removeEventListener("mousedown", onMouseDown);
}

export async function downloadText(filename: string, content: string): Promise<boolean> {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "-");
  if (isTauri()) return invoke("export_note", { filename: safeName, content });
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
