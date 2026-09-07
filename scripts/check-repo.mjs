import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures = [];
const fail = (file, message) => failures.push(`${relative(root, file)}: ${message}`);
const collect = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = resolve(directory, item.name);
    return item.isDirectory() ? collect(path) : [path];
  });
const required = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "docs/index.md",
  "docs/QUALITY_SCORE.md",
  "docs/harness.md",
  "docs/product-specs/mvp.md",
  "docs/product-specs/calculation-language.md",
  "docs/exec-plans/README.md",
  ".github/workflows/ci.yml",
];
for (const path of required)
  if (!existsSync(resolve(root, path)))
    fail(
      resolve(root, path),
      "Missing required entry point. Restore the file or update the repository contract.",
    );
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const documents = ["AGENTS.md", "README.md", "ARCHITECTURE.md"]
  .map((file) => resolve(root, file))
  .concat(collect(resolve(root, "docs")).filter((file) => extname(file) === ".md"));
const links = new Map();
for (const file of documents) {
  const text = readFileSync(file, "utf8");
  const destinations = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split(/[?#]/)[0];
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    const destination = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(destination))
      fail(file, `Broken local link: ${target}. Correct the link or restore its target.`);
    destinations.push(destination);
  }
  links.set(file, destinations);
  if (file.includes(`${root}/docs/`) || file.endsWith("/ARCHITECTURE.md")) {
    const metadata = text.match(/状态：[^\n]+负责人：[^\n]+核验日期：(\d{4}-\d{2}-\d{2})/);
    if (!metadata || !Number.isFinite(Date.parse(metadata[1])))
      fail(file, "Add status, owner and a valid verification date near the top.");
    else if (Date.now() - Date.parse(metadata[1]) > 90 * 86_400_000)
      console.warn(
        `Review stale document: ${relative(root, file)} (verify its claims before changing the date).`,
      );
  }
}
const reachable = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const target of links.get(file) ?? []) visit(target);
}
visit(resolve(root, "docs/index.md"));
for (const file of documents)
  if (!reachable.has(file))
    fail(file, "Document is unreachable from docs/index.md. Add a meaningful navigation link.");
if (readFileSync("AGENTS.md", "utf8").split("\n").length > 120)
  fail(
    resolve(root, "AGENTS.md"),
    "AGENTS must remain a map (at most 120 lines). Move detail into a linked document.",
  );

const sources = collect(resolve(root, "src")).filter((file) => /\.[cm]?tsx?$/.test(file));
const packageInfo = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoVersion = readFileSync("src-tauri/Cargo.toml", "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
if (packageInfo.version !== tauriConfig.version || packageInfo.version !== cargoVersion)
  fail(
    resolve(root, "package.json"),
    "Keep package.json, tauri.conf.json and Cargo.toml versions identical so About matches the native app.",
  );
if (
  !readFileSync("src-tauri/src/lib.rs", "utf8").includes(JSON.stringify(packageInfo.repository.url))
)
  fail(
    resolve(root, "src-tauri/src/lib.rs"),
    "The native project link must match package.json repository.url used in About.",
  );
for (const file of sources) {
  const path = relative(root, file);
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function checkImport(specifier) {
    const target = specifier.startsWith(".")
      ? relative(root, resolve(dirname(file), specifier))
      : specifier;
    if (
      path.startsWith("src/domain/") &&
      !(target.startsWith("src/domain/") || target === "mathjs")
    ) {
      fail(
        file,
        `Domain import '${specifier}' crosses the pure calculation boundary. Move I/O/UI orchestration out of domain.`,
      );
    }
    if (
      path.startsWith("src/ui/") &&
      (target.startsWith("src/platform/") || target.startsWith("@tauri-apps/"))
    ) {
      fail(
        file,
        `UI import '${specifier}' bypasses app orchestration. Pass data/callbacks from App instead.`,
      );
    }
    if (path.startsWith("src/platform/") && (target === "react" || target.startsWith("src/ui/"))) {
      fail(
        file,
        `Platform import '${specifier}' depends on UI. Keep platform code independent of components.`,
      );
    }
  }
  const walk = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkImport(node.arguments[0].text);
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      ["eval", "Function"].includes(node.expression.text)
    )
      fail(file, "Do not execute user text as JavaScript. Use the shared restricted math engine.");
    if (
      ts.isIdentifier(node) &&
      ["localStorage", "sessionStorage"].includes(node.text) &&
      !path.startsWith("src/platform/")
    )
      fail(
        file,
        "Storage API outside platform. Route reads/writes through src/platform/storage.ts.",
      );
    if (
      path.startsWith("src/domain/") &&
      ts.isIdentifier(node) &&
      ["window", "document", "navigator", "fetch"].includes(node.text)
    )
      fail(file, "Domain code must run without browser globals. Pass data in, return data out.");
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "dangerouslySetInnerHTML")
      fail(file, "Render user text as text, never as HTML.");
    ts.forEachChild(node, walk);
  };
  walk(tree);
}
if (failures.length) {
  console.error(failures.map((failure) => `ERROR ${failure}`).join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Repository checks passed: ${documents.length} linked documents, ${sources.length} source modules, architecture and execution boundaries.`,
  );
