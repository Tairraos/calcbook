import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseNoteBody, serializeNoteBody } from "../domain/format.ts";
import { DEFAULT_FORMAT_SETTINGS } from "../domain/formatting.ts";
import {
  EXAMPLES,
  type HistoryEntry,
  type Note,
  parseWorkspace,
  redirectRenamedId,
  resolveRenamedId,
  type Workspace,
} from "../domain/notebook.ts";

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
  await invoke("reveal_note", { noteId: resolveNoteId(noteId) });
}

// 记住主窗尺寸：桌面版存配置目录 settings.json 的 window 字段（逻辑单位）。
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
// 写文件 / 改名 / 进出废纸篓 / 物理删除四类文件操作。
let noteSnapshot: Map<string, { body: string; trashed: boolean }> = new Map();

// 改名会把笔记 id（文件相对路径）换掉；排队中的旧 id 操作经此映射落到改名后的文件。
const renamedIds = new Map<string, string>();

function resolveNoteId(noteId: string): string {
  return resolveRenamedId(renamedIds, noteId);
}

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
    // 设置（主题/当前笔记/格式/历史空间）每次保存；笔记按快照差异落盘
    // 注意键名是 historyLimitKb：Tauri 把命令参数名规范化为 camelCase，结尾缩写 KB 会降为 Kb
    await invoke("save_workspace_settings", {
      theme: validated.theme,
      activeId: validated.activeId,
      format: validated.format,
      historyLimitKb: validated.historyLimitKB,
    });
    for (const note of validated.notes) {
      const previous = noteSnapshot.get(note.id);
      const serialized = serializeNoteBody(note.body);
      const noteId = resolveNoteId(note.id);
      if (!previous) {
        await invoke("write_note", { noteId, body: serialized });
      } else {
        if (previous.body !== note.body) await invoke("write_note", { noteId, body: serialized });
        if (previous.trashed !== note.trashed)
          await invoke("move_note", { noteId, toRecycled: note.trashed });
      }
    }
    // 从状态里消失的笔记 = 永久删除，物理删除对应文件
    // （改名后排队中的旧 id 状态经重定向比对，避免把改名后的文件误判成已删除）
    for (const id of noteSnapshot.keys()) {
      if (!validated.notes.some((note) => resolveNoteId(note.id) === id))
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

// 运行期间文件被外部删除时：点击笔记按已知信息重建。
export async function ensureNoteFile(noteId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ensure_note", { noteId: resolveNoteId(noteId) });
}

// 改名：标题即文件名主干。Rust 侧负责清洗与撞名加序号，返回新 id 与最终标题；
// 旧 id 的排队操作经 renamedIds 重定向，快照随改名移动。浏览器预览无文件，标题原样返回。
export async function renameNoteFile(
  noteId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  if (!isTauri()) return { id: noteId, title };
  const from = resolveNoteId(noteId);
  const result = await invoke<{ id: string; title: string }>("rename_note", {
    noteId: from,
    title,
  });
  if (result.id !== from) redirectRenamedId(renamedIds, from, result.id);
  const entry = noteSnapshot.get(from);
  if (entry) {
    noteSnapshot.delete(from);
    noteSnapshot.set(result.id, entry);
  }
  return result;
}

// 浏览器预览的历史走 localStorage（桌面版走数据目录 history/ 下按笔记名分目录），
// 让历史功能在预览态也能验收。桌面版的每小时整点归档与单篇 KB 上限（设置里可配，
// 默认 128）由 Rust 保证。
const PREVIEW_HISTORY_KEY = "calcbook.history.v1";

function readPreviewHistory(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_HISTORY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

// 记录一份历史：bucket 是本地时间的秒级时间戳（`年-月-日-时-分-秒`），当前小时可有多份；
// limitBytes 是每篇笔记的历史空间上限（字节），0 = 已关闭：清空该笔记的既有历史，不写入。
export async function recordHistoryFile(
  noteId: string,
  content: string,
  bucket: string,
  limitBytes: number,
): Promise<void> {
  if (!isTauri()) {
    const history = readPreviewHistory();
    if (limitBytes === 0) {
      delete history[noteId];
    } else {
      const entries = history[noteId] ?? {};
      entries[bucket] = content;
      history[noteId] = entries;
    }
    localStorage.setItem(PREVIEW_HISTORY_KEY, JSON.stringify(history));
    return;
  }
  await invoke("record_history", {
    noteId: resolveNoteId(noteId),
    content,
    bucket,
    limitBytes,
  });
}

// 列出单篇笔记的全部历史，最新在前；currentHour 供桌面版整理旧小时（每小时归档为一份整点）。
export async function listHistory(noteId: string, currentHour: string): Promise<HistoryEntry[]> {
  if (!isTauri()) {
    const entries = readPreviewHistory()[noteId] ?? {};
    return Object.entries(entries)
      .map(([name, content]) => ({ name, content }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  return invoke("list_history", { noteId: resolveNoteId(noteId), currentHour });
}

// 删除单条历史（bucket 为秒级时间戳或旧版整点名）；不存在时视为成功。
export async function deleteHistoryFile(noteId: string, bucket: string): Promise<void> {
  if (!isTauri()) {
    const history = readPreviewHistory();
    if (history[noteId]) {
      delete history[noteId][bucket];
      if (Object.keys(history[noteId]).length === 0) delete history[noteId];
      localStorage.setItem(PREVIEW_HISTORY_KEY, JSON.stringify(history));
    }
    return;
  }
  await invoke("delete_history", { noteId: resolveNoteId(noteId), bucket });
}

// 本地时间的秒级时间戳（历史文件名 `年-月-日-时-分-秒`）与小时前缀（整理归档用）。
// 由前端生成，避免 Rust 为此引入日期库。
export function localTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function localHourPrefix(): string {
  return localTimestamp().slice(0, 13);
}

export async function guardNativeClose(
  flush: () => Promise<void>,
  failed: (message: string) => void,
  beforeClose?: () => Promise<void>,
) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  return window.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await flush();
      if (beforeClose) await beforeClose();
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
