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
import { closeSync, existsSync, openSync, readSync } from "node:fs";
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
 * Windows at all. So the shebang is read HERE: `#!/usr/bin/env <program>`
 * starts that program from PATH with the file as its argument, and any other
 * interpreter line (`#!/bin/sh`, `#!/bin/bash`) goes to Git's bash. Handing
 * every script to bash was measured not to work: bash given a FILE runs it as
 * bash and ignores the shebang, so an adapter written in JavaScript died on
 * its first `import`. One adapter file serves both platforms.
 *
 * @returns {{file: string, args: string[], shell: boolean}}
 */
export function executableInvocation(path) {
  if (process.platform !== "win32") return { file: path, args: [], shell: false };
  if (/\.(exe|com)$/i.test(path)) return { file: path, args: [], shell: false };
  if (/\.(cmd|bat)$/i.test(path)) return { file: '"' + path + '"', args: [], shell: true };
  const line = shebangOf(path);
  const env = line && line.match(/^\S*[\\/]env\s+(.+)$/);
  if (env) {
    const command = env[1].trim().split(/\s+/).filter((word) => word !== "-S");
    return { file: command[0], args: command.slice(1).concat([path]), shell: false };
  }
  return { file: posixShell(), args: [String(path).replace(/\\/g, "/")], shell: false };
}

/** The interpreter line of a script, without `#!`, or null. Reads one block. */
function shebangOf(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(512);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, read).toString("utf8").split(/\r?\n/)[0];
    return head.startsWith("#!") ? head.slice(2).trim() : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
