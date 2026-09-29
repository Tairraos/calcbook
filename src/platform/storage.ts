import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseNoteBody, serializeNoteBody } from "../domain/format.ts";
import { DEFAULT_FORMAT_SETTINGS } from "../domain/formatting.ts";
import { EXAMPLES, type Note, parseWorkspace, type Workspace } from "../domain/notebook.ts";

export const STORAGE_KEY = "calcbook.workspace.v1";
export type StorageInfo = { directory: string; defaultDirectory: string; canChoose: boolean };
export const isDesktopApp = isTauri();
// Overlay 标题栏（隐藏原生标题、内容延伸到标题栏下、为红绿灯留白）只在 macOS 成立：
// Windows/Linux 用系统默认标题栏，界面不能预留红绿灯位置，也不能加 titlebar 内边距。
export const hasNativeTitlebar = isDesktopApp && /Macintosh|Mac OS X/.test(navigator.userAgent);

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

// 在系统文件管理器里显示笔记所在文件（桌面版）。
export async function revealNoteFile(noteId: string): Promise<void> {
  if (!isTauri()) throw new Error("定位文件仅在桌面版可用。");
  await invoke("reveal_note", { noteId });
}

// 记住主窗尺寸：桌面版存默认数据目录 ~/.calcbook/window.json（逻辑单位）。
export async function saveWindowSize(width: number, height: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_window_size", { width, height });
}

export async function hideCalculatorWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_calculator");
}

// 计算器子窗口启动时读取工作区配色；主题变化经 CALCULATOR_THEME_EVENT 增量同步。
// 0.6.10 及以前存的是 paper/midnight，一并识别。
export function readStoredTheme(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const theme = raw ? (JSON.parse(raw)?.theme ?? "light") : "light";
    return theme === "dark" || theme === "midnight" ? "dark" : "light";
  } catch {
    return "light";
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

// 桌面版：文件系统是事实来源。快照用于把 React 状态的变更翻译成
// 写文件 / 进出废纸篓 / 物理删除三类文件操作。
let noteSnapshot: Map<string, { body: string; trashed: boolean }> = new Map();

export async function loadWorkspace(): Promise<Workspace | null> {
  if (isTauri()) {
    const payload: unknown = await invoke("scan_workspace");
    if (payload === null) {
      // 首次启动：生成示例笔记（文件名由 Rust 唯一化落盘）
      const notes: unknown[] = [];
      for (const example of EXAMPLES) {
        notes.push(await invoke("create_note", { title: example.title, body: example.body }));
      }
      const created = parseWorkspace({
        version: 1,
        theme: "light",
        activeId: null,
        format: DEFAULT_FORMAT_SETTINGS,
        notes,
      });
      noteSnapshot = new Map(
        created.notes.map((note) => [note.id, { body: note.body, trashed: note.trashed }]),
      );
      return {
        ...created,
        notes: created.notes.map((note) => ({ ...note, body: parseNoteBody(note.body) })),
      };
    }
    const workspace = parseWorkspace(payload);
    noteSnapshot = new Map(
      workspace.notes.map((note) => [note.id, { body: note.body, trashed: note.trashed }]),
    );
    // 正文来自 Numi 兼容的 .txt：导入时剥掉保存时自动追加的 "= 结果"，内存里只留源表达式。
    return {
      ...workspace,
      notes: workspace.notes.map((note) => ({ ...note, body: parseNoteBody(note.body) })),
    };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : parseWorkspace(JSON.parse(raw));
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const validated = parseWorkspace(workspace);
  if (isTauri()) {
    // 设置（主题/当前笔记/格式）每次保存；笔记按快照差异落盘
    await invoke("save_workspace_settings", {
      theme: validated.theme,
      activeId: validated.activeId,
      format: validated.format,
    });
    for (const note of validated.notes) {
      const previous = noteSnapshot.get(note.id);
      const serialized = serializeNoteBody(note.body);
      if (!previous) {
        await invoke("write_note", { noteId: note.id, body: serialized });
      } else {
        if (previous.body !== note.body)
          await invoke("write_note", { noteId: note.id, body: serialized });
        if (previous.trashed !== note.trashed)
          await invoke("move_note", { noteId: note.id, toRecycled: note.trashed });
      }
    }
    // 从状态里消失的笔记 = 永久删除，物理删除对应文件
    for (const id of noteSnapshot.keys()) {
      if (!validated.notes.some((note) => note.id === id))
        await invoke("delete_note", { noteId: id });
    }
    noteSnapshot = new Map(
      validated.notes.map((note) => [note.id, { body: note.body, trashed: note.trashed }]),
    );
    return;
  }
  const previous = localStorage.getItem(STORAGE_KEY);
  if (previous !== null) parseWorkspace(JSON.parse(previous));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
}

// 新建笔记：桌面版由 Rust 生成唯一文件名并落盘。
export async function createNoteFile(title: string, body: string): Promise<Note> {
  const payload = await invoke<{
    id: string;
    title: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  }>("create_note", { title, body });
  const note: Note = {
    id: payload.id,
    filename: "",
    title: payload.title,
    body: parseNoteBody(payload.body),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    trashed: false,
  };
  noteSnapshot.set(note.id, { body: note.body, trashed: false });
  return note;
}

// 运行期间文件被外部删除时：点击笔记按已知信息（文件名与首行标题）重建。
export async function ensureNoteFile(noteId: string, title: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ensure_note", { noteId, title });
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
