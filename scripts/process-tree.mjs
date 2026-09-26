import { spawnSync } from "node:child_process";

/**
 * A child that leads a POSIX process group can be stopped together with every
 * descendant. Windows has no negative-pid process groups, so its native tree
 * operation is used at stop time instead.
 */
export function processTreeDetached(platform = process.platform) {
  return platform !== "win32";
}

/** Stop a child and every descendant it started. */
export function stopProcessTree(child, signal = "SIGTERM", options = {}) {
  if (!child || !child.pid) return;
  const platform = options.platform || process.platform;
  const run = options.spawnSync || spawnSync;
  const kill = options.kill || process.kill;

  if (platform === "win32") {
    // `/T` includes descendants. `/F` is the Windows equivalent of the forced
    // follow-up used after a graceful stop did not empty the tree.
    const args = ["/pid", String(child.pid), "/t"];
    if (signal === "SIGKILL") args.push("/f");
    const stopped = run("taskkill", args, { stdio: "ignore" });
    if (stopped.status !== 0) {
      try { child.kill(signal); } catch { /* it exited between the two calls */ }
    }
    return;
  }

  try {
    kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* the group already exited */ }
  }
}
