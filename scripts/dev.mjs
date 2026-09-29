import { execSync, spawn } from "node:child_process";

const port = Number(process.env.CALCBOOK_PORT ?? 1420);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("CALCBOOK_PORT must be an integer from 1024 to 65535");

// 端口被占用时先结束监听进程（不区分占用者），否则 strictPort 会让 vite 直接失败。
function listeningPids(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      return [
        ...new Set(
          output
            .split("\n")
            .filter((line) => line.includes(`:${port} `) && line.includes("LISTENING"))
            .map((line) => line.trim().split(/\s+/).pop())
            .filter((pid) => /^\d+$/.test(pid)),
        ),
      ];
    }
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" });
    return output
      .split("\n")
      .map((pid) => Number.parseInt(pid, 10))
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

for (const pid of listeningPids(port)) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`[dev] 端口 ${port} 被进程 ${pid} 占用，已结束该进程。`);
  } catch {
    // 进程恰好在检查之后自行退出时无需处理
  }
}

const viteHandle = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CALCBOOK_PORT: String(port),
  },
});
viteHandle.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
