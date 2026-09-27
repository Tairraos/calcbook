import { isUnit } from "mathjs";

// 单位模式：free 允许整篇混用（但同一行内中英文单位混用时统一成中文，公制英制混用时结果并入公制）；
// chinese/english 在光标离开刚算完的行时，把该行单位改写成对应语言。
export const UNIT_MODES = ["free", "chinese", "english"] as const;
export type UnitMode = (typeof UNIT_MODES)[number];
export const DEFAULT_UNIT_MODE: UnitMode = "free";

export function parseUnitMode(input: unknown): UnitMode {
  if (typeof input !== "string" || !UNIT_MODES.includes(input as UnitMode))
    throw new Error("单位模式配置无效。");
  return input as UnitMode;
}

type Entry = {
  // en 是改写与换算的规范写法（mathjs 可解析；复合单位形如 mile/hour）。
  en: string;
  // zh 是中文规范写法，同时也是可解析的别名。
  zh: string;
  aliases?: string[];
  imperial?: boolean;
};

// [en, zh, 其他写法, 是否英制]。时间/角度/数据/货币不参与公制英制合并，只参与中英改写。
export const UNITS: Entry[] = [
  // 长度
  { en: "nm", zh: "纳米", aliases: ["nanometer", "nanometers"] },
  { en: "um", zh: "微米", aliases: ["micrometer", "micrometers"] },
  { en: "mm", zh: "毫米", aliases: ["millimeter", "millimeters"] },
  { en: "cm", zh: "厘米", aliases: ["centimeter", "centimeters", "公分"] },
  { en: "dm", zh: "分米", aliases: ["decimeter", "decimeters"] },
  { en: "m", zh: "米", aliases: ["meter", "meters", "公尺"] },
  { en: "km", zh: "公里", aliases: ["kilometer", "kilometers", "千米"] },
  { en: "shili", zh: "里", aliases: ["市里"] },
  { en: "nmi", zh: "海里", aliases: ["nauticalmile", "nauticalmiles"] },
  { en: "angstrom", zh: "埃", aliases: ["angstroms"] },
  { en: "inch", zh: "英寸", aliases: ["inches"], imperial: true },
  { en: "foot", zh: "英尺", aliases: ["feet", "ft"], imperial: true },
  { en: "yard", zh: "码", aliases: ["yards", "yd"], imperial: true },
  { en: "mile", zh: "英里", aliases: ["miles", "mi"], imperial: true },
  {
    en: "mile/hour",
    zh: "英里/小时",
    aliases: ["mph", "miles/hour", "英里每小时"],
    imperial: true,
  },
  // 面积
  { en: "mm2", zh: "平方毫米" },
  { en: "cm2", zh: "平方厘米" },
  { en: "m2", zh: "平方米", aliases: ["squaremeter", "squaremeters"] },
  { en: "km2", zh: "平方公里", aliases: ["平方千米", "squarekilometer", "squarekilometers"] },
  { en: "hectare", zh: "公顷", aliases: ["hectares"] },
  { en: "mu", zh: "亩" },
  { en: "acre", zh: "英亩", aliases: ["acres"], imperial: true },
  { en: "sqft", zh: "平方英尺", aliases: ["squarefeet", "squarefoot"], imperial: true },
  { en: "sqin", zh: "平方英寸", aliases: ["squareinch", "squareinches"], imperial: true },
  { en: "sqmi", zh: "平方英里", aliases: ["squaremile", "squaremiles"], imperial: true },
  // 体积
  { en: "ml", zh: "毫升", aliases: ["milliliter", "milliliters"] },
  { en: "cl", zh: "厘升" },
  { en: "dl", zh: "分升" },
  { en: "l", zh: "升", aliases: ["L", "ml", "liter", "liters", "litre", "litres", "公升"] },
  { en: "m3", zh: "立方米", aliases: ["cubicmeter", "cubicmeters"] },
  { en: "shi", zh: "石", aliases: ["市石"] },
  { en: "cm3", zh: "立方厘米", aliases: ["cc", "cubiccentimeter", "cubiccentimeters"] },
  { en: "floz", zh: "液量盎司", aliases: ["fluidounce", "fluidounces"], imperial: true },
  { en: "cup", zh: "杯", aliases: ["cups"], imperial: true },
  { en: "pint", zh: "品脱", aliases: ["pints", "pt"], imperial: true },
  { en: "quart", zh: "夸脱", aliases: ["quarts", "qt"], imperial: true },
  { en: "gallon", zh: "加仑", aliases: ["gallons", "gal"], imperial: true },
  { en: "tablespoon", zh: "汤匙", aliases: ["tablespoons", "tbsp"], imperial: true },
  { en: "teaspoon", zh: "茶匙", aliases: ["teaspoons", "tsp"], imperial: true },
  {
    en: "bbl",
    zh: "桶",
    aliases: ["oilbarrel", "oilbarrels", "beerbarrel", "beerbarrels"],
    imperial: true,
  },
  // 质量
  { en: "ug", zh: "微克", aliases: ["microgram", "micrograms"] },
  { en: "mg", zh: "毫克", aliases: ["milligram", "milligrams"] },
  { en: "g", zh: "克", aliases: ["gram", "grams"] },
  { en: "kg", zh: "千克", aliases: ["kilogram", "kilograms", "公斤"] },
  { en: "t", zh: "吨", aliases: ["tonne", "tonnes", "公吨"] },
  { en: "jin", zh: "斤" },
  { en: "dan", zh: "担", aliases: ["市担"] },
  { en: "dan", zh: "担", aliases: ["市担"] },
  { en: "liang", zh: "两" },
  { en: "qian", zh: "钱", aliases: ["市钱"] },
  { en: "lb", zh: "磅", aliases: ["pound", "pounds", "lbs", "lbm"], imperial: true },
  { en: "oz", zh: "盎司", aliases: ["ounce", "ounces"], imperial: true },
  { en: "stone", zh: "英石", aliases: ["stones"], imperial: true },
  // 时间（不参与公制英制合并）
  { en: "ns", zh: "纳秒" },
  { en: "us", zh: "微秒" },
  { en: "ms", zh: "毫秒" },
  { en: "second", zh: "秒", aliases: ["s", "sec", "secs"] },
  { en: "minute", zh: "分钟", aliases: ["min", "mins"] },
  { en: "hour", zh: "小时", aliases: ["h", "hr", "hrs"] },
  { en: "day", zh: "天", aliases: ["d", "日"] },
  { en: "week", zh: "周", aliases: ["weeks", "星期"] },
  { en: "month", zh: "月", aliases: ["months"] },
  { en: "year", zh: "年", aliases: ["years"] },
  // 温度
  { en: "degC", zh: "摄氏度", aliases: ["celsius"] },
  { en: "degF", zh: "华氏度", aliases: ["fahrenheit"], imperial: true },
  { en: "K", zh: "开尔文", aliases: ["kelvin"] },
  // 能量
  { en: "mJ", zh: "毫焦" },
  { en: "J", zh: "焦", aliases: ["joule", "joules", "焦耳"] },
  { en: "kJ", zh: "千焦", aliases: ["kilojoule", "kilojoules"] },
  { en: "MJ", zh: "兆焦" },
  { en: "cal", zh: "卡", aliases: ["calorie", "calories", "卡路里"] },
  { en: "kcal", zh: "千卡", aliases: ["大卡"] },
  { en: "Wh", zh: "瓦时" },
  { en: "kWh", zh: "千瓦时" },
  { en: "eV", zh: "电子伏", aliases: ["electronvolt", "electronvolts"] },
  { en: "BTU", zh: "英热单位", aliases: ["BTUs", "btu", "btus"], imperial: true },
  // 功率 / 力 / 压强
  { en: "mW", zh: "毫瓦" },
  { en: "W", zh: "瓦", aliases: ["watt", "watts", "瓦特"] },
  { en: "kW", zh: "千瓦", aliases: ["kilowatt", "kilowatts"] },
  { en: "MW", zh: "兆瓦" },
  { en: "hp", zh: "马力", imperial: true },
  { en: "mN", zh: "毫牛" },
  { en: "N", zh: "牛", aliases: ["newton", "newtons", "牛顿"] },
  { en: "kN", zh: "千牛" },
  { en: "lbf", zh: "磅力", aliases: ["poundforce"], imperial: true },
  { en: "dyn", zh: "达因", aliases: ["dyne", "dynes"] },
  { en: "Pa", zh: "帕", aliases: ["pascal", "pascals", "帕斯卡"] },
  { en: "kPa", zh: "千帕" },
  { en: "MPa", zh: "兆帕" },
  { en: "hPa", zh: "百帕" },
  { en: "mbar", zh: "毫巴" },
  { en: "bar", zh: "巴", aliases: ["bars"] },
  { en: "mmHg", zh: "毫米汞柱", aliases: ["mmhg"] },
  { en: "atm", zh: "标准大气压" },
  { en: "torr", zh: "托" },
  { en: "psi", zh: "磅力每平方英寸", imperial: true },
  { en: "knot", zh: "节", imperial: true },
  // 频率 / 电学 / 数据（数据不参与公制英制合并）
  { en: "Hz", zh: "赫兹", aliases: ["hertz"] },
  { en: "kHz", zh: "千赫" },
  { en: "MHz", zh: "兆赫" },
  { en: "mV", zh: "毫伏" },
  { en: "V", zh: "伏", aliases: ["volt", "volts", "伏特"] },
  { en: "kV", zh: "千伏" },
  { en: "mA", zh: "毫安" },
  { en: "A", zh: "安", aliases: ["ampere", "amperes", "amp", "amps", "安培"] },
  { en: "ohm", zh: "欧姆", aliases: ["ohms"] },
  { en: "mol", zh: "摩尔", aliases: ["moles"] },
  { en: "bit", zh: "比特", aliases: ["bits"] },
  { en: "B", zh: "字节", aliases: ["byte", "bytes"] },
  { en: "kB", zh: "千字节" },
  { en: "MB", zh: "兆字节" },
  { en: "GB", zh: "吉字节" },
  // 货币（不参与公制英制合并）
  { en: "CNY", zh: "元", aliases: ["人民币"] },
  { en: "USD", zh: "美元" },
  { en: "EUR", zh: "欧元" },
  { en: "GBP", zh: "英镑" },
];

