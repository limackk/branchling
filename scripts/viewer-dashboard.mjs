/**
 * Dashboard calculations and dependency-free markup.
 *
 * This module is pasted into the viewer and imported by node:test. It knows no
 * project vocabulary: every status and priority decision arrives in `options`.
 */

const DAY_MS = 86400000;

function dashboardEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dashboardTime(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? null : time;
}

function historyTimes(history, task, archived) {
  const entries = Array.isArray(history && history[task.id]) ? history[task.id] : [];
  const createdEntry = entries.find((entry) => entry && entry.field === "__created__" && dashboardTime(entry.ts) !== null);
  const created = createdEntry ? dashboardTime(createdEntry.ts) : dashboardTime(task.created);
  const closedEntries = entries
    .filter((entry) => entry && entry.field === "status" && archived.has(entry.to) && dashboardTime(entry.ts) !== null)
    .map((entry) => dashboardTime(entry.ts))
    .sort((a, b) => a - b);
  return { created, closed: closedEntries[0] ?? null, historyCreated: Boolean(createdEntry) };
}

function median(values) {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function dashboardTaskLink(ids, label, className = "dash-link") {
  if (!ids.length) return '<span class="' + className + ' is-empty">' + dashboardEscape(label) + "</span>";
  return '<button type="button" class="' + className + '" data-dashboard-tasks="' +
    dashboardEscape(ids.join(",")) + '">' + dashboardEscape(label) + "</button>";
}

/** Pure view model derived from the task files, history and execution plan. */
export function dashboardModel(tasks, history, planStateValue, options = {}) {
  const archived = new Set(options.archivedStatuses || []);
  const priorities = options.priorities || [];
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const from = Number.isFinite(options.from) ? options.from : now - (30 * DAY_MS);
  const to = Number.isFinite(options.to) ? options.to : now;
  const open = tasks.filter((task) => !archived.has(task.status));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const unresolved = (task) => (task.blocked_by || []).some((id) => {
    const blocker = byId.get(id);
    return !blocker || !archived.has(blocker.status);
  });
  const waiting = open.filter((task) => task.executor === "human" ||
    (options.awaitingVouchStatus && task.status === options.awaitingVouchStatus));
  const urgentValues = new Set(priorities.slice(0, Math.min(2, priorities.length)));
  const planned = new Set((planStateValue && planStateValue.waves || []).flatMap((wave) =>
    (wave.tasks || []).map((task) => typeof task === "string" ? task : task.id)));

  const timed = tasks.map((task) => ({ task, ...historyTimes(history, task, archived) }));
  const created = timed.filter((item) => item.created !== null && item.created >= from && item.created <= to);
  const closed = timed.filter((item) => item.closed !== null && item.closed >= from && item.closed <= to);
  const leadTimes = closed
    .filter((item) => item.created !== null && item.closed >= item.created)
    .map((item) => item.closed - item.created);
  const leadMedian = median(leadTimes);
  const incompleteCreated = timed.filter((item) => item.created === null).length;

  const movements = new Map();
  for (const item of created) {
    const key = dayKey(item.created);
    const row = movements.get(key) || { day: key, created: [], closed: [] };
    row.created.push(item.task.id); movements.set(key, row);
  }
  for (const item of closed) {
    const key = dayKey(item.closed);
    const row = movements.get(key) || { day: key, created: [], closed: [] };
    row.closed.push(item.task.id); movements.set(key, row);
  }
  const days = [...movements.values()].sort((a, b) => a.day.localeCompare(b.day));

  let cumulative = tasks.filter((task) => !archived.has(task.status)).length;
  const cumulativePoints = [];
  for (const row of days.slice().reverse()) {
    cumulativePoints.push({ day: row.day, value: cumulative, ids: [...row.created, ...row.closed] });
    cumulative -= row.created.length - row.closed.length;
  }
  cumulativePoints.reverse();

  const waves = (planStateValue && planStateValue.waves || []).map((wave, index) => {
    const ids = (wave.tasks || []).map((task) => typeof task === "string" ? task : task.id);
    const done = ids.filter((id) => archived.has((byId.get(id) || {}).status)).length;
    return { index, name: wave.name || "Wave " + (index + 1), ids, done, total: ids.length };
  });
  const epics = new Map();
  for (const task of tasks) {
    const name = task.epic || "No epic";
    const row = epics.get(name) || { name, ids: [], open: 0, blocked: 0 };
    row.ids.push(task.id);
    if (!archived.has(task.status)) row.open += 1;
    if (!archived.has(task.status) && unresolved(task)) row.blocked += 1;
    epics.set(name, row);
  }

  return {
    range: { from, to },
    current: {
      open,
      inProgress: open.filter((task) => task.status === options.inProgressStatus),
      blocked: open.filter(unresolved),
      waiting,
      urgent: open.filter((task) => urgentValues.has(task.priority)),
      unscheduled: planStateValue ? open.filter((task) => !planned.has(task.id)) : null,
    },
    flow: {
      created, closed, net: created.length - closed.length,
      throughput: closed.length,
      leadMedian,
      leadSamples: leadTimes.length,
      incompleteCreated,
      days,
      cumulative: cumulativePoints,
    },
    waves,
    epics: [...epics.values()].sort((a, b) => b.blocked - a.blocked || b.open - a.open || a.name.localeCompare(b.name)),
  };
}

function durationDays(ms) {
  if (ms === null) return "Unknown";
  const days = ms / DAY_MS;
  return (days < 1 ? "<1" : (Math.round(days * 10) / 10)) + " days";
}

/** Markup carries task ids; the page turns each control into shared URL state. */
export function renderDashboard(model) {
  const cards = [
    ["Open now", model.current.open],
    ["In progress", model.current.inProgress],
    ["Blocked", model.current.blocked],
    ["Waiting on a person", model.current.waiting],
    ["Urgent", model.current.urgent],
    ["Unscheduled", model.current.unscheduled],
  ].map(([label, rows]) => {
    const value = rows === null ? "Unknown" : String(rows.length);
    const ids = rows === null ? [] : rows.map((task) => task.id);
    return '<article class="dash-kpi"><span>' + dashboardEscape(label) + "</span><strong>" + value +
      "</strong>" + (rows === null ? '<small>Add a valid plan to measure this.</small>' : dashboardTaskLink(ids, "Open tasks")) + "</article>";
  }).join("");
  const flowCards = [
    ["Created", model.flow.created.length, model.flow.created.map((item) => item.task.id)],
    ["Closed / throughput", model.flow.throughput, model.flow.closed.map((item) => item.task.id)],
    ["Net backlog movement", (model.flow.net > 0 ? "+" : "") + model.flow.net, [...model.flow.created, ...model.flow.closed].map((item) => item.task.id)],
    ["Median lead time", durationDays(model.flow.leadMedian), model.flow.closed.map((item) => item.task.id)],
  ].map(([label, value, ids]) => '<article class="dash-flow-card"><span>' + dashboardEscape(label) +
    "</span><strong>" + dashboardEscape(value) + "</strong>" + dashboardTaskLink(ids, "Inspect sample") + "</article>").join("");
  const maxMove = Math.max(1, ...model.flow.days.map((row) => row.created.length + row.closed.length));
  const movement = model.flow.days.length ? model.flow.days.map((row) => {
    const height = Math.max(8, Math.round(((row.created.length + row.closed.length) / maxMove) * 100));
    return dashboardTaskLink([...row.created, ...row.closed], row.day + ": +" + row.created.length + " / −" + row.closed.length,
      "dash-day") .replace('class="dash-day"', 'class="dash-day" style="--day-height:' + height + '%"');
  }).join("") : '<p class="dash-empty">No recorded movement in this range.</p>';
  const waves = model.waves.length ? model.waves.map((wave) => dashboardTaskLink(wave.ids,
    wave.name + ": " + wave.done + "/" + wave.total + " closed", "dash-progress")).join("") :
    '<p class="dash-empty">No readable execution plan; wave progress is unknown.</p>';
  const epics = model.epics.map((epic) => dashboardTaskLink(epic.ids,
    epic.name + ": " + epic.open + " open, " + epic.blocked + " blocked", "dash-epic")).join("");
  const quality = model.flow.incompleteCreated || model.flow.leadSamples === 0
    ? '<p class="dash-quality">Lead time is ' + (model.flow.leadSamples ? "based on " + model.flow.leadSamples + " closure(s)" : "unknown: no complete creation-to-closure samples") +
      ". " + model.flow.incompleteCreated + " task(s) have no readable creation date.</p>" : "";
  return '<div class="dash-head"><div><h2>Backlog health</h2><p>Current state and historical flow are separate. Metrics describe tasks, never people.</p></div></div>' +
    '<section aria-labelledby="dashCurrent"><h3 id="dashCurrent">Current state</h3><div class="dash-kpis">' + cards + "</div></section>" +
    '<section aria-labelledby="dashFlow"><h3 id="dashFlow">Flow in the selected range</h3><div class="dash-flow">' + flowCards + "</div>" + quality +
    '<div class="dash-chart" role="img" aria-label="Day-by-day created and closed tasks">' + movement + "</div></section>" +
    '<div class="dash-columns"><section><h3>Plan waves</h3>' + waves + '</section><section><h3>Epic health</h3>' + epics + "</section></div>";
}
