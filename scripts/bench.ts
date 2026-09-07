import { performance } from "node:perf_hooks";
import { evaluateNotebook } from "../src/domain/calculation.ts";

const source = Array.from(
  { length: 300 },
  (_, index) => `item_${index} = ${index + 1} * 1.25 + 10%`,
).join("\n");
evaluateNotebook(source);
const durations = Array.from({ length: 20 }, () => {
  const start = performance.now();
  const lines = evaluateNotebook(source);
  if (lines.some((line) => line.kind === "error")) throw new Error("Benchmark fixture failed");
  return performance.now() - start;
}).sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      fixture: "300 variable lines",
      runs: durations.length,
      medianMs: +durations[10].toFixed(2),
      p95Ms: +durations[18].toFixed(2),
      budgetMs: 250,
    },
    null,
    2,
  ),
);
if (durations[18] > 250) process.exitCode = 1;
