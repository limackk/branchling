/**
 * The field editors of the viewer's served page (TL-704): opening an editor,
 * rendering it, and saving what it holds through `api/task`.
 *
 * These functions were written inside the page template of build-viewer.mjs,
 * where they were one string to Stryker: a mutation run over a change to
 * startEdit() produced no mutant and could only say so (TL-657). Here they are
 * a module Stryker parses, and build-viewer.mjs pastes this exact source into
 * the page with `readModuleSource()`, so the browser runs the code the tests
 * run and the mutants are made in the code the page carries.
 *
 * THE PAGE SUPPLIES WHAT THESE FUNCTIONS READ AT CALL TIME. They are pasted
 * as declarations into the page script and resolve these names there, not
 * through imports: the page state (`state`, `ALL_TASKS`, `HISTORY`, `FIELDS`,
 * `CAN_EDIT`, `DEDICATED_FIELDS`), its renderers and helpers (`renderDetail`,
 * `refreshFromServer`, `escape`, `labelTitle`, `knownBoards`) and the browser
 * (`document`, `window`, `fetch`). None of them is read when the paste is
 * evaluated, so the paste may sit before the declarations it names. A test
 * evaluating this source supplies the same names.
 *
 * Nothing here is interpolated by the template: the one product-name
 * interpolation of the editing area, in `dedicatedCommandsHtml()`, stays in
 * the page. The import below is removed by the paste, which is why
 * task-fields.mjs is pasted before this module.
 */

import { actorRefusal, fieldSpec, isValidActor, normalizeValue, sameValue } from "./task-fields.mjs";

export function fieldLabel(key) {
  const spec = fieldSpec(key, FIELDS);
  return spec ? spec.label : key;
}

export function dynamicOptions() {
  const unique = function (key) {
    return [...new Set(ALL_TASKS.map(function (task) {
      return String(task[key] == null ? "" : task[key]).trim();
    }).filter(Boolean))].sort();
  };
  return { boards: knownBoards().map(function (board) { return board.slug; }), epics: unique("epic"), owners: unique("owner") };
}

export function startEdit(id, field) {
  if (!CAN_EDIT || DEDICATED_FIELDS[field]) return;
  if (!isValidActor(state.actor) || !state.actor.startsWith("user:")) {
    // The shape is diagnosed by actorRefusal(), the sentence every writing
    // command prints, so "user:Kamil" is refused for its name, not as if it
    // lacked an identity (TL-605). Only the user: requirement is the page's
    // own: the shared hint is printed when user: is the half already right,
    // since under any other namespace it would vouch for the wrong half.
    const bad = actorRefusal(state.actor);
    const required = "Enter a user:name identity before editing.";
    state.editMessage = !bad ? required
      : bad.refusal.charAt(0).toUpperCase() + bad.refusal.slice(1) + ". " + (!bad.namespace && state.actor.startsWith("user:") ? bad.hint + "." : required);
    state.editError = true;
    renderDetail();
    document.getElementById("editingActor").focus();
    return;
  }
  state.editing = { id: id, field: field };
  state.editMessage = "";
  renderDetail();
  const input = document.querySelector("[data-editor-focus]");
  if (input) input.focus();
}

export function cancelEdit() { state.editing = null; renderDetail(); }

