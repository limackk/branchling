/**
 * An adapter's environment carries what a process needs to start on its
 * platform, and still nothing else (TL-463).
 *
 * The platform is injected because the Windows branch is otherwise unreachable
 * from a POSIX suite, and an unreachable rule is one nobody has checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { processEssentials } from "../process-env.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("process-env");

const AMBIENT = {
  Path: "C:\\Windows;C:\\node", SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe",
  PATHEXT: ".COM;.EXE;.CMD", TEMP: "C:\\t", TMP: "C:\\t", windir: "C:\\Windows",
  SECRET_TOKEN: "do-not-pass", HOME: "/home/x",
};

test("on Windows the start-up variables pass, whatever case the copy kept", () => {
  const out = processEssentials(AMBIENT, "win32");
  assert.equal(out.PATH, "C:\\Windows;C:\\node", "a copied `Path` was not found as PATH");
  assert.equal(out.SystemRoot, "C:\\Windows", "Node cannot start on Windows without SystemRoot");
  assert.equal(out.ComSpec, AMBIENT.ComSpec);
  assert.equal(out.PATHEXT, AMBIENT.PATHEXT);
});

test("nothing else passes, on either platform", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    const out = processEssentials({ ...AMBIENT, PATH: "/usr/bin" }, platform);
    assert.equal(out.SECRET_TOKEN, undefined, platform + ": an ambient secret reached the adapter");
    assert.equal(out.HOME, undefined, platform + ": an ambient variable reached the adapter");
  }
  assert.deepEqual(processEssentials({ PATH: "/usr/bin", SystemRoot: "x" }, "linux"), { PATH: "/usr/bin" },
    "POSIX keeps exactly the PATH it always passed");
});