// mathjs 拒绝非字母开头的单位名，中文一律经由别名表在解析前替换成英文单位。
let customUnitsRegistered = false;

export function registerCustomUnits(math: {
  createUnit: (name: string, options: Record<string, unknown>) => unknown;
  Unit: { UNITS: Record<string, unknown> };
}): void {
  // 模块在测试里可能被重复初始化；mathjs 的 createUnit 不允许重名。
  if (customUnitsRegistered || math.Unit.UNITS.dan) return;
  customUnitsRegistered = true;
  math.createUnit("nmi", { definition: "1852 m" });
  math.createUnit("mu", { definition: "666.6666666666667 m2" });
  math.createUnit("dan", { definition: "50 kg" });
  math.createUnit("jin", { definition: "500 g" });
  math.createUnit("liang", { definition: "50 g" });
  math.createUnit("qian", { definition: "5 g" });
  math.createUnit("shili", { definition: "500 m" });
  math.createUnit("shi", { definition: "100 L" });
  math.createUnit("cal", { definition: "4.184 J" });
  math.createUnit("knot", { definition: "1.852 km / h" });
}

const isChinese = (text: string) => /\p{Script=Han}/u.test(text);

// 解析用别名表：中文与英文变体都指向 mathjs 可解析的写法。
export const parseUnitAliases: Record<string, string> = {};
// 英文写法 → 中文规范名（中文模式改写用）。
const enToZh: Record<string, string> = {};
// 中文写法 → 英文规范写法（解析与英文模式改写用）。
const zhToEn: Record<string, string> = {};
// 中文写法 → 中文规范名（自由模式混用时统一写法，如 千米 → 公里）。
const zhToCanonical: Record<string, string> = {};
for (const entry of UNITS) {
  // 首见优先：同一别名重复登记时不覆盖先前的映射（如 l 的别名 ml 不得顶掉毫升）。
  if (!(entry.zh in parseUnitAliases)) parseUnitAliases[entry.zh] = entry.en;
  if (!(entry.zh in zhToEn)) zhToEn[entry.zh] = entry.en;
  if (!(entry.en in enToZh)) enToZh[entry.en] = entry.zh;
  for (const alias of entry.aliases ?? []) {
    if (alias in parseUnitAliases) continue;
    parseUnitAliases[alias] = entry.en;
    if (isChinese(alias)) {
      if (!(alias in zhToEn)) zhToEn[alias] = entry.en;
      zhToCanonical[alias] = entry.zh;
    } else if (!alias.includes("/")) {
      if (!(alias in enToZh)) enToZh[alias] = entry.zh;
    }
  }
}


