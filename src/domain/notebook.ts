import { DEFAULT_FORMAT_SETTINGS, type FormatSettings, parseFormatSettings } from "./formatting.ts";

export const MAX_NOTES = 100;
export const MAX_NOTE_LENGTH = 100_000;
export const MAX_TITLE_LENGTH = 120;
export const THEME_IDS = ["light", "dark"] as const;
export type Theme = (typeof THEME_IDS)[number];
// 0.6.10 及以前的 paper/midnight 与更早的六套主题，读取时统一迁移到 light/dark。
const LEGACY_THEMES: Record<string, Theme> = {
  paper: "light",
  sand: "light",
  mist: "light",
  midnight: "dark",
  forest: "dark",
  graphite: "dark",
};
export type Note = {
  id: string;
  // 桌面版标题即文件名主干（无扩展名），由存储层维护；浏览器预览是独立字段。
  title: string;
  // 桌面版里正文单独存成 <filename>.txt；空字符串表示由存储层决定。
  filename: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  trashed: boolean;
};

// 单条编辑历史：name 是本地时间的小时桶（`年-月-日-时`），content 是当时的文件正文。
export type HistoryEntry = { name: string; content: string };
export type Workspace = {
  version: 1;
  notes: Note[];
  activeId: string | null;
  theme: Theme;
  format: FormatSettings;
  // 每个笔记的历史版本空间上限（KB），0 = 关闭历史；见 parseWorkspace 的取值范围。
  historyLimitKB: number;
};

// 历史空间默认与取值范围：0 关闭，上限 64 MB。
export const DEFAULT_HISTORY_LIMIT_KB = 128;
export const MAX_HISTORY_LIMIT_KB = 65536;

export function isHistoryLimitKB(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_HISTORY_LIMIT_KB
  );
}

export function createNote(id: string, now: string, title = "未命名笔记", body = ""): Note {
  return { id, title, filename: "", body, createdAt: now, updatedAt: now, trashed: false };
}

// 随手算：内存中的临时算稿，只存在于 App 状态里，绝不进入工作区与持久化层。
// id 含「/」——文件名主干不允许出现斜杠（parseWorkspace 拒绝），不可能与真实笔记撞 id。
// 正文是提示行加一个空行（结尾换行即空行）：打开时光标落在空行上，直接开写。
export const SCRATCH_NOTE_ID = "scratch/随手算";
export const SCRATCH_NOTE_BODY = "# 随手算笔记不会保存，app 退出即消失\n";
export function createScratchNote(now: string): Note {
  return createNote(SCRATCH_NOTE_ID, now, "随手算", SCRATCH_NOTE_BODY);
}

// 改名重定向（桌面版）：改名后旧 id 的排队保存/历史操作落到新文件。
// 改回旧名会让映射出现自环（A→B 后 B→A 得 A→A）：环上的名字就是最终名，解析到环即停。
export function redirectRenamedId(map: Map<string, string>, from: string, to: string): void {
  for (const [key, value] of map) if (value === from) map.set(key, to);
  map.set(from, to);
}

export function resolveRenamedId(map: Map<string, string>, id: string): string {
  let current = id;
  // 步数上限即环防线：无环链的跳数不可能超过映射条目数
  for (let steps = 0; map.has(current) && steps <= map.size; steps++)
    current = map.get(current) as string;
  return current;
}

