import { emit, listen } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  BookOpen,
  Calculator as CalculatorIcon,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
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
  SquarePen,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import logoDark from "./assets/dark.png";
import logoLight from "./assets/light.png";
import { convertUnitQuantity, evaluateNotebook } from "./domain/calculation.ts";
import { parseNoteBody, serializeNoteBody } from "./domain/format.ts";
import type { FormatSettings } from "./domain/formatting.ts";
import { formatLine, formatNoteBody } from "./domain/formatting.ts";
import {
  createNote,
  createScratchNote,
  DEFAULT_HISTORY_LIMIT_KB,
  type HistoryEntry,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  type Note,
  SCRATCH_NOTE_ID,
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
  CALCULATOR_LANG_EVENT,
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
import { formatDate, makeT } from "./ui/i18n.ts";
import { LanguageGlyph } from "./ui/LanguageGlyph.tsx";
import { SettingsDialog } from "./ui/SettingsDialog.tsx";
import { useWorkspace } from "./useWorkspace.ts";

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
  // 随手算：内存里的临时算稿。scratchNote 持有内容（App 运行期间一直在，切走再点按钮即恢复），
  // scratchOpen 决定主区是否显示它；两者都不进工作区，因此不会被持久化。
  const [scratchOpen, setScratchOpen] = useState(false);
  const [scratchNote, setScratchNote] = useState<Note | null>(null);
  // 计算器是独立子窗口：visible 由 Rust 事件推送，浏览器预览恒为关。
  const [calculatorVisible, setCalculatorVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [notice, setNoticeState] = useState("");
  // 失败/超限类提示用警示图标渲染，不与成功提示共用 ✓ 样式（出错不能被成功样式掩盖）。
  // 所有提示统一走 notify：每次设置都重置警示位，上一次的警示样式不污染下一次成功提示。
  const [noticeAlert, setNoticeAlert] = useState(false);
  const notify = useCallback((text: string, alert = false) => {
    setNoticeAlert(alert);
    setNoticeState(text);
  }, []);
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
  // 界面语言：英文为出厂默认；语言按钮切换并持久化。错误消息与结果单位语言一并跟随。
  const lang = workspace?.uiLanguage ?? "en";
  const t = useMemo(() => makeT(lang), [lang]);
  const trashCount = notes.filter((note) => note.trashed).length;
  const visibleNotes = notes.filter(
    (note) =>
      note.trashed === trashView &&
      `${note.title}\n${note.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  // 随手算打开时主区只显示它：侧栏里没有任何笔记处于选中态，面包屑显示「随手算」。
  const scratch = scratchOpen && scratchNote ? scratchNote : null;
  const selected =
    scratch ??
    notes.find((note) => note.id === workspace?.activeId && note.trashed === trashView) ??
    notes.find((note) => note.trashed === trashView);
  // 结果区显示设置（千分位、数字与单位空格、单位写法）改动立即生效：作为 evaluateNotebook 参数参与 memo 依赖
  const resultThousands = workspace?.format.resultThousands ?? true;
  const resultUnitSpacing = workspace?.format.unitSpace ?? false;
  const resultUnitStyle = workspace?.format.unitStyle ?? "free";
  const results = useMemo(
    () =>
      evaluateNotebook(selected?.body ?? "", {
        unitSpacing: resultUnitSpacing,
        resultThousands,
        unitStyle: resultUnitStyle,
        lang,
      }),
    [selected?.body, resultThousands, resultUnitSpacing, resultUnitStyle, lang],
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

  // 笔记工具行的查找图标是开关：浮动条开着时再点即关闭
  const toggleFind = useCallback(() => {
    if (findOpen) closeFind();
    else openFind();
  }, [findOpen, closeFind, openFind]);

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
      notify(t("replaceOverLimit"), true);
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
      notify(t("replaceOverLimit"), true);
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
          notify(t("replacedCount", { n: count }));
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
    notify(t("replacedCount", { n: count }));
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
    const timer = setTimeout(() => notify(""), 3000);
    return () => clearTimeout(timer);
  }, [notice, notify]);

  const newNote = useCallback(
    async (title = t("untitledNote"), body = ""): Promise<boolean> => {
      if ((workspace?.notes.length ?? 0) >= MAX_NOTES) {
        notify(t("notesLimit"), true);
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
          notify(t("newNoteFailed"), true);
          return false;
        }
      } else {
        const note = createNote(crypto.randomUUID(), new Date().toISOString(), title, body);
        update((before) => ({ ...before, notes: [note, ...before.notes], activeId: note.id }));
      }
      setTrashView(false);
      setQuery("");
      setScratchOpen(false);
      resetActiveLine();
      requestAnimationFrame(() => editorRef.current?.focus());
      return true;
    },
    [workspace?.notes.length, resetActiveLine, update, notify, t],
  );

  // 焦点到编辑器并把光标放在文末：随手算的正文以空行结尾，文末即提示行下的空行，直接开写。
  const focusEditorAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, []);

  // 随手算只经顶栏按钮打开：内存里已有内容就原样恢复，没有才新建提示行加空行。
  // 打开即把 activeId 置空并持久化——「上次视图 = 随手算」，重开 app 时据此恢复为新随手算。
  const openScratch = useCallback(() => {
    setScratchNote((before) => before ?? createScratchNote(new Date().toISOString(), lang));
    setScratchOpen(true);
    update((before) => ({ ...before, activeId: null }));
    resetActiveLine();
    focusEditorAtEnd();
  }, [resetActiveLine, update, focusEditorAtEnd, lang]);

  // 回到「我的笔记」：随手算打开时点「我的笔记」tab 也离开（1.6.4 起，含高亮熄灭）；
  // activeId 无效（随手算/废纸篓/悬空）时落回第一篇可用笔记，让「上次视图 = 我的笔记」有据可依。
  const returnToNotes = useCallback(() => {
    setTrashView(false);
    setQuery("");
    setScratchOpen(false);
    resetActiveLine();
    update((before) => {
      const current = before.notes.find((note) => note.id === before.activeId && !note.trashed);
      if (current) return before;
      return {
        ...before,
        activeId: before.notes.find((note) => !note.trashed)?.id ?? null,
      };
    });
  }, [resetActiveLine, update]);

  // 启动恢复视图：activeId 无效——上次在随手算或废纸篓（null/空）、上次笔记已不存在、
  // 或首次打开——就打开一篇新的随手算（内存内容不跨进程，新的即提示行加空行），
  // 光标同样落在空行上。判定不回写 activeId：幂等，下次启动同样成立；
  // 用户点开哪篇笔记由后续操作持久化。
  const bootedRef = useRef(false);
  useLayoutEffect(() => {
    if (!workspace || bootedRef.current) return;
    bootedRef.current = true;
    const active = workspace.notes.find((note) => note.id === workspace.activeId);
    if (!active || active.trashed) {
      setScratchNote((before) => before ?? createScratchNote(new Date().toISOString(), lang));
      setScratchOpen(true);
      focusEditorAtEnd();
    }
    // bootedRef 保证只跑一次，lang 只影响新建随手算的提示行语言
  }, [workspace, focusEditorAtEnd, lang]);

  function patchNote(patch: Pick<Note, "body">) {
    if (!selected) return;
    // 用户手动编辑后，格式化的应用内撤销作废
    if (patch.body !== undefined && patch.body !== formatUndoRef.current?.formatted)
      formatUndoRef.current = null;
    if (selected.id === SCRATCH_NOTE_ID) {
      // 随手算只改内存状态，不走持久化队列
      setScratchNote((before) =>
        before ? { ...before, ...patch, updatedAt: new Date().toISOString() } : before,
      );
      return;
    }
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
    // 随手算没有文件名，标题不可改
    if (!current || !selected || selected.trashed || selected.id === SCRATCH_NOTE_ID) return;
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
    notify(t("noteRestored"));
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
      // 随手算没有历史：不落盘也就无从留档
      if (noteId === SCRATCH_NOTE_ID) return Promise.resolve();
      const note = workspace?.notes.find((item) => item.id === noteId);
      if (!note || note.trashed) return Promise.resolve();
      // 仅空行与空格视为空文件，存历史也没有内容可回溯，不留档；有文字或数字都算实质内容
      if (!body.trim()) return Promise.resolve();
      if (historyBaseline.current.get(noteId) === body) return Promise.resolve();
      historyBaseline.current.set(noteId, body);
      return recordHistoryFile(
        noteId,
        serializeNoteBody(body, {
          unitStyle: workspace?.format.unitStyle,
          lang: workspace?.uiLanguage,
        }),
        localTimestamp(),
        (workspace?.historyLimitKB ?? DEFAULT_HISTORY_LIMIT_KB) * 1024,
      ).catch(() => {
        notify(t("historyFailed"), true);
      });
    },
    [workspace, notify, t],
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
      notify(t("restoredTo", { label: historyLabel(entry.name, lang) }));
    },
    [selected, recordNoteHistory, update, refreshHistory, notify, t, lang],
  );
  // 打开历史弹窗时加载当前笔记的历史列表（UI 组件不直接读存储层）。
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  const activeNoteId = selected?.id ?? null;
  useEffect(() => {
    if (!historyOpen || !activeNoteId) return;
    // 随手算没有历史：弹窗永远是空的，也不去查询存储层
    if (activeNoteId === SCRATCH_NOTE_ID) {
      setHistoryEntries([]);
      return;
    }
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

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify(t("resultCopied"));
      } catch {
        notify(t("copyFailed"), true);
      }
    },
    [notify, t],
  );

  function insertExpression(expression: string) {
    if (!selected || selected.trashed) {
      newNote(t("quickCalcTitle"), expression.trim());
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
      notify(t("noteAtLimit"), true);
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
    notify(t("expressionInserted"));
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
      notify(t("formatFresh"));
      return;
    }
    const isScratch = selected.id === SCRATCH_NOTE_ID;
    // 格式化是破坏性操作：整理前的内容先留档进历史（随手算没有历史可留）
    if (!isScratch) void recordNoteHistory(selected.id, selected.body);
    const textarea = editorRef.current;
    if (textarea && formatted.length <= MAX_NOTE_LENGTH) {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try {
        if (document.execCommand("insertText", false, formatted)) {
          // execCommand 成功：原生撤销栈接管（一次 Cmd+Z 还原），
          // 不能再挂应用内撤销，否则连续 Cmd+Z 双轨回放会重复正文
          formatUndoRef.current = null;
          notify(t("formatted"));
          return;
        }
      } catch {
        // execCommand 不可用时走状态替换
      }
    }
    // 回退路径：React 状态替换，原生撤销栈没有这条记录，
    // 记住格式化前的正文，Cmd+Z 在无后续编辑时直接恢复。
    formatUndoRef.current = { noteId: selected.id, previous: selected.body, formatted };
    if (isScratch) {
      setScratchNote((before) =>
        before ? { ...before, body: formatted, updatedAt: new Date().toISOString() } : before,
      );
    } else {
      update((before) => ({
        ...before,
        notes: before.notes.map((note) =>
          note.id === selected.id
            ? { ...note, body: formatted, updatedAt: new Date().toISOString() }
            : note,
        ),
      }));
    }
    notify(t("formatted"));
  }, [selected, workspace, update, recordNoteHistory, notify, t]);

  // 右键菜单：定位（Finder）/导出/删除到废纸篓
  const closeNoteMenu = useCallback(() => setNoteMenu(null), []);
  // 菜单开着时，点击菜单外的任何位置或按 Escape 都关闭（菜单项的 pointerdown 在菜单内，不受影响）。
  const noteMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!noteMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && noteMenuRef.current?.contains(event.target)) return;
      setNoteMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) setNoteMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [noteMenu]);
  const revealNote = useCallback(
    async (noteId: string) => {
      try {
        await revealNoteFile(noteId);
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason), true);
      }
    },
    [notify],
  );
  const exportNoteById = useCallback(
    async (noteId: string, title: string) => {
      const note = workspace?.notes.find((item) => item.id === noteId);
      if (!note) return;
      try {
        if (
          await downloadText(
            `${title || t("untitledNote")}.txt`,
            serializeNoteBody(note.body, {
              unitStyle: workspace?.format.unitStyle,
              lang: workspace?.uiLanguage,
            }),
          )
        )
          notify(t("exported"));
      } catch {
        notify(t("exportFailed"), true);
      }
    },
    [workspace, notify, t],
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
      notify(t("trashedToast"));
    },
    [update, notify, t],
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
      notify(noteIds.length === 1 ? t("deletedOne") : t("deletedMany", { n: noteIds.length }));
    },
    [update, notify, t],
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
  // 主题推送（子窗就绪时补推防竞态）；界面语言同机制增量同步。
  const langRef = useRef(lang);
  langRef.current = lang;
  useEffect(() => {
    if (!isDesktopApp) return;
    void calculatorStatus()
      .then((status) => setCalculatorVisible(status.visible))
      .catch(() => {});
    const pushTheme = () => {
      void emit(CALCULATOR_THEME_EVENT, themeRef.current).catch(() => {});
      void emit(CALCULATOR_LANG_EVENT, langRef.current).catch(() => {});
    };
    const unlisten = listen<boolean>(CALCULATOR_VISIBILITY_EVENT, (event) => {
      setCalculatorVisible(event.payload === true);
      if (event.payload === true) pushTheme();
    });
    // 子窗挂载完成时立即补一次主题与语言，避免创建早期的推送丢失（竞态）。
    const unlistenReady = listen(CALCULATOR_READY_EVENT, pushTheme);
    return () => {
      void unlisten.then((dispose) => dispose());
      void unlistenReady.then((dispose) => dispose());
    };
  }, []);

  // 切换主题/语言时同步给计算器子窗口。
  useEffect(() => {
    if (!isDesktopApp) return;
    void emit(CALCULATOR_THEME_EVENT, workspace?.theme ?? "light").catch(() => {});
  }, [workspace?.theme]);
  useEffect(() => {
    if (!isDesktopApp) return;
    void emit(CALCULATOR_LANG_EVENT, lang).catch(() => {});
  }, [lang]);

  // 计算器「写入当前笔记」：经事件送达主窗，按格式化设置整理这一行后插入当前行之后
  //（1.6.16 起；帮助弹窗的示例插入不经过这里，保持原样）。
  const insertFromCalculatorRef = useRef<(expression: string) => void>(() => {});
  insertFromCalculatorRef.current = (expression: string) => {
    if (!workspace) return;
    insertExpression(formatLine(expression, workspace.format, convertUnitQuantity));
  };
  useEffect(() => {
    if (!isDesktopApp) return;
    const unlisten = listen<string>(CALCULATOR_INSERT_EVENT, (event) => {
      insertFromCalculatorRef.current(event.payload);
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
        if (selected.id === SCRATCH_NOTE_ID) {
          // 随手算的格式化撤销只回内存状态
          setScratchNote((before) =>
            before
              ? { ...before, body: formatUndo.previous, updatedAt: new Date().toISOString() }
              : before,
          );
        } else {
          update((before) => ({
            ...before,
            notes: before.notes.map((note) =>
              note.id === formatUndo.noteId
                ? { ...note, body: formatUndo.previous, updatedAt: new Date().toISOString() }
                : note,
            ),
          }));
        }
        notify(t("formatUndo"));
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
    notify,
    t,
  ]);

  if (!workspace)
    return (
      <main className="startup-screen">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>calcbook</h1>
        <p role="status">{error || t("openingNotes")}</p>
        {error && (
          <button className="primary-button" type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        )}
      </main>
    );

  return (
    <div className={`app-shell ${sidebarOpen ? "has-sidebar" : ""}`}>
      <aside className="sidebar" aria-label={t("notesNav")}>
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
              aria-label={t("searchNotes")}
              placeholder={`${t("searchNotes")}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="notebook-list-heading">
            <div className="notebook-tabs">
              <button
                type="button"
                className={trashView || scratchOpen ? "" : "is-active"}
                aria-pressed={!trashView && !scratchOpen}
                onClick={() => {
                  // 随手算打开时点当前 tab 也离开（ui.md：切 tab 都会离开随手算）
                  if (trashView || scratchOpen) returnToNotes();
                }}
              >
                {t("myNotes")}
              </button>
              <button
                type="button"
                className={trashView && !scratchOpen ? "is-active" : ""}
                aria-pressed={trashView && !scratchOpen}
                onClick={() => {
                  if (!trashView) {
                    setTrashView(true);
                    setQuery("");
                    setScratchOpen(false);
                    resetActiveLine();
                    // 废纸篓视图不属于「我的笔记」：清掉 activeId，重开 app 时落在随手算
                    update((before) => ({ ...before, activeId: null }));
                  } else if (scratchOpen) {
                    // 从废纸篓打开的随手算盖在废纸篓视图上：点当前 tab 关掉随手算回到列表
                    setScratchOpen(false);
                    resetActiveLine();
                  }
                }}
              >
                {t("trash")}
              </button>
            </div>
            {trashView ? (
              <div className="heading-actions">
                <span className="trash-count" title={t("trashCountTitle")}>
                  {trashCount}
                </span>
                <IconButton
                  title={t("emptyTrashTitle")}
                  onClick={() => setConfirmDelete({ mode: "all", count: trashCount })}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            ) : (
              <IconButton title={t("newNote")} onClick={() => void newNote()}>
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
                  setScratchOpen(false);
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
                  <strong>{note.title || t("untitledNote")}</strong>
                </span>
                <span className="note-preview">
                  {note.body
                    .split("\n")
                    .find((line) => line.trim())
                    ?.replace(/^#+\s*/, "") || t("blankPreview")}
                </span>
                <span className="note-date">{formatDate(note.updatedAt, lang)}</span>
              </button>
            ))}
            {visibleNotes.length === 0 && (
              <p className="no-notes">
                {query ? t("noMatchNote") : trashView ? t("trashEmpty") : t("startBlank")}
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="settings-entry">
              <button
                type="button"
                title={t("settingsWithKey")}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} />
                <span>{t("settings")}</span>
              </button>
              <IconButton
                className="lang-toggle"
                title={lang === "en" ? t("useChinese") : t("useEnglish")}
                onClick={() =>
                  update((before) => ({
                    ...before,
                    uiLanguage: before.uiLanguage === "en" ? "zh" : "en",
                  }))
                }
              >
                {/* 字形显示切换目标：英文界面点「中」进中文，中文界面点「En」回英文 */}
                <LanguageGlyph lang={lang === "en" ? "zh" : "en"} />
              </IconButton>
              <IconButton
                className="theme-toggle"
                title={workspace.theme === "dark" ? t("toLightMode") : t("toDarkMode")}
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
              title={sidebarOpen ? t("collapseList") : t("expandList")}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </IconButton>
            <BookOpen size={15} />
            {scratchOpen ? (
              <strong>{t("scratch")}</strong>
            ) : (
              <>
                <span>{trashView ? t("trash") : t("myNotes")}</span>
                <ChevronRight size={13} />
                <strong>{selected?.title || (trashView ? t("trash") : "")}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {status === "error" && (
              <span className="save-status save-error" role="alert">
                {t("notSaved")}
              </span>
            )}
            <button
              type="button"
              className={`topbar-tool ${scratchOpen ? "is-open" : ""}`}
              aria-pressed={scratchOpen}
              title={t("scratchTitle")}
              onClick={openScratch}
            >
              <SquarePen size={16} />
              <span>{t("scratch")}</span>
            </button>
            <button
              type="button"
              className={`calculator-toggle ${calculatorVisible ? "is-open" : ""}`}
              aria-pressed={calculatorVisible}
              title={calculatorVisible ? t("calculatorOpen") : t("calculatorOpenTitle")}
              onClick={() => {
                if (!isDesktopApp) {
                  notify(t("calculatorDesktopOnly"), true);
                  return;
                }
                void toggleCalculator()
                  .then((status) => setCalculatorVisible(status.visible))
                  .catch(() => notify(t("calculatorOpenFailed"), true));
              }}
            >
              <CalculatorIcon size={16} />
              <span>{t("calculator")}</span>
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void flush().catch(() => {})}>
              {t("retrySave")}
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
                    {scratchOpen
                      ? t("tempNote")
                      : t("updatedAtDate", { date: formatDate(selected.updatedAt, lang) })}
                  </span>
                  <span className="note-saved-dot" />
                  <span>{t("slogan")}</span>
                </div>
                {/* 顺序约定：查找替换、格式化、历史、删除（废纸篓视图为恢复/永久删除）、语法速查 */}
                <div className="note-tools">
                  <IconButton
                    title={findOpen ? t("closeFind") : t("findReplace")}
                    onClick={toggleFind}
                  >
                    <Search size={16} />
                  </IconButton>
                  <IconButton title={t("formatPage")} onClick={applyFormatting}>
                    <Sparkles size={16} />
                  </IconButton>
                  <IconButton title={t("historyRecords")} onClick={() => setHistoryOpen(true)}>
                    <CalendarClock size={16} />
                  </IconButton>
                  {selected.trashed ? (
                    <>
                      <IconButton title={t("restoreNote")} onClick={restoreNote}>
                        <Undo2 size={16} />
                      </IconButton>
                      <IconButton
                        title={t("deleteForever")}
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
                      title={scratchOpen ? t("scratchNoTrash") : t("moveToTrash")}
                      disabled={scratchOpen}
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
                  <IconButton title={t("syntaxHelp")} onClick={() => setHelpOpen(true)}>
                    <CircleHelp size={16} />
                  </IconButton>
                </div>
              </div>
              <input
                className="note-title"
                aria-label={t("noteTitle")}
                title={scratchOpen ? t("scratchNoFilename") : t("titleIsFilename")}
                value={scratchOpen ? t("scratch") : (draft ?? selected.title)}
                placeholder={t("untitledNote")}
                maxLength={MAX_TITLE_LENGTH}
                readOnly={scratchOpen || selected.trashed}
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
                <span>{t("inTrashBanner")}</span>
                <button type="button" onClick={restoreNote}>
                  {t("restoreNote")}
                </button>
              </div>
            )}
            <div className="find-host">
              {findOpen && (
                <FindReplaceBar
                  lang={lang}
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
                lang={lang}
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
                {t("resultCount", { n: resultCount })}
                {errorCount > 0 && (
                  <>
                    <span className="statusbar-sep">|</span>
                    <button
                      type="button"
                      className="error-count"
                      title={t("errorNavTitle")}
                      onClick={gotoNextError}
                    >
                      {t("errorCount", { n: errorCount })}
                    </button>
                  </>
                )}
                {activeError && (
                  <>
                    <span className="statusbar-sep">|</span>
                    <span className="error-detail">
                      {t("errorOrdinal", { n: activeErrorOrdinal, error: activeError.error ?? "" })}
                    </span>
                  </>
                )}
              </span>
              <span>
                {t("lineNo", { n: Math.min(activeLine + 1, results.length) })}
                <span className="statusbar-divider" />
                {t("copyHint")}
              </span>
            </footer>
          </>
        ) : (
          <div className="empty-page">
            <BookOpen size={38} strokeWidth={1.2} />
            <h1>{trashView ? t("trashKeepIdeas") : t("blankPageTitle")}</h1>
            <p>{trashView ? t("trashKeepsNotes") : t("startFromIdea")}</p>
            {/* 废纸篓不接受新建：只能由笔记删除过来，空态只说明不留入口 */}
            {!trashView && (
              <button type="button" className="primary-button" onClick={() => void newNote()}>
                <Plus size={16} />
                {t("newNote")}
              </button>
            )}
          </div>
        )}
      </main>
      {helpOpen && (
        <HelpDialog lang={lang} onClose={() => setHelpOpen(false)} onInsert={insertExpression} />
      )}
      {noteMenu && (
        <div
          ref={noteMenuRef}
          className="context-menu"
          role="menu"
          aria-label={t("noteActions")}
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
            {t("reveal")}
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
            {t("export")}
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
            {t("delete")}
          </button>
        </div>
      )}
      {confirmDelete && (
        <Dialog
          className="confirm-dialog"
          label={confirmDelete.mode === "trash" ? t("trashConfirmLabel") : t("deleteConfirmLabel")}
          onClose={() => setConfirmDelete(null)}
        >
          <div className="settings-heading">
            <div>
              <h2>
                {confirmDelete.mode === "trash" ? t("moveToTrashTitle") : t("deleteForeverTitle")}
              </h2>
              <p>
                {confirmDelete.mode === "all"
                  ? t("deleteAllConfirm", { n: confirmDelete.count })
                  : confirmDelete.mode === "trash"
                    ? t("trashOneConfirm", { title: confirmDelete.title || t("untitledNote") })
                    : t("deleteOneConfirm", { title: confirmDelete.title || t("untitledNote") })}
              </p>
            </div>
          </div>
          <div className="settings-footer">
            <span role="note">
              {confirmDelete.mode === "trash" ? t("trashFooterNote") : t("deleteFooterNote")}
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
                  notify(t("trashedCanRestore"));
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
              {confirmDelete.mode === "trash" ? t("moveToTrashTitle") : t("deleteForeverTitle")}
            </button>
          </div>
        </Dialog>
      )}
      {settingsOpen && workspace && storage && (
        <SettingsDialog
          lang={lang}
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
          lang={lang}
          entries={historyEntries}
          onClose={() => setHistoryOpen(false)}
          onRestore={restoreHistory}
          onDelete={(entry) =>
            deleteHistoryFile(selected.id, entry.name)
              .then(() => {
                notify(t("historyDeleted", { label: historyLabel(entry.name, lang) }));
                void listHistory(selected.id, localHourPrefix())
                  .then((list) => setHistoryEntries(list))
                  .catch(() => setHistoryEntries([]));
              })
              .catch(() => notify(t("historyDeleteFailed"), true))
          }
        />
      )}
      {notice && (
        <div className={`toast ${noticeAlert ? "is-alert" : ""}`} role="status">
          {noticeAlert ? <CircleAlert size={15} /> : <Check size={15} />}
          <span>{notice}</span>
          <IconButton title={t("closeNotice")} onClick={() => notify("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
