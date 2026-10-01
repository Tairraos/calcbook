import { emit, listen } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  BookOpen,
  Calculator as CalculatorIcon,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import logoDark from "./assets/dark.png";
import logoLight from "./assets/light.png";
import { convertUnitQuantity, evaluateNotebook } from "./domain/calculation.ts";
import { parseNoteBody, serializeNoteBody } from "./domain/format.ts";
import type { FormatSettings } from "./domain/formatting.ts";
import { formatNoteBody } from "./domain/formatting.ts";
import {
  createNote,
  DEFAULT_HISTORY_LIMIT_KB,
  type HistoryEntry,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  type Note,
} from "./domain/notebook.ts";
import {
  buildMatcher,
  DEFAULT_SEARCH_OPTIONS,
  findMatches,
  type MatchRange,
  matchIndexAtOrAfter,
  replaceAllText,
  type SearchOptions,
  stepMatchIndex,
} from "./domain/search.ts";
import {
  CALCULATOR_INSERT_EVENT,
  CALCULATOR_READY_EVENT,
  CALCULATOR_THEME_EVENT,
  CALCULATOR_VISIBILITY_EVENT,
  calculatorStatus,
  createNoteFile,
  deleteHistoryFile,
  downloadText,
  enableTitleDragRegions,
  ensureNoteFile,
  hasNativeTitlebar,
  isDesktopApp,
  listHistory,
  localHourPrefix,
  localTimestamp,
  openProject,
  recordHistoryFile,
  revealNoteFile,
  saveWindowSize,
  toggleCalculator,
} from "./platform/storage.ts";
import { Dialog } from "./ui/Dialog.tsx";
import { Editor } from "./ui/Editor.tsx";
import { FindReplaceBar } from "./ui/FindReplaceBar.tsx";
import { HelpDialog } from "./ui/HelpDialog.tsx";
import { HistoryDialog, historyLabel } from "./ui/HistoryDialog.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import { SettingsDialog } from "./ui/SettingsDialog.tsx";
import { useWorkspace } from "./useWorkspace.ts";

const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));

// 等宽字体列宽估算：CJK/全角按 1em（14px），其余按 0.6em；水平滚动只需保证匹配可见，允许近似
const columnWidth = (text: string) => {
  let width = 0;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 14 : 8.4;
  return width;
};

// 滚动定位到匹配：垂直用镜像层高亮行的真实布局位置（getBoundingClientRect，不受 DOM 结构影响），
// 水平按列宽估算 textarea 的 scrollLeft；已在视口内则不滚动，避免跳动。
function scrollMatchIntoView(textarea: HTMLTextAreaElement, match: MatchRange) {
  const scroller = textarea.closest(".editor-scroll");
  const before = textarea.value.slice(0, match.start);
  const line = before.split("\n").length - 1;
  if (scroller instanceof HTMLElement) {
    const lineEl = scroller.querySelectorAll(".code-line")[line];
    if (lineEl) {
      const y =
        lineEl.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      if (y < scroller.scrollTop + 40 || y > scroller.scrollTop + scroller.clientHeight - 60) {
        scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 3);
      }
    }
  }
  const columnText = before.slice(before.lastIndexOf("\n") + 1);
  const x = columnWidth(columnText);
  if (x < textarea.scrollLeft + 20) textarea.scrollLeft = Math.max(0, x - 60);
  else if (x > textarea.scrollLeft + textarea.clientWidth - 60) {
    textarea.scrollLeft = x - textarea.clientWidth * 0.6;
  }
}

