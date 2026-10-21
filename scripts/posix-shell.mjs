/**
 * The shell a stored command line is written for, on every platform (TL-463).
 *
 * A contract entry is keyed `bash:`, an `--agent` is a command line, and both
 * are written once and run on whatever machine closes the task. With
 * `shell: true` Node picks the PLATFORM's shell, so on Windows the same line
 * reached `cmd.exe`: `cat >/dev/null`, `$VAR` and `&&` chains meant something
 * else there or nothing at all, and a contract green on one machine was red on
 * another for a reason that had nothing to do with the work.
 *
 * On POSIX this stays `shell: true` — `/bin/sh`, exactly what every existing
 * contract has been run with. On Windows it is the bash that ships with Git for
 * Windows, found through `git --exec-path` rather than PATH: on a stock Windows
 * machine the first `bash.exe` on PATH can be the WSL launcher in System32,
 * which runs the line inside a different operating system with different
 * paths. Git is already a hard requirement of this tool, so its bash is the one
 * POSIX shell a Windows user of it is guaranteed to have.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

let cached;

/** The `shell` option for spawning a stored command line. */
export function posixShell() {
  if (process.platform !== "win32") return true;
  if (cached !== undefined) return cached;
  cached = "bash";
  const r = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  const execPath = r.status === 0 ? String(r.stdout || "").trim() : "";
  if (execPath) {
    // <git>/mingw64/libexec/git-core → <git>/bin/bash.exe
    const candidate = join(resolve(execPath, "..", "..", ".."), "bin", "bash.exe");
    if (existsSync(candidate)) cached = candidate;
  }
  return cached;
}

/**
 * How to start an adapter EXECUTABLE — a file, not a command line.
 *
 * On POSIX the kernel reads the shebang, so the file is started as it is. On
 * Windows only `.exe` and `.com` start that way: a `.cmd` or `.bat` needs
 * `cmd.exe` (Node refuses one without a shell, CVE-2024-27980), and a script
 * with a shebang — the form every adapter example takes — means nothing to
 * Windows at all. Git's bash honours a shebang, so the same adapter file works
 * on both platforms rather than needing a second, Windows-only copy.
 *
 * @returns {{file: string, args: string[], shell: boolean}}
 */
export function executableInvocation(path) {
  if (process.platform !== "win32") return { file: path, args: [], shell: false };
  if (/\.(exe|com)$/i.test(path)) return { file: path, args: [], shell: false };
  if (/\.(cmd|bat)$/i.test(path)) return { file: '"' + path + '"', args: [], shell: true };
  return { file: posixShell(), args: [String(path).replace(/\\/g, "/")], shell: false };
}