export const EXAMPLES = [
  {
    title: "周末出行计划",
    body: "# 去山野，过个慢周末\n// 两个人的短途旅行，把预算也一起记下来。\n\n交通 = 186 × 2\n住宿 = 420 × 2\n餐饮 = 240\n预算 = 交通 + 住宿 + 餐饮\n\n# 给快乐留一点余地\n每人 = 预算 / 2\n备用金：每人 × 10%\n人均预算：每人 + 10%\n\n// 数字变了，答案也会跟着变。",
  },
  {
    title: "工作室小预算",
    body: "# 一张桌子，一个新开始\n桌子：1299 CNY\n椅子：899 CNY\n台灯：249 CNY\n合计\n\n# 量一量，刚刚好\n桌面宽度：1.4 m to cm\n线材长度：2 m + 50 cm\n专注时间：90 min to hour",
  },
  {
    title: "从这里开始",
    body: "# 你好，Calcbook\n像写笔记一样计算，答案会出现在右边。\n\n# 基础算式\n(18 + 24) × 3\n0.1 + 0.2\nsqrt(144)\n\n# 变量与百分比\n单价 = 128\n数量 = 3\n单价 × 数量 - 15%\n20% of 150\n\n# 单位换算\n5 km to m\n90 min to hour\n\n# 分段汇总\n24\n36\nsum\navg\n\n// 空行会开始新的汇总段落。\n// 标签后加冒号；# 写标题；// 写注释。",
  },
];

export function createWorkspace(now: string, makeId: () => string): Workspace {
  const notes = EXAMPLES.map((example) => createNote(makeId(), now, example.title, example.body));
  return {
    version: 1,
    notes,
    // activeId=null 表示「当前显示的不是我的笔记里的笔记」：首次打开落在随手算上，
    // 由 App 依据该约定恢复视图（1.6.0 起）。
    activeId: null,
    theme: "light",
    format: DEFAULT_FORMAT_SETTINGS,
    historyLimitKB: DEFAULT_HISTORY_LIMIT_KB,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspace(input: unknown): Workspace {
  if (!record(input) || input.version !== 1)
    throw new Error("笔记格式或版本不受支持，原数据已保留。");
  if (!Array.isArray(input.notes) || input.notes.length > MAX_NOTES)
    throw new Error("笔记列表无效或超过 100 篇。");
  const theme = LEGACY_THEMES[input.theme as string] ?? input.theme;
  if (!THEME_IDS.includes(theme as Theme)) throw new Error("笔记主题配置无效。");
  // 旧数据没有 format：按默认格式设置；更早的 unitMode 迁移到「单位使用」。
  // calculatorMode 字段已废弃，读取时忽略。
  const format =
    input.format === undefined
      ? {
          ...DEFAULT_FORMAT_SETTINGS,
          ...(input.unitMode === "chinese" ? { unitStyle: "chinese" as const } : {}),
          ...(input.unitMode === "english" ? { unitStyle: "lower" as const } : {}),
        }
      : parseFormatSettings(input.format);
  const ids = new Set<string>();
  const notes = input.notes.map((note): Note => {
    const filename = record(note) && note.filename !== undefined ? note.filename : "";
    if (
      !record(note) ||
      typeof note.id !== "string" ||
      !note.id ||
      note.id.length > 100 ||
      ids.has(note.id) ||
      typeof note.title !== "string" ||
      note.title.length > MAX_TITLE_LENGTH ||
      typeof filename !== "string" ||
      filename.length > 200 ||
      /[\\/]/.test(filename) ||
      typeof note.body !== "string" ||
      note.body.length > MAX_NOTE_LENGTH ||
      typeof note.createdAt !== "string" ||
      !Number.isFinite(Date.parse(note.createdAt)) ||
      typeof note.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(note.updatedAt)) ||
      typeof note.trashed !== "boolean"
    ) {
      throw new Error("笔记内容损坏或超出长度限制，原数据已保留。");
    }
    ids.add(note.id);
    return {
      id: note.id,
      title: note.title,
      filename,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      trashed: note.trashed,
    };
  });
  if (input.activeId !== null && (typeof input.activeId !== "string" || !ids.has(input.activeId))) {
    throw new Error("当前笔记引用无效，原数据已保留。");
  }
  // 历史空间：缺省或取值非法时回落默认（128KB），不让手工改动阻塞启动
  const historyLimitKB = isHistoryLimitKB(input.historyLimitKB)
    ? input.historyLimitKB
    : DEFAULT_HISTORY_LIMIT_KB;
  return {
    version: 1,
    notes,
    activeId: input.activeId,
    theme: theme as Theme,
    format,
    historyLimitKB,
  };
}
