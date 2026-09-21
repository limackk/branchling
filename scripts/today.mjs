/**
 * The day, in the one shape every date field in a task file is written in.
 *
 * WHY THIS FILE EXISTS (TL-246). The same three lines lived in three commands
 * and gave TWO answers: `take` and `done` computed the UTC day, `new` computed
 * the LOCAL one. In a timezone ahead of UTC, in the hours before midnight,
 * `new` wrote tomorrow's `created:` while `done` wrote today's `updated:`;
 * nothing failed and no guard noticed, because a date that is one day out is
 * still a date. The two that agreed agreed by coincidence rather than by
 * reuse, which is the same defect with a luckier outcome.
 *
 * WHY UTC AND NOT THE LOCAL DAY. The date travels: it is written into a file,
 * committed, and read on machines whose clocks are set to other zones. A local
 * day answers "which day was it where the writer stood", and that question has
 * no single answer once the file has been pushed — two sessions closing tasks
 * one minute apart in Auckland and Los Angeles would stamp dates two days
 * apart and neither would be wrong. UTC answers "which day was it", full stop,
 * so the field can be compared, sorted and summed across a fleet. The cost is
 * real and is accepted: a person working late in a zone ahead of UTC sees
 * tomorrow's date on a task they created tonight. That is a display concern —
 * a reader's own day can be rendered from an unambiguous stamp, while an
 * unambiguous stamp cannot be recovered from a local one, because the zone it
 * was written in is not recorded anywhere.
 *
 * WHY IT IS NOT IN THE COMMAND THAT FIRST HAD IT. This module imports nothing.
 * `take-task.mjs`, where the exported copy used to live, drags a lock, a
 * history writer and a config loader in behind it — a cost `new` has no reason
 * to pay for one date, and the reason a command writes its own copy instead.
 */

/** Today as a task file writes it: `YYYY-MM-DD`, in UTC. `now` is a timestamp
 *  or a date, so callers that already have the instant of THIS change pass it
 *  instead of asking the clock a second time. */
export function todayStamp(now) {
  return new Date(now || Date.now()).toISOString().slice(0, 10);
}