export function editorHtml(t, spec) {
  const value = t[spec.key];
  const options = dynamicOptions();
  const id = escape(t.id);
  const key = escape(spec.key);
  if (spec.kind === "enum") {
    const list = (spec.dynamic ? (options[spec.dynamic] || []) : (spec.options || [])).slice();
    if (value && list.indexOf(String(value)) < 0) list.push(String(value));
    return '<select class="field-editor" data-editor-focus>' +
      (spec.allowEmpty ? '<option value="">— none —</option>' : "") +
      list.map(function (item) { return '<option value="' + escape(item) + '"' + (String(value || "") === item ? " selected" : "") + '>' + escape(labelTitle(item)) + '</option>'; }).join("") +
      '</select><div class="editor-actions"><button type="button" onclick="saveSelected(\'' + id + '\',\'' + key + '\',this)">Save</button><button type="button" onclick="cancelEdit()">Cancel</button></div>';
  }
  if (spec.kind === "list" && spec.closed) {
    return '<div class="field-editor chips-editor" data-editor-focus tabindex="-1">' + (spec.options || []).map(function (item) {
      const on = (value || []).indexOf(item) >= 0;
      return '<label class="chip-opt"><input type="checkbox" value="' + escape(item) + '"' + (on ? " checked" : "") + '> ' + escape(item) + '</label>';
    }).join("") + '<div class="editor-actions"><button type="button" onclick="saveChips(\'' + id + '\',\'' + key + '\',this)">Save</button><button type="button" onclick="cancelEdit()">Cancel</button></div></div>';
  }
  if (spec.kind === "list") {
    return '<div class="field-editor"><textarea class="field-input" data-editor-focus rows="3" placeholder="' + escape(spec.itemHint || "one value per line") + '">' + escape((value || []).join("\n")) + '</textarea><div class="editor-actions"><button type="button" onclick="saveLines(\'' + id + '\',\'' + key + '\',this)">Save</button><button type="button" onclick="cancelEdit()">Cancel</button></div></div>';
  }
  return '<div class="field-editor"><input class="field-input" data-editor-focus value="' + escape(value == null ? "" : value) + '"' + (spec.maxLength ? ' maxlength="' + spec.maxLength + '"' : '') + '><div class="editor-actions"><button type="button" onclick="saveText(\'' + id + '\',\'' + key + '\',this)">Save</button><button type="button" onclick="cancelEdit()">Cancel</button></div></div>';
}

export function saveSelected(id, field, button) { saveField(id, field, button.parentElement.previousElementSibling.value); }
export function saveText(id, field, button) { saveField(id, field, button.closest(".field-editor").querySelector("input").value); }
export function saveLines(id, field, button) { saveField(id, field, button.closest(".field-editor").querySelector("textarea").value.split("\n").map(function (line) { return line.trim(); }).filter(Boolean)); }
export function saveChips(id, field, button) { saveField(id, field, [...button.closest(".chips-editor").querySelectorAll("input:checked")].map(function (input) { return input.value; })); }

export async function saveField(taskId, field, value) {
  const task = ALL_TASKS.find(function (candidate) { return candidate.id === taskId; });
  const normalized = normalizeValue(field, value, { fields: FIELDS, options: dynamicOptions() });
  if (!task || !normalized.ok) {
    state.editMessage = normalized.error || "The task is no longer available.";
    state.editError = true;
    renderDetail();
    return;
  }
  if (sameValue(task[field], normalized.value)) { cancelEdit(); return; }
  state.editing = null;
  state.editMessage = "Saving…";
  state.editError = false;
  renderDetail();
  let actorRefused = false;
  try {
    const res = await fetch("api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Viewer-Capability": window.VIEWER_WRITE.token },
      body: JSON.stringify({
        id: taskId, field: field, value: normalized.value, actor: state.actor,
        revision: task.revision,
      }),
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      if (res.status === 409) await refreshFromServer(true);
      // The server refused to record the edit under a default nobody named
      // (TL-551): the fix is the identity field, so that is where focus goes.
      if (data.refusalKind === "actor-required") actorRefused = true;
      throw new Error(data.error || "HTTP " + res.status);
    }
    if (data.entries) HISTORY[taskId] = (HISTORY[taskId] || []).concat(data.entries);
    await refreshFromServer(true);
    state.editMessage = fieldLabel(field) + " saved to Markdown and history as " + (data.actor || state.actor) + ".";
    state.editError = false;
    renderDetail();
  } catch (error) {
    state.editMessage = "Not saved: " + error.message;
    state.editError = true;
    renderDetail();
    if (actorRefused) document.getElementById("editingActor").focus();
  }
}
