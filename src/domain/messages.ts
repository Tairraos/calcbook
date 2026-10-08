// 计算与工作区的用户可见消息：zh/en 两套词典按 key 对齐。
// domain 层只依赖语言字符串，不依赖 UI；错误一律抛具体消息，不得伪装成数值。

export type Lang = "zh" | "en";

const zh = {
  bracketDepth: "括号嵌套层数越限",
  onlyNumbersUnits: "这里只支持数字和单位计算",
  numberBeforeUnit: "请在单位前输入数字",
  resultInvalid: "结果无效，请检查除零或函数的取值范围",
  tooLarge: "数值过大，请控制在 1e308 以内",
  tooComplex: "算式太复杂，请拆成多行",
  undefinedSymbol: `“{name}”尚未定义`,
  unsupportedOperator: "暂不支持这个运算符",
  unsupportedFunction: "暂不支持这个函数",
  expressionOnly: "仅支持算式，不支持脚本、数组或属性访问",
  exponentTooLarge: "指数绝对值不能超过 1000",
  numberWidth: "数字宽度超限",
  resultNumberWidth: "计算结果数字宽度超限",
  lineTooLong: "单行算式最多 1000 个字符",
  emptyExpression: "先输入一个算式",
  blockHasError: "本段含有错误，请修正后再汇总",
  blockEmpty: "本段还没有可汇总的结果",
  conflictFunction: `保留字冲突：“{name}”是函数名，请换一个变量名`,
  conflictConstant: `保留字冲突：“{name}”是常量名，请换一个变量名`,
  conflictSummary: `保留字冲突：“{name}”是汇总关键字，请换一个变量名`,
  conflictPrev: `保留字冲突：“{name}”指上一行的结果，请换一个变量名`,
  conflictConversion: `保留字冲突：“{name}”是单位转换关键字，请换一个变量名`,
  conflictUnit: `保留字冲突：“{name}”是单位名，请换一个变量名`,
  incompatibleUnits: "单位不兼容；不同货币暂不支持换算",
  incomplete: "算式还不完整，检查数字、单位和括号",
  cannotCompute: "无法计算这一行",
  workspaceVersion: "笔记格式或版本不受支持，原数据已保留。",
  notesInvalid: "笔记列表无效或超过 100 篇。",
  themeInvalid: "笔记主题配置无效。",
  noteCorrupt: "笔记内容损坏或超出长度限制，原数据已保留。",
  activeIdInvalid: "当前笔记引用无效，原数据已保留。",
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  bracketDepth: "Brackets nested too deep (max 3 levels)",
  onlyNumbersUnits: "Only numbers and units can be calculated here",
  numberBeforeUnit: "Put a number before the unit",
  resultInvalid: "Invalid result — check for division by zero or out-of-range functions",
  tooLarge: "Value too large — keep it within 1e308",
  tooComplex: "Expression too complex — split it into several lines",
  undefinedSymbol: `"{name}" is not defined`,
  unsupportedOperator: "This operator is not supported",
  unsupportedFunction: "This function is not supported",
  expressionOnly: "Expressions only — scripts, arrays and property access are not supported",
  exponentTooLarge: "Exponent magnitude cannot exceed 1000",
  numberWidth: "Number too wide (max 16 integer digits, 4 decimals)",
  resultNumberWidth: "Result too wide (max 16 integer digits, 4 decimals)",
  lineTooLong: "A line can hold at most 1000 characters",
  emptyExpression: "Type an expression first",
  blockHasError: "This section has an error — fix it before summarizing",
  blockEmpty: "Nothing to summarize yet in this section",
  conflictFunction: `Reserved word: "{name}" is a function name — pick another variable name`,
  conflictConstant: `Reserved word: "{name}" is a constant name — pick another variable name`,
  conflictSummary: `Reserved word: "{name}" is a summary keyword — pick another variable name`,
  conflictPrev: `Reserved word: "{name}" refers to the previous result — pick another variable name`,
  conflictConversion: `Reserved word: "{name}" is a conversion keyword — pick another variable name`,
  conflictUnit: `Reserved word: "{name}" is a unit name — pick another variable name`,
  incompatibleUnits: "Units don't match; converting between currencies isn't supported",
  incomplete: "The expression looks incomplete — check numbers, units and brackets",
  cannotCompute: "This line cannot be calculated",
  workspaceVersion: "Unsupported note format or version — your data was kept untouched.",
  notesInvalid: "Invalid note list, or more than 100 notes.",
  themeInvalid: "Invalid theme configuration.",
  noteCorrupt:
    "Note content is corrupted or exceeds the length limit — your data was kept untouched.",
  activeIdInvalid: "Invalid current-note reference — your data was kept untouched.",
};

// msg("en", "undefinedSymbol", { name: "foo" }) → '"foo" is not defined'
export function msg(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const template = (lang === "en" ? en[key] : zh[key]) ?? zh[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
