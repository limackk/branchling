/**
 * The variables a child process needs merely to START, and nothing else
 * (TL-463).
 *
 * Adapters and probes get a deliberately empty environment: PATH, the
 * contract's own variables, and the credentials a profile names. On POSIX that
 * is enough. On Windows it is not — Node aborts during start-up without
 * `SystemRoot` (its random-number source lives under it), `cmd.exe` needs
 * `ComSpec`, and command lookup needs `PATHEXT`. An adapter that cannot start
 * is reported as one that answered badly, which is the wrong defect to send a
 * person to fix. None of these is application data or a credential, so handing
 * them on keeps the rule that everything else is withheld.
 *
 * Windows variable names are case-insensitive, and a COPY of `process.env`
 * (`{ ...process.env }`) keeps whatever case the system used — `Path`, not
 * `PATH` — so the lookup does not trust the spelling.
 */
const WINDOWS_ESSENTIALS = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP"];

function lookup(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

export function processEssentials(env = process.env, platform = process.platform) {
  const out = {};
  const path = platform === "win32" ? lookup(env, "PATH") : env.PATH;
  if (path) out.PATH = path;
  if (platform === "win32") {
    for (const name of WINDOWS_ESSENTIALS) {
      const value = lookup(env, name);
      if (value) out[name] = value;
    }
  }
  return out;
}