// 大小写兼容：输入 `5 KM` `1500MG` `2 ML` 与小写等价，输出统一小写缩写。
// 表：小写形式 → 规范写法（输出用小写，重解析经此表还原）。
// mathjs 的大小写有语义（M=兆、m=毫），这里按笔记场景定优先级：
// b/B→字节（比特写 bit）、s/S→秒（西门子写 siemens）、t/T→吨（特斯拉写 tesla）。
export const caseUnitAliases: Record<string, string> = (() => {
  const tokens = new Set<string>();
  for (const entry of UNITS) {
    if (!entry.en.includes("/")) tokens.add(entry.en);
    for (const alias of entry.aliases ?? []) {
      if (!isChinese(alias) && !alias.includes("/")) tokens.add(alias);
    }
  }
  const prefixes = ["k", "M", "G", "T", "d", "c", "m", "u", "n", "h"];
  const bases = ["m", "g", "l", "m2", "m3", "s", "J", "W", "N", "Pa", "Hz", "V", "A", "cal", "Wh"];
  for (const base of bases) {
    tokens.add(base);
    for (const prefix of prefixes) tokens.add(prefix + base);
  }
  const overrides: Record<string, string> = {
    b: "B", s: "s", t: "t", m: "m", a: "A", n: "N", w: "W", v: "V",
    j: "J", k: "K", d: "d", h: "h", g: "g", l: "l",
  };
  const map: Record<string, string> = {};
  // 小写原形（mg、km2）先占位；生成组合（Mg、Mm2）的小写已被占位时跳过。
  for (const token of tokens) {
    if (token.toLowerCase() === token) map[token] = token;
  }
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === token || map[lower]) continue;
    map[lower] = overrides[lower] ?? token;
  }
  // 单字母按笔记场景定优先级（覆盖 identity）。
  for (const [lower, canonical] of Object.entries(overrides)) map[lower] = canonical;
  return map;
})();

