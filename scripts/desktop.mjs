import { spawn } from "node:child_process";

const port = Number(process.env.CALCBOOK_PORT ?? 1420);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("CALCBOOK_PORT must be an integer from 1024 to 65535");
const processHandle = spawn(
  "pnpm",
  [
    "exec",
    "tauri",
    "dev",
    "--config",
    JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } }),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CALCBOOK_PORT: String(port),
    },
  },
);
processHandle.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
