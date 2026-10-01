import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMatcher,
  DEFAULT_SEARCH_OPTIONS,
  findMatches,
  matchIndexAtOrAfter,
  replaceAllText,
  stepMatchIndex,
} from "../src/domain/search.ts";

const options = (patch: Partial<typeof DEFAULT_SEARCH_OPTIONS> = {}) => ({
  ...DEFAULT_SEARCH_OPTIONS,
  ...patch,
});

const findAll = (body: string, query: string, opts = options()) => {
  const matcher = buildMatcher(query, opts);
  assert.equal(matcher.error, null);
  assert.ok(matcher.pattern);
  return findMatches(body, matcher.pattern);
};

test("literal search is case-insensitive by default", () => {
  assert.deepEqual(findAll("Price PRICE price", "price"), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ]);
});

test("case-sensitive switch narrows matches", () => {
  assert.deepEqual(findAll("Price PRICE price", "price", options({ caseSensitive: true })), [
    { start: 12, end: 17 },
  ]);
});

test("whole word switch adds \\b boundaries", () => {
  const body = "cat concatenate cat";
  assert.deepEqual(findAll(body, "cat", options({ wholeWord: true })), [
    { start: 0, end: 3 },
    { start: 16, end: 19 },
  ]);
  // 不开全词时三处都中
  assert.equal(findAll(body, "cat").length, 3);
});

test("whole word does not match pure CJK words (same as VS Code \\b)", () => {
  // \b 只认 ASCII 词字符；中文两侧无词边界，纯中文词全词匹配不到——已知行为，UI 文档注明
  assert.equal(findAll("中文 高中文", "中文", options({ wholeWord: true })).length, 0);
  assert.equal(findAll("中文 高中文", "中文").length, 2);
});

test("regex mode supports character classes and quantifiers", () => {
  assert.deepEqual(findAll("a1 b22 c333", "[a-z]\\d+", options({ regex: true })), [
    { start: 0, end: 2 },
    { start: 3, end: 6 },
    { start: 7, end: 11 },
  ]);
});

test("switches combine: regex + whole word + case", () => {
  const body = "Foo1 foo1 foo12 FOO1";
  const matches = findAll(body, "foo\\d", options({ regex: true, wholeWord: true }));
  // foo12 中 "foo1" 后随词字符 2 无边界，不中；FOO1 大小写不敏感时命中
  assert.deepEqual(matches, [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
    { start: 16, end: 20 },
  ]);
  assert.deepEqual(
    findAll(body, "foo\\d", options({ regex: true, wholeWord: true, caseSensitive: true })),
    [{ start: 5, end: 9 }],
  );
});

test("invalid regex returns a readable error, not a throw", () => {
  const matcher = buildMatcher("(abc", options({ regex: true }));
  assert.equal(matcher.pattern, null);
  assert.match(matcher.error ?? "", /^正则表达式无效：/);
});

test("empty query yields no pattern and no error", () => {
  const matcher = buildMatcher("", options({ regex: true }));
  assert.deepEqual(matcher, { pattern: null, error: null });
});

test("empty-match patterns advance instead of looping forever", () => {
  const matcher = buildMatcher("a*", options({ regex: true }));
  assert.ok(matcher.pattern);
  const matches = findMatches("baa", matcher.pattern);
  // 0 处空匹配后前进，随后命中 "aa"；文末还有一处空匹配（与 VS Code 一致）
  assert.deepEqual(matches, [
    { start: 0, end: 0 },
    { start: 1, end: 3 },
    { start: 3, end: 3 },
  ]);
});

test("multiline bodies match across line offsets", () => {
  const body = "第一行 total\n第二行 total";
  assert.deepEqual(findAll(body, "total"), [
    { start: 4, end: 9 },
    { start: 14, end: 19 },
  ]);
});

test("matchIndexAtOrAfter picks first match at or after offset, wraps to 0", () => {
  const matches = [
    { start: 2, end: 4 },
    { start: 8, end: 10 },
  ];
  assert.equal(matchIndexAtOrAfter(matches, 0), 0);
  assert.equal(matchIndexAtOrAfter(matches, 2), 0);
  assert.equal(matchIndexAtOrAfter(matches, 5), 1);
  assert.equal(matchIndexAtOrAfter(matches, 9), 0);
  assert.equal(matchIndexAtOrAfter([], 0), -1);
});

test("stepMatchIndex cycles with wraparound in both directions", () => {
  assert.equal(stepMatchIndex(0, 1, 3), 1);
  assert.equal(stepMatchIndex(2, 1, 3), 0);
  assert.equal(stepMatchIndex(0, -1, 3), 2);
  assert.equal(stepMatchIndex(-1, 1, 3), 0);
  assert.equal(stepMatchIndex(-1, -1, 3), 2);
  assert.equal(stepMatchIndex(0, 1, 0), -1);
});

test("replaceAllText literal mode inserts replacement verbatim, including $", () => {
  const { pattern } = buildMatcher("price", options());
  assert.ok(pattern);
  const result = replaceAllText("price and Price", pattern, "$100", true);
  assert.deepEqual(result, { text: "$100 and $100", count: 2 });
});

test("replaceAllText regex mode resolves $& and capture groups", () => {
  const { pattern } = buildMatcher("(\\d+)元", options({ regex: true }));
  assert.ok(pattern);
  const result = replaceAllText("花3元 又花15元", pattern, "[$&=$1块]", false);
  assert.deepEqual(result, { text: "花[3元=3块] 又花[15元=15块]", count: 2 });
});

test("replaceAllText on no match returns body unchanged with count 0", () => {
  const { pattern } = buildMatcher("xyz", options());
  assert.ok(pattern);
  const result = replaceAllText("什么都没有", pattern, "替换", true);
  assert.deepEqual(result, { text: "什么都没有", count: 0 });
});

test("replacement survives emoji and CJK around matches", () => {
  const { pattern } = buildMatcher("total", options());
  assert.ok(pattern);
  const result = replaceAllText("📦 total 合计 total 🎉", pattern, "总计", true);
  assert.deepEqual(result, { text: "📦 总计 合计 总计 🎉", count: 2 });
});