// 输出侧判定：小写形式能否作为单位重新解析（用于把结果统一成小写缩写）。
export function isKnownUnitLower(lower: string): boolean {
  return caseUnitAliases[lower] !== undefined || parseUnitAliases[lower] !== undefined;
}

const zhTokens = new Set(Object.keys(zhToEn));
const enTokens = new Set(Object.keys(enToZh));

// 英制单位集合与换算目标；混合公制英制时把英制分量换算过去。
const IMPERIAL = new Set(
  UNITS.filter((entry) => entry.imperial && !entry.en.includes("/")).flatMap((entry) => [
    entry.en,
    ...(entry.aliases ?? []).filter((alias) => !isChinese(alias) && !alias.includes("/")),
  ]),
);
const METRIC_EQUIVALENT: Record<string, string> = {
  inch: "m",
  inches: "m",
  foot: "m",
  feet: "m",
  ft: "m",
  yard: "m",
  yards: "m",
  yd: "m",
  mile: "km",
  miles: "km",
  mi: "km",
  mil: "m",
  link: "m",
  links: "m",
  li: "m",
  rod: "m",
  rods: "m",
  rd: "m",
  chain: "m",
  chains: "m",
  ch: "m",
  angstrom: "nm",
  angstroms: "nm",
  nmi: "km",
  acre: "m2",
  acres: "m2",
  sqin: "m2",
  sqft: "m2",
  sqfeet: "m2",
  sqyard: "m2",
  sqyd: "m2",
  sqmi: "m2",
  sqmile: "m2",
  sqmiles: "m2",
  sqrd: "m2",
  sqch: "m2",
  sqmil: "m2",
  gallon: "l",
  gallons: "l",
  gal: "l",
  quart: "l",
  quarts: "l",
  qt: "l",
  pint: "l",
  pints: "l",
  pt: "l",
  cup: "l",
  cups: "l",
  floz: "l",
  fluidounce: "l",
  fluidounces: "l",
  tablespoon: "l",
  tablespoons: "l",
  tbsp: "l",
  teaspoon: "l",
  teaspoons: "l",
  tsp: "l",
  gill: "l",
  gills: "l",
  gi: "l",
  fluiddram: "l",
  fldr: "l",
  fluiddrams: "l",
  minim: "l",
  minims: "l",
  drop: "l",
  drops: "l",
  gtt: "l",
  gtts: "l",
  beerbarrel: "l",
  beerbarrels: "l",
  bbl: "l",
  oilbarrel: "l",
  oilbarrels: "l",
  obl: "l",
  hogshead: "l",
  hogsheads: "l",
  cuin: "m3",
  cuft: "m3",
  cuyd: "m3",
  pound: "g",
  pounds: "g",
  lb: "g",
  lbs: "g",
  lbm: "g",
  poundmass: "g",
  poundmasses: "g",
  ounce: "g",
  ounces: "g",
  oz: "g",
  grain: "g",
  grains: "g",
  gr: "g",
  dram: "g",
  drams: "g",
  dr: "g",
  stone: "g",
  stones: "g",
  hundredweight: "g",
  hundredweights: "g",
  cwt: "g",
  ton: "g",
  tons: "g",
  lbf: "N",
  poundforce: "N",
  kip: "N",
  kips: "N",
  dyn: "N",
  dyne: "N",
  psi: "Pa",
  atm: "Pa",
  torr: "Pa",
  mmHg: "Pa",
  mmhg: "Pa",
  mmH2O: "Pa",
  mmh2o: "Pa",
  cmH2O: "Pa",
  cmh2o: "Pa",
  hp: "W",
  BTU: "J",
  BTUs: "J",
  btu: "J",
  btus: "J",
  erg: "J",
  eV: "J",
  electronvolt: "J",
  electronvolts: "J",
  degF: "degC",
  fahrenheit: "degC",
  rankine: "K",
  degR: "K",
  // 节与英里/小时一样按分量并入 km/hour，保持速度类呈现一致。
  knot: "km / hour",
};
// 时间/角度/数据/货币不参与合并：出现在算式里不算“公制参与”。
const NEUTRAL = new Set([
  "second",
  "seconds",
  "sec",
  "secs",
  "s",
  "minute",
  "minutes",
  "min",
  "mins",
  "hour",
  "hours",
  "h",
  "hr",
  "hrs",
  "day",
  "days",
  "d",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "decade",
  "decades",
  "century",
  "centuries",
  "millennium",
  "millennia",
  "bit",
  "bits",
  "b",
  "byte",
  "bytes",
  "B",
  "kB",
  "kb",
  "KB",
  "MB",
  "Mb",
  "GB",
  "Gb",
  "TB",
  "Tb",
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "rad",
  "radians",
  "radian",
  "deg",
  "degrees",
  "degree",
  "grad",
  "gradians",
  "gradian",
  "cycle",
  "cycles",
  "arcmin",
  "arcminute",
  "arcminutes",
  "arcsec",
  "arcsecond",
  "arcseconds",
]);

