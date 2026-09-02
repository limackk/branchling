#!/usr/bin/env node
/**
 * Who is doing this? — the actor chain, in ONE place (TL-157).
 *
 * WHY A MODULE FOR FOUR LINES. Before this file the chain was written out ten
 * times, and it already DISAGREED with itself: eight call sites ended in
 * `agent:claude`, `seed` and `import` ended in `unknown`, and `migrate-prefix`
 * had no ending at all. Nobody noticed, because nothing compared the ten. A
 * duplicated rule is not merely repetition — it is a set of rules that will
 * drift, and this one had already drifted before anybody went looking.
 *
 * TL-34 added the user layer (`<config>/config.yaml`, `actor:` its headline
 * key) and deliberately did NOT wire it in, because threading a fourth source
 * through ten copies is how the eleventh copy gets written. This module is that
 * wiring, and it is a refactor before it is a feature.
 *
 * THE ORDER, from the most explicit to the most implicit:
 *
 *   1. `--actor`          this invocation, said out loud
 *   2. `$BACKLOG_ACTOR`   this shell, this session
 *   3. the user layer     this person, stated once and kept
 *   4. the default        nobody said
 *
 * THE DEFAULT IS `agent:claude`, AND THE TWO CALL SITES THAT SAID `unknown` ARE
 * ALIGNED ONTO IT. That was the one open decision in TL-157, so here is the
 * reasoning rather than the outcome alone. `unknown` is not a spare word: it is
 * the sentinel for a change the tool OBSERVED rather than made — `reconcile()`
 * writes it, and `isUnattributed()` treats `unknown` with no stated reason as a
 * row still waiting for a person to claim. A `seed` or an `import` run is not an
 * observation; it is an act, performed by whoever typed the command, and
 * recording it as `unknown` filed a deliberate act into the queue of things
 * nobody witnessed. The `agent:` namespace already carries the right amount of
 * doubt — it means automated and unverified, which is exactly what an unstated
 * actor is. And the honesty argument for `unknown` was answered by TL-34: a
 * person who is not an agent now states it ONCE, in their own config file,
 * instead of on every command.
 *
 * Already-seeded rows keep the `unknown` they were written with. The log is
 * append-only; a value in it is what was true when it was written, not a field
 * a later pass may correct.
 *
 * READING THE LAYER MUST NEVER FAIL A CALLER. `regen-hook` and `migrate-prefix`
 * resolve an actor where no backlog configuration can be loaded, so this module
 * reads `loadUserConfig()` directly rather than reaching for `loadConfig()`, and
 * wraps it: an unreadable or absent preferences file yields no actor, never an
 * exception. A hook that fails because somebody's home directory is odd would be
 * this tool breaking an edit it was only supposed to notice.
 *
 * Tests: `node --test scripts/tests/home.test.mjs`
 */

import { loadUserConfig } from "./home.mjs";

/**
 * The environment variable, spelled once.
 *
 * `BACKLOG_` and not the product's name, like `BACKLOG_DIR` and
 * `BACKLOG_STATE_DIR`: a variable set in somebody's shell profile is a key in a
 * file this tool does not own, so a rename must not reach it. (product-name: allow)
 */
export const ACTOR_ENV = "BACKLOG_ACTOR";

/** The fourth source. See the header for why it is this value and not `unknown`. */
export const DEFAULT_ACTOR = "agent:claude";

/**
 * The `actor:` preference, or an empty string. Never throws.
 *
 * A file with problems elsewhere is not a reason to discard a line that parsed:
 * `parseUserConfig` already refuses an actor without a namespace by leaving the
 * key unset, so what arrives here is either valid or absent. Reporting the
 * file's other problems belongs to the command that shows the configuration,
 * not to a resolution running inside a post-edit hook.
 */
export function userActor(env = process.env) {
  try {
    return String(loadUserConfig(env).values.actor || "").trim();
  } catch {
    return "";
  }
}

/**
 * The actor for this invocation.
 *
 * @param {string} flag  the value of `--actor`, or anything falsy
 * @param {{env?: object, fallback?: string}} opts
 *        `env` is injected so a test never reads a real environment; `fallback`
 *        is for a caller that wants the chain WITHOUT a default — pass `""` and
 *        an unstated actor comes back unstated.
 */
export function resolveActor(flag, opts = {}) {
  const env = opts.env || process.env;
  const stated = typeof flag === "string" ? flag.trim() : "";
  if (stated) return stated;

  const fromEnv = String(env[ACTOR_ENV] || "").trim();
  if (fromEnv) return fromEnv;

  const fromUser = userActor(env);
  if (fromUser) return fromUser;

  return opts.fallback === undefined ? DEFAULT_ACTOR : opts.fallback;
}