export default function App() {
  // 关闭前留档：闭包经 ref 传递，指向最新的记录函数（见 recordCurrentRef）。
  const recordCurrentRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const { workspace, update, status, error, load, flush, renameNote, storage, changeDirectory } =
    useWorkspace({ beforeClose: () => recordCurrentRef.current() });
  const [query, setQuery] = useState("");
  const [trashView, setTrashView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 计算器是独立子窗口：visible 由 Rust 事件推送，浏览器预览恒为关。
  const [calculatorVisible, setCalculatorVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeLineRef = useRef(0);
  // 查找替换浮动条：状态在 App 层，匹配引擎在 domain/search.ts
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findOptions, setFindOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplacement, setFindReplacement] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const findQueryRef = useRef<HTMLInputElement>(null);
  const findReplaceRef = useRef<HTMLInputElement>(null);

  const notes = workspace?.notes ?? [];
  const trashCount = notes.filter((note) => note.trashed).length;
  const visibleNotes = notes.filter(
    (note) =>
      note.trashed === trashView &&
      `${note.title}\n${note.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected =
    notes.find((note) => note.id === workspace?.activeId && note.trashed === trashView) ??
    notes.find((note) => note.trashed === trashView);
  // 结果区显示设置（千分位、数字与单位空格）改动立即生效：作为 evaluateNotebook 参数参与 memo 依赖
  const resultThousands = workspace?.format.resultThousands ?? true;
  const resultUnitSpacing = workspace?.format.unitSpace ?? false;
  const results = useMemo(
    () =>
      evaluateNotebook(selected?.body ?? "", { unitSpacing: resultUnitSpacing, resultThousands }),
    [selected?.body, resultThousands, resultUnitSpacing],
  );
  const resultCount = results.filter((line) => line.kind === "result").length;
  const errorCount = results.filter((line) => line.kind === "error").length;
  // 光标停在错误行时，状态栏在「n 处待检查」后展示它是第几处及出错原因
  const activeErrorOrdinal = results
    .slice(0, activeLine + 1)
    .filter((line) => line.kind === "error").length;
  const activeError = results[activeLine]?.kind === "error" ? results[activeLine] : null;

  // 查找替换：匹配结果随查询/开关/正文派生；ref 镜像供回调读取最新列表，避免闭包过期
  const findMatcher = useMemo(() => buildMatcher(findQuery, findOptions), [findQuery, findOptions]);
  const findMatchesList = useMemo<MatchRange[]>(
    () =>
      findOpen && findMatcher.pattern && selected
        ? findMatches(selected.body, findMatcher.pattern)
        : [],
    [findOpen, findMatcher, selected],
  );
  const findMatchesRef = useRef<MatchRange[]>([]);
  findMatchesRef.current = findMatchesList;

  // 跳到第 index 个匹配：不抢焦点（避免输入查找词时焦点在编辑器与查找框之间来回），
  // 只设选区并手动滚动定位；选区在 Esc 关闭浮动条、焦点回编辑器后立即可见。
  const gotoMatch = useCallback((index: number) => {
    const match = findMatchesRef.current[index];
    setActiveMatchIndex(match ? index : -1);
    const textarea = editorRef.current;
    if (!match || !textarea) return;
    textarea.setSelectionRange(match.start, match.end);
    scrollMatchIntoView(textarea, match);
  }, []);

  // 匹配列表变化后的序号校正：查询/开关变化（正文未动）时实时选中最近匹配；
  // 正文变化（手动编辑或替换）时只校正序号，不抢选区。
  const findBodyRef = useRef<string | null>(null);
  useEffect(() => {
    const body = selected?.body ?? null;
    const bodyUnchanged = findBodyRef.current !== null && findBodyRef.current === body;
    findBodyRef.current = body;
    if (!findOpen) return;
    if (findMatchesList.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    const caret = editorRef.current?.selectionStart ?? 0;
    const next = matchIndexAtOrAfter(findMatchesList, caret);
    if (bodyUnchanged) gotoMatch(next);
    else setActiveMatchIndex(next);
  }, [findMatchesList, findOpen, selected?.body, gotoMatch]);

  const openFind = useCallback(() => {
    if (!selected) return;
    const textarea = editorRef.current;
    if (textarea) {
      const selectedText = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      // 单行选区自动带入查找框；无选区保留上次查询（与 VS Code 一致）
      if (selectedText && !selectedText.includes("\n")) setFindQuery(selectedText);
    }
    setFindOpen(true);
    requestAnimationFrame(() => {
      findQueryRef.current?.focus();
      findQueryRef.current?.select();
    });
  }, [selected]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setActiveMatchIndex(-1);
    // 焦点还回编辑器，当前匹配的选区随之可见
    editorRef.current?.focus();
  }, []);

  // 编辑器内按 Esc 也关闭浮动条（查找/替换输入框的 Esc 由组件自行处理）
  useEffect(() => {
    if (!findOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.activeElement === editorRef.current) closeFind();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, closeFind]);

  function stepMatch(direction: 1 | -1) {
    gotoMatch(stepMatchIndex(activeMatchIndex, direction, findMatchesRef.current.length));
  }

  // 单个替换：选中匹配后 execCommand 插入，保留原生撤销栈（可逐步 Cmd+Z）；
  // 替换后正文变化触发上方 effect，序号自动落到下一处匹配（替换即前进）。
  function replaceCurrentMatch() {
    const textarea = editorRef.current;
    const match = findMatchesList[activeMatchIndex];
    if (!textarea || !selected || selected.trashed || !match) return;
    if (
      selected.body.length - (match.end - match.start) + findReplacement.length >
      MAX_NOTE_LENGTH
    ) {
      setNotice("替换后将超过笔记长度上限，未执行。");
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(match.start, match.end);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, findReplacement);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      // execCommand 不可用：回退 React 状态替换，用格式化同款应用内撤销兜底
      const nextBody =
        selected.body.slice(0, match.start) + findReplacement + selected.body.slice(match.end);
      formatUndoRef.current = { noteId: selected.id, previous: selected.body, formatted: nextBody };
      patchNote({ body: nextBody });
    }
    findReplaceRef.current?.focus();
  }

  // 全部替换：先留档（破坏性操作），再整篇 execCommand 替换——一次 Cmd+Z 整体还原；
  // 回退路径走 React 状态替换 + formatUndoRef 应用内撤销（与格式化同范式）。
  function replaceAllMatches() {
    const textarea = editorRef.current;
    if (!selected || selected.trashed || !findMatcher.pattern) return;
    const { text, count } = replaceAllText(
      selected.body,
      findMatcher.pattern,
      findReplacement,
      !findOptions.regex,
    );
    if (count === 0) return;
    if (text.length > MAX_NOTE_LENGTH) {
      setNotice("替换后将超过笔记长度上限，未执行。");
      return;
    }
    void recordNoteHistory(selected.id, selected.body);
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try {
        if (document.execCommand("insertText", false, text)) {
          // execCommand 成功：原生撤销栈已接管这条记录，应用内撤销必须让位——
          // 两套同时存在时，第一次 Cmd+Z 走状态恢复、第二次又回放原生条目，
          // 按旧坐标删插会把原文复制一份（实测 bug）。
          formatUndoRef.current = null;
          setNotice(`已替换 ${count} 处`);
          findReplaceRef.current?.focus();
          return;
        }
      } catch {
        // execCommand 不可用时走状态替换
      }
    }
    // 回退路径：React 状态替换无原生撤销条目，用 formatUndoRef 应用内撤销兜底
    formatUndoRef.current = { noteId: selected.id, previous: selected.body, formatted: text };
    patchNote({ body: text });
    setNotice(`已替换 ${count} 处`);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = workspace?.theme ?? "light";
    document.documentElement.classList.toggle("native-titlebar", hasNativeTitlebar);
    document.title = `${selected?.title || "calcbook"} · calcbook`;
  }, [workspace?.theme, selected?.title]);

  // 状态栏「n 处待检查」的循环序号：点击会让编辑器失焦，不能读当前光标位置推算下一个
  const errorNavRef = useRef(-1);
  // 活动行回到第一行：换笔记时重置 ref，避免失焦改写拿旧行号碰新笔记。
  const resetActiveLine = useCallback(() => {
    activeLineRef.current = 0;
    setActiveLine(0);
    formatUndoRef.current = null;
    errorNavRef.current = -1;
  }, []);

  // 把光标定位到指定行的行尾（焦点还回编辑器，滚动到可见）。
  // 状态栏「n 处待检查」与结果列「检查算式」共用。
  function jumpToLineEnd(lineIndex: number) {
    const textarea = editorRef.current;
    if (!textarea || !selected) return;
    const lines = selected.body.split("\n");
    let pos = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i += 1) pos += lines[i].length + 1;
    pos += lines[lineIndex]?.length ?? 0; // 行尾
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    handleActiveLine(Math.min(lineIndex, lines.length - 1));
    scrollMatchIntoView(textarea, { start: pos, end: pos });
  }

  // 点击把光标依次停在每个错误行的行尾（循环），焦点还回编辑器。
  function gotoNextError() {
    const errorLines = results
      .map((line, index) => (line.kind === "error" ? index : -1))
      .filter((index) => index >= 0);
    if (errorLines.length === 0) return;
    errorNavRef.current = (errorNavRef.current + 1) % errorLines.length;
    jumpToLineEnd(errorLines[errorNavRef.current]);
  }

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void enableTitleDragRegions().then((dispose) => {
      if (disposed) dispose();
      else cleanup = dispose;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const newNote = useCallback(
    async (title = "未命名笔记", body = ""): Promise<boolean> => {
      if ((workspace?.notes.length ?? 0) >= MAX_NOTES) {
        setNotice("目前最多保留 100 篇笔记（含废纸篓）。");
        return false;
      }
      if (isDesktopApp) {
        try {
          const created = await createNoteFile(title, body);
          update((before) => ({
            ...before,
            notes: [created, ...before.notes],
            activeId: created.id,
          }));
        } catch {
          setNotice("新建笔记失败，请重试。");
          return false;
        }
      } else {
        const note = createNote(crypto.randomUUID(), new Date().toISOString(), title, body);
        update((before) => ({ ...before, notes: [note, ...before.notes], activeId: note.id }));
      }
      setTrashView(false);
      setQuery("");
      resetActiveLine();
      requestAnimationFrame(() => editorRef.current?.focus());
      return true;
    },
    [workspace?.notes.length, resetActiveLine, update],
  );

  function patchNote(patch: Pick<Note, "body">) {
    if (!selected) return;
    // 用户手动编辑后，格式化的应用内撤销作废
    if (patch.body !== undefined && patch.body !== formatUndoRef.current?.formatted)
      formatUndoRef.current = null;
    update((before) => ({
      ...before,
      notes: before.notes.map((note) =>
        note.id === selected.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note,
      ),
    }));
  }

  // 标题即文件名（无扩展名）：输入只改草稿（按笔记 id 键控，换笔记自动失效），
  // 失焦或回车提交改名，Escape 放弃。ref 镜像保证 Escape 后同步失焦时
  // onBlur 读到的是已放弃的草稿，而不是重渲染前的旧闭包值。
  const [titleDraft, setTitleDraftState] = useState<{ id: string; value: string } | null>(null);
  const titleDraftRef = useRef(titleDraft);
  const setTitleDraft = useCallback((next: { id: string; value: string } | null) => {
    titleDraftRef.current = next;
    setTitleDraftState(next);
  }, []);
  const draft = titleDraft && selected && titleDraft.id === selected.id ? titleDraft.value : null;
  const commitTitle = useCallback(() => {
    const current = titleDraftRef.current;
    setTitleDraft(null);
    if (!current || !selected || selected.trashed) return;
    const name = current.value.trim();
    if (!name || name === selected.title) return;
    void renameNote(selected.id, name);
  }, [selected, renameNote, setTitleDraft]);

  function restoreNote() {
    if (!selected) return;
    update((before) => ({
      ...before,
      activeId: selected.id,
      notes: before.notes.map((note) =>
        note.id === selected.id ? { ...note, trashed: false } : note,
      ),
    }));
    setTrashView(false);
    resetActiveLine();
    setNotice("笔记已恢复");
  }

  // 编辑历史：文件名是秒级时间戳（`年-月-日-时-分-秒.txt`），同小时可有多份；
  // 记录时机四类——有实质编辑后每 10 分钟、切换笔记、关闭应用、破坏性操作前。
  // 「有效编辑」以最近一次留档内容为基线，内容未变不重复备份；超过一小时的部分
  // 由存储层按小时整理成一份整点快照，单篇总量 1 MB 上限。
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyBaseline = useRef(new Map<string, string>());
  const lastSelectedRef = useRef<{ id: string; body: string } | null>(null);
  const recordNoteHistory = useCallback(
    (noteId: string, body: string): Promise<void> => {
      const note = workspace?.notes.find((item) => item.id === noteId);
      if (!note || note.trashed) return Promise.resolve();
      // 仅空行与空格视为空文件，存历史也没有内容可回溯，不留档；有文字或数字都算实质内容
      if (!body.trim()) return Promise.resolve();
      if (historyBaseline.current.get(noteId) === body) return Promise.resolve();
      historyBaseline.current.set(noteId, body);
      return recordHistoryFile(
        noteId,
        serializeNoteBody(body),
        localTimestamp(),
        (workspace?.historyLimitKB ?? DEFAULT_HISTORY_LIMIT_KB) * 1024,
      ).catch(() => {
        setNotice("历史记录失败，请稍后重试。");
      });
    },
    [workspace],
  );
  // 切换笔记：先给旧笔记留档，再给新笔记建立基线（无基线时以加载内容为基线）。
  useEffect(() => {
    const current = selected ? { id: selected.id, body: selected.body } : null;
    const previous = lastSelectedRef.current;
    if (previous && current && previous.id !== current.id)
      void recordNoteHistory(previous.id, previous.body);
    if (current && !historyBaseline.current.has(current.id))
      historyBaseline.current.set(current.id, current.body);
    lastSelectedRef.current = current;
  }, [selected, recordNoteHistory]);
  // 有实质编辑后每 10 分钟更新一次历史（秒级文件名，同小时可有多份）；interval 用 ref 读最新记录函数。
  const recordRef = useRef(recordNoteHistory);
  recordRef.current = recordNoteHistory;
  recordCurrentRef.current = () => {
    const current = lastSelectedRef.current;
    return current ? recordRef.current(current.id, current.body) : Promise.resolve();
  };
  useEffect(() => {
    const timer = setInterval(() => {
      const current = lastSelectedRef.current;
      if (current) void recordRef.current(current.id, current.body);
    }, 600_000);
    return () => clearInterval(timer);
  }, []);
  // 恢复历史：当前内容先留档（未变则跳过，会得到独立的秒级快照），
  // 再把历史内容加载进编辑器，并刷新列表反映最新快照。
  // 恢复不算用户编辑，格式化的应用内撤销作废。
  const refreshHistory = useCallback(() => {
    if (!selected) return;
    void listHistory(selected.id, localHourPrefix())
      .then((list) => setHistoryEntries(list))
      .catch(() => setHistoryEntries([]));
  }, [selected]);
  const restoreHistory = useCallback(
    (entry: HistoryEntry) => {
      if (!selected) return;
      void recordNoteHistory(selected.id, selected.body);
      const body = parseNoteBody(entry.content);
      historyBaseline.current.set(selected.id, body);
      formatUndoRef.current = null;
      update((before) => ({
        ...before,
        notes: before.notes.map((note) =>
          note.id === selected.id ? { ...note, body, updatedAt: new Date().toISOString() } : note,
        ),
      }));
      refreshHistory();
      setNotice(`已恢复到 ${historyLabel(entry.name)}`);
    },
    [selected, recordNoteHistory, update, refreshHistory],
  );
  // 打开历史弹窗时加载当前笔记的历史列表（UI 组件不直接读存储层）。
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  const activeNoteId = selected?.id ?? null;
  useEffect(() => {
    if (!historyOpen || !activeNoteId) return;
    let disposed = false;
    setHistoryEntries(null);
    void listHistory(activeNoteId, localHourPrefix())
      .then((list) => {
        if (!disposed) setHistoryEntries(list);
      })
      .catch(() => {
        if (!disposed) setHistoryEntries([]);
      });
    return () => {
      disposed = true;
    };
  }, [historyOpen, activeNoteId]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("结果已复制");
    } catch {
      setNotice("复制失败，请选中结果后手动复制。");
    }
  }, []);

  function insertExpression(expression: string) {
    if (!selected || selected.trashed) {
      newNote("随手计算", expression.trim());
      return;
    }
    const textarea = editorRef.current;
    const position = textarea?.selectionEnd ?? selected.body.length;
    const nextNewline = selected.body.indexOf("\n", position);
    const insertionPoint = nextNewline === -1 ? selected.body.length : nextNewline;
    const before = selected.body.slice(0, insertionPoint);
    const insertion = `${before && !before.endsWith("\n") ? "\n" : ""}${expression.trim()}\n`;
    const body = before + insertion + selected.body.slice(insertionPoint).replace(/^\n/, "");
    if (body.length > MAX_NOTE_LENGTH) {
      setNotice("这篇笔记已达到长度上限，请新建一篇。");
      return;
    }
    patchNote({ body });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        insertionPoint + insertion.length,
        insertionPoint + insertion.length,
      );
    });
    setNotice("算式已写入笔记");
  }

  const handleActiveLine = useCallback((line: number) => {
    activeLineRef.current = line;
    setActiveLine(line);
  }, []);

  const formatUndoRef = useRef<{ noteId: string; previous: string; formatted: string } | null>(
    null,
  );
  const [noteMenu, setNoteMenu] = useState<{
    noteId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | { mode: "all"; count: number }
    | { mode: "one"; noteId: string; title: string }
    | { mode: "trash"; noteId: string; title: string }
    | null
  >(null);
  const changeFormat = useCallback(
    (format: FormatSettings) => update((before) => ({ ...before, format })),
    [update],
  );
  const changeHistoryLimit = useCallback(
    (historyLimitKB: number) => update((before) => ({ ...before, historyLimitKB })),
    [update],
  );
  // 格式化整篇：按当前格式设置重排所有行（含注释与空格规范）。
  // 编辑器可编辑时用 execCommand 整篇替换，保留原生撤销栈（一次 Cmd+Z 即可还原）。
  const applyFormatting = useCallback(() => {
    if (!selected || !workspace) return;
    const formatted = formatNoteBody(selected.body, workspace.format, convertUnitQuantity);
    if (formatted === selected.body) {
      setNotice("格式已是最新的。");
      return;
    }
    // 格式化是破坏性操作：整理前的内容先留档进历史
    void recordNoteHistory(selected.id, selected.body);
    const textarea = editorRef.current;
    if (textarea && formatted.length <= MAX_NOTE_LENGTH) {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try {
        if (document.execCommand("insertText", false, formatted)) {
          // execCommand 成功：原生撤销栈接管（一次 Cmd+Z 还原），
          // 不能再挂应用内撤销，否则连续 Cmd+Z 双轨回放会重复正文
          formatUndoRef.current = null;
          setNotice("已按格式设置整理本页算式");
          return;
        }
      } catch {
        // execCommand 不可用时走状态替换
      }
    }
    // 回退路径：React 状态替换，原生撤销栈没有这条记录，
    // 记住格式化前的正文，Cmd+Z 在无后续编辑时直接恢复。
    formatUndoRef.current = { noteId: selected.id, previous: selected.body, formatted };
    update((before) => ({
      ...before,
      notes: before.notes.map((note) =>
        note.id === selected.id
          ? { ...note, body: formatted, updatedAt: new Date().toISOString() }
          : note,
      ),
    }));
    setNotice("已按格式设置整理本页算式");
  }, [selected, workspace, update, recordNoteHistory]);

  // 右键菜单：定位（Finder）/导出/删除到废纸篓
  const closeNoteMenu = useCallback(() => setNoteMenu(null), []);
  const revealNote = useCallback(async (noteId: string) => {
    try {
      await revealNoteFile(noteId);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);
  const exportNoteById = useCallback(
    async (noteId: string, title: string) => {
      const note = workspace?.notes.find((item) => item.id === noteId);
      if (!note) return;
      try {
        if (await downloadText(`${title || "未命名笔记"}.txt`, serializeNoteBody(note.body)))
          setNotice("已导出文本笔记（含结果）");
      } catch {
        setNotice("导出失败，请重试。");
      }
    },
    [workspace],
  );
  const trashNote = useCallback(
    (noteId: string) => {
      update((before) => ({
        ...before,
        notes: before.notes.map((note) =>
          note.id === noteId
            ? { ...note, trashed: true, updatedAt: new Date().toISOString() }
            : note,
        ),
        activeId: before.activeId === noteId ? null : before.activeId,
      }));
      setNotice("已移到废纸篓");
    },
    [update],
  );
  // 永久删除：从工作区移除；Rust 保存时按新旧元数据差异物理删除对应 .txt 文件。
  const permanentDelete = useCallback(
    (noteIds: string[]) => {
      const idSet = new Set(noteIds);
      update((before) => ({
        ...before,
        notes: before.notes.filter((note) => !idSet.has(note.id)),
        activeId: before.activeId && idSet.has(before.activeId) ? null : before.activeId,
      }));
      setNotice(noteIds.length === 1 ? "笔记已永久删除" : `已永久删除 ${noteIds.length} 篇笔记`);
    },
    [update],
  );

  // 计算器子窗口状态：初始查询一次，之后由 Rust 在显示/隐藏时推送。
  // 桌面版主题存在文件系统而非 localStorage，子窗打开时需立即同步当前配色。
  // 记忆窗口尺寸：结束缩放 600ms 后保存，恢复时在 Rust 侧读取（默认最小 800×640）。
  useEffect(() => {
    if (!isDesktopApp) return;
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void saveWindowSize(window.innerWidth, window.innerHeight).catch(() => {}),
        600,
      );
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, []);

  const themeRef = useRef(workspace?.theme ?? "light");
  themeRef.current = workspace?.theme ?? "light";
  useEffect(() => {
    if (!isDesktopApp) return;
    void calculatorStatus()
      .then((status) => setCalculatorVisible(status.visible))
      .catch(() => {});
    const pushTheme = () => {
      void emit(CALCULATOR_THEME_EVENT, themeRef.current).catch(() => {});
    };
    const unlisten = listen<boolean>(CALCULATOR_VISIBILITY_EVENT, (event) => {
      setCalculatorVisible(event.payload === true);
      if (event.payload === true) pushTheme();
    });
    // 子窗挂载完成时立即补一次主题，避免创建早期的推送丢失（竞态）。
    const unlistenReady = listen(CALCULATOR_READY_EVENT, pushTheme);
    return () => {
      void unlisten.then((dispose) => dispose());
      void unlistenReady.then((dispose) => dispose());
    };
  }, []);

  // 切换主题时同步给计算器子窗口。
  useEffect(() => {
    if (!isDesktopApp) return;
    void emit(CALCULATOR_THEME_EVENT, workspace?.theme ?? "light").catch(() => {});
  }, [workspace?.theme]);

  // 计算器「写入当前笔记」：经事件送达主窗，插入当前行之后。
  const insertRef = useRef(insertExpression);
  insertRef.current = insertExpression;
  useEffect(() => {
    if (!isDesktopApp) return;
    const unlisten = listen<string>(CALCULATOR_INSERT_EVENT, (event) => {
      insertRef.current(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      // 格式化的应用内撤销：仅当笔记仍是格式化后的内容（用户未再编辑）
      const formatUndo = formatUndoRef.current;
      if (
        !event.shiftKey &&
        event.key.toLowerCase() === "z" &&
        formatUndo &&
        formatUndo.noteId === selected?.id &&
        selected.body === formatUndo.formatted
      ) {
        event.preventDefault();
        formatUndoRef.current = null;
        update((before) => ({
          ...before,
          notes: before.notes.map((note) =>
            note.id === formatUndo.noteId
              ? { ...note, body: formatUndo.previous, updatedAt: new Date().toISOString() }
              : note,
          ),
        }));
        setNotice("已撤销格式化");
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        setHelpOpen(false);
        setSettingsOpen(true);
        return;
      }
      if (helpOpen || settingsOpen) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newNote();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush().catch(() => {});
      }
      if (event.shiftKey && event.key.toLowerCase() === "c" && results[activeLine]?.raw) {
        event.preventDefault();
        void copy(results[activeLine].raw ?? "");
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [
    newNote,
    flush,
    results,
    activeLine,
    copy,
    helpOpen,
    settingsOpen,
    update,
    selected?.body,
    selected?.id,
    openFind,
  ]);

  if (!workspace)
    return (
      <main className="startup-screen">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>calcbook</h1>
        <p role="status">{error || "正在打开你的笔记…"}</p>
        {error && (
          <button className="primary-button" type="button" onClick={() => void load()}>
            重试读取
          </button>
        )}
      </main>
    );

  return (
    <div className={`app-shell ${sidebarOpen ? "has-sidebar" : ""}`}>
      <aside className="sidebar" aria-label="笔记导航">
        <div className="sidebar-inner">
          <div className="brand" data-tauri-drag-region>
            <span className="brand-logo-wrap">
              <img
                src={logoLight}
                className="brand-logo brand-light"
                alt="calcbook"
                draggable={false}
              />
              <img
                src={logoDark}
                className="brand-logo brand-dark"
                alt="calcbook"
                draggable={false}
              />
              <span className="brand-version">v{__APP_VERSION__}</span>
            </span>
          </div>
          <div className="search-field">
            <Search size={15} />
            <input
              ref={searchRef}
              aria-label="搜索笔记"
              placeholder="搜索笔记…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="notebook-list-heading">
            <div className="notebook-tabs">
              <button
                type="button"
                className={trashView ? "" : "is-active"}
                aria-pressed={!trashView}
                onClick={() => {
                  if (trashView) {
                    setTrashView(false);
                    setQuery("");
                    resetActiveLine();
                  }
                }}
              >
                我的笔记
              </button>
              <button
                type="button"
                className={trashView ? "is-active" : ""}
                aria-pressed={trashView}
                onClick={() => {
                  if (!trashView) {
                    setTrashView(true);
                    setQuery("");
                    resetActiveLine();
                  }
                }}
              >
                废纸篓
              </button>
            </div>
            {trashView ? (
              <div className="heading-actions">
                <span className="trash-count" title="废纸篓中的笔记数">
                  {trashCount}
                </span>
                <IconButton
                  title="永久删除废纸篓里的全部笔记"
                  onClick={() => setConfirmDelete({ mode: "all", count: trashCount })}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            ) : (
              <IconButton title="新建笔记" onClick={() => void newNote()}>
                <Plus size={17} />
              </IconButton>
            )}
          </div>
          <div className="note-list">
            {visibleNotes.map((note) => (
              <button
                type="button"
                key={note.id}
                className={`note-card ${selected?.id === note.id ? "is-selected" : ""}`}
                aria-current={selected?.id === note.id ? "page" : undefined}
                aria-haspopup="menu"
                onClick={() => {
                  update((before) => ({ ...before, activeId: note.id }));
                  resetActiveLine();
                  if (isDesktopApp) void ensureNoteFile(note.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setNoteMenu({
                    noteId: note.id,
                    title: note.title,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <span className="note-card-top">
                  <FileText size={15} />
                  <strong>{note.title || "未命名笔记"}</strong>
                </span>
                <span className="note-preview">
                  {note.body
                    .split("\n")
                    .find((line) => line.trim())
                    ?.replace(/^#+\s*/, "") || "一张白纸，等一个想法"}
                </span>
                <span className="note-date">{date(note.updatedAt)}</span>
              </button>
            ))}
            {visibleNotes.length === 0 && (
              <p className="no-notes">
                {query ? "没有找到这篇笔记" : trashView ? "废纸篓是空的" : "从一张白纸开始吧"}
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="settings-entry">
              <button
                type="button"
                title="设置（⌘ / Ctrl ,）"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} />
                <span>设置</span>
              </button>
              <IconButton
                className="theme-toggle"
                title={workspace.theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
                onClick={() =>
                  update((before) => ({
                    ...before,
                    theme: before.theme === "dark" ? "light" : "dark",
                  }))
                }
              >
                {workspace.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
            </div>
          </div>
        </div>
      </aside>
      <main className="notebook-main">
        <header className="topbar" data-tauri-drag-region>
          <div className="breadcrumb">
            <IconButton
              title={sidebarOpen ? "收起笔记列表" : "展开笔记列表"}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </IconButton>
            <BookOpen size={15} />
            <span>{trashView ? "废纸篓" : "我的笔记"}</span>
            <ChevronRight size={13} />
            <strong>{selected?.title || "新的一页"}</strong>
          </div>
          <div className="topbar-actions">
            {status === "error" ? (
              <span className="save-status save-error" role="alert">
                尚未保存
              </span>
            ) : (
              <button
                type="button"
                className="topbar-tool"
                title="按格式设置整理当前笔记的全部算式"
                onClick={applyFormatting}
              >
                <Sparkles size={16} />
                <span>格式化</span>
              </button>
            )}
            <button
              type="button"
              className={`calculator-toggle ${calculatorVisible ? "is-open" : ""}`}
              aria-pressed={calculatorVisible}
              title={calculatorVisible ? "计算器窗口已打开" : "打开计算器窗口"}
              onClick={() => {
                if (!isDesktopApp) {
                  setNotice("计算器窗口仅在桌面版可用。");
                  return;
                }
                void toggleCalculator()
                  .then((status) => setCalculatorVisible(status.visible))
                  .catch(() => setNotice("无法打开计算器窗口，请重试。"));
              }}
            >
              <CalculatorIcon size={16} />
              <span>计算器</span>
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void flush().catch(() => {})}>
              重试保存
            </button>
          </div>
        )}
        {selected ? (
          <>
            <div className="note-heading">
              <div className="note-kicker">
                <div className="note-meta">
                  <span className="note-type">
                    <FileText size={12} />
                    {date(selected.updatedAt)}更新
                  </span>
                  <span className="note-saved-dot" />
                  <span>边想，边记，边算</span>
                </div>
                <div className="note-tools">
                  <IconButton title="语法速查" onClick={() => setHelpOpen(true)}>
                    <CircleHelp size={16} />
                  </IconButton>
                  <IconButton title="查找替换（Cmd+F）" onClick={openFind}>
                    <Search size={16} />
                  </IconButton>
                  <IconButton title="历史记录" onClick={() => setHistoryOpen(true)}>
                    <CalendarClock size={16} />
                  </IconButton>
                  {selected.trashed ? (
                    <>
                      <IconButton title="恢复笔记" onClick={restoreNote}>
                        <Undo2 size={16} />
                      </IconButton>
                      <IconButton
                        title="永久删除这篇笔记"
                        onClick={() =>
                          setConfirmDelete({
                            mode: "one",
                            noteId: selected.id,
                            title: selected.title,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </>
                  ) : (
                    <IconButton
                      title="移到废纸篓"
                      onClick={() =>
                        setConfirmDelete({
                          mode: "trash",
                          noteId: selected.id,
                          title: selected.title,
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  )}
                </div>
              </div>
              <input
                className="note-title"
                aria-label="笔记标题"
                title="标题即文件名；回车或移开焦点后生效"
                value={draft ?? selected.title}
                placeholder="未命名笔记"
                maxLength={MAX_TITLE_LENGTH}
                readOnly={selected.trashed}
                onChange={(event) => setTitleDraft({ id: selected.id, value: event.target.value })}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    // 放弃草稿：回落到当前标题，失焦后不会提交
                    setTitleDraft(null);
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            {selected.trashed && (
              <div className="trash-banner">
                <span>这篇笔记在废纸篓中，内容已保留。</span>
                <button type="button" onClick={restoreNote}>
                  恢复笔记
                </button>
              </div>
            )}
            <div className="find-host">
              {findOpen && (
                <FindReplaceBar
                  query={findQuery}
                  onQuery={setFindQuery}
                  options={findOptions}
                  onToggleOption={(key) =>
                    setFindOptions((before) => ({ ...before, [key]: !before[key] }))
                  }
                  error={findMatcher.error}
                  matchCount={findMatchesList.length}
                  activeIndex={activeMatchIndex}
                  replaceOpen={findReplaceOpen}
                  onToggleReplace={() => setFindReplaceOpen(!findReplaceOpen)}
                  canReplace={!selected.trashed}
                  replacement={findReplacement}
                  onReplacement={setFindReplacement}
                  onNext={() => stepMatch(1)}
                  onPrevious={() => stepMatch(-1)}
                  onReplace={replaceCurrentMatch}
                  onReplaceAll={replaceAllMatches}
                  onClose={closeFind}
                  queryRef={findQueryRef}
                  replaceRef={findReplaceRef}
                />
              )}
              <Editor
                key={selected.id}
                body={selected.body}
                results={results}
                onChange={(body) => patchNote({ body })}
                onCopy={(text) => void copy(text)}
                onDestructiveChange={() => {
                  if (selected) void recordNoteHistory(selected.id, selected.body);
                }}
                activeLine={activeLine}
                onActiveLine={handleActiveLine}
                editorRef={editorRef}
                readOnly={selected.trashed}
                findMatches={findMatchesList}
                activeMatchIndex={activeMatchIndex}
                onGotoLineEnd={jumpToLineEnd}
              />
            </div>
            <footer className="statusbar">
              <span>
                <span className="status-dot" />
                {resultCount} 条计算
                {errorCount > 0 && (
                  <button
                    type="button"
                    className="error-count"
                    title="点击依次定位到每个错误行（光标停行尾，循环）"
                    onClick={gotoNextError}
                  >
                    · {errorCount} 处待检查
                  </button>
                )}
                {activeError && (
                  <span className="error-detail">
                    第 {activeErrorOrdinal} 处：{activeError.error}
                  </span>
                )}
              </span>
              <span>
                第 {Math.min(activeLine + 1, results.length)} 行
                <span className="statusbar-divider" />
                点击右侧结果即可复制
              </span>
            </footer>
          </>
        ) : (
          <div className="empty-page">
            <BookOpen size={38} strokeWidth={1.2} />
            <h1>{trashView ? "没有被丢下的想法" : "给思路一张白纸。"}</h1>
            <p>{trashView ? "移入废纸篓的笔记会保留在这里。" : "从一个数字，或一个想法开始。"}</p>
            <button type="button" className="primary-button" onClick={() => void newNote()}>
              <Plus size={16} />
              新建笔记
            </button>
          </div>
        )}
      </main>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onInsert={insertExpression} />}
      {noteMenu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="笔记操作"
          style={{
            // 靠近视口右/下边缘时向内收，避免菜单溢出屏幕
            left: Math.min(noteMenu.x, window.innerWidth - 168),
            top: Math.min(noteMenu.y, window.innerHeight - 132),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void revealNote(noteMenu.noteId);
              closeNoteMenu();
            }}
          >
            <FolderOpen size={14} />
            定位
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void exportNoteById(noteMenu.noteId, noteMenu.title);
              closeNoteMenu();
            }}
          >
            <ArrowDownToLine size={14} />
            导出
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-danger"
            onClick={() => {
              trashNote(noteMenu.noteId);
              closeNoteMenu();
            }}
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
      {confirmDelete && (
        <Dialog
          className="confirm-dialog"
          label={confirmDelete.mode === "trash" ? "移到废纸篓确认" : "永久删除确认"}
          onClose={() => setConfirmDelete(null)}
        >
          <div className="settings-heading">
            <div>
              <h2>{confirmDelete.mode === "trash" ? "移到废纸篓" : "永久删除"}</h2>
              <p>
                {confirmDelete.mode === "all"
                  ? `将永久删除废纸篓里的 ${confirmDelete.count} 篇笔记及其文件，无法恢复。`
                  : confirmDelete.mode === "trash"
                    ? `将把「${confirmDelete.title || "未命名笔记"}」移到废纸篓，可随时恢复。`
                    : `将永久删除「${confirmDelete.title || "未命名笔记"}」及其文件，无法恢复。`}
              </p>
            </div>
          </div>
          <div className="settings-footer">
            <span role="note">
              {confirmDelete.mode === "trash"
                ? "废纸篓里的笔记不会参与计算，也不会自动留历史。"
                : "对应的 .txt 文件也会一并删除。"}
            </span>
            <button
              type="button"
              className="primary-button danger-button"
              onClick={() => {
                if (confirmDelete.mode === "trash") {
                  const id = confirmDelete.noteId;
                  update((before) => ({
                    ...before,
                    notes: before.notes.map((note) =>
                      note.id === id ? { ...note, trashed: true } : note,
                    ),
                    activeId:
                      before.notes.find((note) => !note.trashed && note.id !== id)?.id ?? null,
                  }));
                  setNotice("已移到废纸篓，可随时恢复");
                } else {
                  permanentDelete(
                    confirmDelete.mode === "all"
                      ? notes.filter((note) => note.trashed).map((note) => note.id)
                      : [confirmDelete.noteId],
                  );
                }
                setConfirmDelete(null);
              }}
            >
              {confirmDelete.mode === "trash" ? "移到废纸篓" : "永久删除"}
            </button>
          </div>
        </Dialog>
      )}
      {settingsOpen && workspace && storage && (
        <SettingsDialog
          directory={storage.directory}
          defaultDirectory={storage.defaultDirectory}
          canChooseDirectory={storage.canChoose}
          format={workspace.format}
          onChangeFormat={changeFormat}
          historyLimitKB={workspace.historyLimitKB}
          onChangeHistoryLimit={changeHistoryLimit}
          version={__APP_VERSION__}
          buildTime={__BUILD_TIME__}
          githubUrl={__GITHUB_URL__}
          saveStatus={status}
          saveError={error}
          onChangeDirectory={changeDirectory}
          onOpenProject={() => openProject(__GITHUB_URL__)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {historyOpen && selected && (
        <HistoryDialog
          entries={historyEntries}
          onClose={() => setHistoryOpen(false)}
          onRestore={restoreHistory}
          onDelete={(entry) =>
            deleteHistoryFile(selected.id, entry.name)
              .then(() => {
                setNotice(`已删除 ${historyLabel(entry.name)} 的历史`);
                void listHistory(selected.id, localHourPrefix())
                  .then((list) => setHistoryEntries(list))
                  .catch(() => setHistoryEntries([]));
              })
              .catch(() => setNotice("删除历史失败，请稍后重试。"))
          }
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <IconButton title="关闭提示" onClick={() => setNotice("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