export function unitKind(name: string): "imperial" | "metric" | "neutral" | "none" {
  if (IMPERIAL.has(name)) return "imperial";
  if (NEUTRAL.has(name)) return "neutral";
  return "metric";
}

export type UnitSides = { imperial: boolean; metric: boolean };

// 一个单位值参与运算时带来的“制式”：英制分量与公制分量分开记录。
export function valueSides(value: unknown): UnitSides {
  if (!isUnit(value)) return { imperial: false, metric: false };
  const sides: UnitSides = { imperial: false, metric: false };
  for (const component of value.units) {
    const kind = unitKind(component.unit.name);
    if (kind === "imperial") sides.imperial = true;
    if (kind === "metric") sides.metric = true;
  }
  return sides;
}

// 同量纲分量的幂相消（克/克、米/厘米、kg·m²/cm²）。skipAutomaticSimplification
// 挡住了 mathjs 的约分，这里在分量层面补上：按量纲分桶累加幂，全部抵消时退回纯数字，
// 部分抵消时用代表分量重建目标单位再 to() 换算。没有可抵消分量时原样返回。
export function cancelSameDimension(value: unknown): { value: unknown; cancelled: boolean } {
  if (!isUnit(value)) return { value, cancelled: false };
  const components = value.units;
  if (components.length < 2) return { value, cancelled: false };
  type Bucket = { total: number; count: number; sample: (typeof components)[number] };
  const buckets = new Map<string, Bucket>();
  for (const component of components) {
    const key = JSON.stringify(component.unit.dimensions ?? []);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.total += component.power;
      bucket.count += 1;
      if (Math.abs(component.power) > Math.abs(bucket.sample.power)) bucket.sample = component;
    } else {
      buckets.set(key, { total: component.power, count: 1, sample: component });
    }
  }
  if ([...buckets.values()].every((bucket) => bucket.count === 1))
    return { value, cancelled: false };
  const numerator: string[] = [];
  const denominator: string[] = [];
  let dimensionless = true;
  for (const { total, sample } of buckets.values()) {
    if (total === 0) continue;
    dimensionless = false;
    // mathjs 的类型把 prefix 标成 string，运行时是带 name 的前缀对象。
    const prefixName = (sample.prefix as unknown as { name?: string } | string) ?? "";
    const prefix = typeof prefixName === "string" ? prefixName : (prefixName.name ?? "");
    const name = prefix + sample.unit.name;
    const token = Math.abs(total) === 1 ? name : `${name}^${Math.abs(total)}`;
    (total > 0 ? numerator : denominator).push(token);
  }
  // 全部抵消：value.value 是以 SI 归一的标量，与空单位表的显示值一致。
  if (dimensionless)
    return {
      value: value.value === null || value.value === undefined ? value : value.value,
      cancelled: true,
    };
  const target = denominator.length
    ? `${numerator.join(" * ")} / ${denominator.join(" / ")}`
    : numerator.join(" * ");
  try {
    const converted = value.to(target);
    converted.fixPrefix = false;
    return { value: converted, cancelled: true };
  } catch {
    return { value, cancelled: false };
  }
}

// 把结果里的英制分量换成公制；没有混用或换算失败时原样返回。
export function preferMetric(
  value: unknown,
  used: UnitSides,
): { value: unknown; converted: boolean } {
  if (!isUnit(value)) return { value, converted: false };
  const own = valueSides(value);
  if (!(used.imperial || own.imperial) || !(used.metric || own.metric))
    return { value, converted: false };
  const numerator: string[] = [];
  const denominator: string[] = [];
  let changed = false;
  for (const component of value.units) {
    const replacement = METRIC_EQUIVALENT[component.unit.name];
    // mathjs 的类型把 prefix 标成 string，运行时是带 name 的前缀对象。
    const prefixName = (component.prefix as unknown as { name?: string } | string) ?? "";
    const prefix = typeof prefixName === "string" ? prefixName : (prefixName.name ?? "");
    const name = replacement ?? prefix + component.unit.name;
    if (replacement) changed = true;
    const power = Math.abs(component.power);
    const token = power === 1 ? name : `${name}^${power}`;
    (component.power < 0 ? denominator : numerator).push(token);
  }
  if (!changed || !numerator.length) return { value, converted: false };
  try {
    const target = denominator.length
      ? `${numerator.join(" * ")} / ${denominator.join(" / ")}`
      : numerator.join(" * ");
    const converted = value.to(target);
    converted.fixPrefix = false;
    return { value: converted, converted: true };
  } catch {
    return { value, converted: false };
  }
}

const WORD = /[\p{L}_][\p{L}\p{N}_]*/gu;

function rewriteText(text: string, target: "zh" | "en"): string {
  return text.replace(WORD, (word, offset: number) => {
    const replacement = target === "zh" ? (enToZh[word] ?? word) : (zhToEn[word] ?? word);
    // 英文写法在数字或中文后面补一个空格（4毫升 → 4 ml）；中文写法直接贴合（100L → 100升）。
    if (target === "en" && replacement !== word) {
      const before = offset > 0 ? text[offset - 1] : "";
      if (/[\p{N}\p{Script=Han}]/u.test(before) && before !== " ") return ` ${replacement}`;
    }
    return replacement;
  });
}

// 同一行内是否同时出现中英文单位（自由模式据此把整行统一成中文）。
export function mixesUnitLanguages(line: string): boolean {
  let zh = false;
  let en = false;
  for (const match of line.matchAll(WORD)) {
    if (zhTokens.has(match[0])) zh = true;
    else if (enTokens.has(match[0])) en = true;
  }
  return zh && en;
}

// 光标离开一行时调用：按模式改写该行算式里的单位，无需改写时返回 null。
export function rewriteLineUnits(line: string, mode: UnitMode): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;
  const target = mode === "chinese" ? "zh" : mode === "english" ? "en" : null;
  if (target) return applyRewrite(line, target);
  return mixesUnitLanguages(line) ? applyRewrite(line, "zh") : null;
}

function applyRewrite(line: string, target: "zh" | "en"): string | null {
  const comment = line.indexOf("//");
  const body = comment === -1 ? line : line.slice(0, comment);
  const tail = comment === -1 ? "" : line.slice(comment);
  // 「说明: 算式」只改写冒号后的算式；冒号前是纯数字时是比率（16:9），整行都算算式。
  const label = body.search(/[:：]/);
  const hasLabel =
    label >= 0 && !/^-?\d+(?:\.\d+)?$/.test(body.slice(0, label).trim()) ? label : -1;
  const head = hasLabel === -1 ? "" : body.slice(0, hasLabel + 1);
  const expression = hasLabel === -1 ? body : body.slice(hasLabel + 1);
  const rewritten = head + rewriteText(expression, target) + tail;
  return rewritten === line ? null : rewritten;
}
