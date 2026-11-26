/**
 * Shortcut table: bindings, conflict detection and event matching.
 *
 * The renderer keeps one command table and dispatches every global key through
 * it, so a rebind is a data change rather than a new branch in a keydown
 * handler. Framework-free so `tests/components.test.mjs` can assert the parts
 * that used to break: normalising `Ctrl+Shift+K`, refusing two owners for one
 * combination, and ignoring a keystroke the test does not mean.
 */

export const SHORTCUT_STORAGE_KEY = "hymnix.shortcuts.v1";

/** Modifiers in the order they are displayed, which is also their canonical order. */
export const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];

/** Human labels for key codes, so the UI never shows "KeyK". */
const KEY_LABELS = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Enter: "Enter", Escape: "Esc", Space: "Space", Tab: "Tab", Backspace: "Backspace",
  Delete: "Delete", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`",
};

/** Read the display label for one physical code. */
export function keyLabel(code) {
  const raw = String(code || "");
  if (!raw) return "";
  if (KEY_LABELS[raw]) return KEY_LABELS[raw];
  if (/^Key[A-Z]$/.test(raw)) return raw.slice(3);
  if (/^Digit[0-9]$/.test(raw)) return raw.slice(5);
  if (/^Numpad[0-9]$/.test(raw)) return "Num" + raw.slice(6);
  if (/^F[0-9]{1,2}$/.test(raw)) return raw;
  return raw;
}

/** Resolve the primary modifier for a platform: Command on macOS, Control elsewhere. */
export function primaryModifier(platform) {
  return String(platform || "win32") === "darwin" ? "meta" : "ctrl";
}

/** Expand `primary` and sort modifiers into the displayed order. */
export function normalizeModifiers(modifiers, platform) {
  const primary = primaryModifier(platform);
  const seen = new Set();
  for (const modifier of modifiers || []) {
    const value = modifier === "primary" ? primary : String(modifier).toLowerCase();
    if (MODIFIER_ORDER.includes(value)) seen.add(value);
  }
  return MODIFIER_ORDER.filter((value) => seen.has(value));
}

/** Canonical, comparable form of one binding. Two bindings conflict when these match. */
export function bindingKey(binding, platform) {
  if (!binding || !binding.code) return "";
  const modifiers = normalizeModifiers(binding.modifiers, platform);
  return [...modifiers, String(binding.code).toLowerCase()].join("+");
}

/** Keycaps for the UI, primary modifier first. */
export function bindingKeycaps(binding, platform) {
  if (!binding || !binding.code) return [];
  return normalizeModifiers(binding.modifiers, platform)
    .map((modifier) => ({ ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "⌘" }[modifier]))
    .concat([keyLabel(binding.code)]);
}

/** One-line form, e.g. `Ctrl+Shift+K`. */
export function formatBinding(binding, platform) {
  const caps = bindingKeycaps(binding, platform);
  return caps.length ? caps.join("+") : "";
}

/**
 * Turn a keydown into a binding, or null when it is not recordable
 * (a bare modifier, an IME composition, a repeat).
 */
export function eventBinding(event) {
  if (!event || event.repeat) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  const code = String(event.code || "");
  if (!code || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)) return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  return { code, modifiers };
}

/** True when a keydown is exactly this binding. */
export function matchesBinding(binding, event, platform) {
  if (!binding || !binding.code) return false;
  const actual = eventBinding(event);
  if (!actual) return false;
  return bindingKey(actual, platform) === bindingKey(binding, platform);
}

/**
 * Commands another binding would steal. Returns the owners, not a boolean, so
 * the editor can name the command that already holds the combination.
 */
export function findConflicts(commands, id, binding, platform) {
  const key = bindingKey(binding, platform);
  if (!key) return [];
  return (commands || [])
    // Fixed commands are included: binding a command to bare Enter or Escape
    // would fire two actions at once, and the editor must say so.
    .filter((command) => command.id !== id && command.binding)
    .filter((command) => bindingKey(command.binding, platform) === key)
    .map((command) => ({ id: command.id, label: command.label }));
}

/** The stored form: only commands that differ from the shipped defaults. */
export function overridesFrom(commands) {
  const overrides = {};
  for (const command of commands || []) {
    if (command.binding && command.binding.overridden) overrides[command.id] = command.binding;
    else if (!command.binding) overrides[command.id] = null;
  }
  return overrides;
}

/** Apply saved overrides on top of the shipped table. */
export function resolveShortcuts(defaults, overrides, platform) {
  const saved = overrides && typeof overrides === "object" ? overrides : {};
  return (defaults || []).map((command) => {
    let binding = command.binding;
    if (Object.prototype.hasOwnProperty.call(saved, command.id)) {
      const value = saved[command.id];
      binding = value && value.code ? { code: String(value.code), modifiers: normalizeModifiers(value.modifiers, platform) } : null;
    }
    return { ...command, binding, overridden: Object.prototype.hasOwnProperty.call(saved, command.id) };
  });
}

/** Return new overrides with one command rebound (null unbinds it). */
export function withOverride(overrides, id, binding) {
  const next = { ...(overrides && typeof overrides === "object" ? overrides : {}) };
  if (binding && binding.code) next[id] = { code: String(binding.code), modifiers: normalizeModifiers(binding.modifiers) };
  else next[id] = null;
  return next;
}

/** Forget one command's override. */
export function withoutOverride(overrides, id) {
  const next = { ...(overrides && typeof overrides === "object" ? overrides : {}) };
  delete next[id];
  return next;
}

/**
 * The shipped table. `fixed` commands describe physical/OS behaviour the app
 * cannot rebind honestly (Escape closes a layer, Enter sends), so the editor
 * shows them locked instead of pretending to own them.
 */
export const DEFAULT_SHORTCUTS = [
  { id: "palette.open", label: "Command palette", group: "Navigation", binding: { code: "KeyK", modifiers: ["ctrl"] } },
  { id: "session.new", label: "New chat", group: "Navigation", binding: { code: "KeyN", modifiers: ["ctrl"] } },
  { id: "nav.back", label: "Go back", group: "Navigation", binding: { code: "ArrowLeft", modifiers: ["alt"] } },
  { id: "sidebar.toggle", label: "Toggle sidebar", group: "Navigation", binding: { code: "KeyB", modifiers: ["ctrl"] } },
  { id: "inspector.toggle", label: "Toggle model panel", group: "Navigation", binding: { code: "Period", modifiers: ["ctrl"] } },
  { id: "settings.open", label: "Open settings", group: "Navigation", binding: { code: "Comma", modifiers: ["ctrl"] } },
  { id: "shortcuts.open", label: "Keyboard shortcuts", group: "Navigation", binding: { code: "Slash", modifiers: ["ctrl"] } },
  { id: "page.1", label: "Go to Chat", group: "Pages", binding: { code: "Digit1", modifiers: ["ctrl"] } },
  { id: "page.2", label: "Go to Models", group: "Pages", binding: { code: "Digit2", modifiers: ["ctrl"] } },
  { id: "page.3", label: "Go to Gateway", group: "Pages", binding: { code: "Digit3", modifiers: ["ctrl"] } },
  { id: "page.4", label: "Go to Monitor", group: "Pages", binding: { code: "Digit4", modifiers: ["ctrl"] } },
  { id: "page.5", label: "Go to Terminal", group: "Pages", binding: { code: "Digit5", modifiers: ["ctrl"] } },
  { id: "approvals.open", label: "Approval inbox", group: "Navigation", binding: { code: "KeyA", modifiers: ["ctrl", "shift"] } },
  { id: "jobs.open", label: "Background jobs", group: "Navigation", binding: { code: "KeyJ", modifiers: ["ctrl", "shift"] } },
  { id: "plan.tab", label: "Show the plan", group: "Conversation", binding: { code: "KeyP", modifiers: ["ctrl", "shift"] } },
  { id: "chat.copy", label: "Copy last reply", group: "Conversation", binding: { code: "KeyC", modifiers: ["ctrl", "shift"] } },
  { id: "chat.export", label: "Export chat", group: "Conversation", binding: { code: "KeyE", modifiers: ["ctrl", "shift"] } },
  { id: "composer.focus", label: "Focus the message box", group: "Conversation", binding: { code: "KeyL", modifiers: ["ctrl"] } },
  { id: "terminal.search", label: "Search terminal output", group: "Conversation", binding: { code: "KeyF", modifiers: ["ctrl"] }, scope: "Terminal" },
  { id: "chat.stop", label: "Close a layer or stop the reply", group: "Fixed", binding: { code: "Escape", modifiers: [] }, fixed: true },
  { id: "chat.send", label: "Send the message", group: "Fixed", binding: { code: "Enter", modifiers: [] }, fixed: true },
];

/** Commands grouped in display order, with the fixed tail last. */
export function shortcutGroups(commands) {
  const order = ["Navigation", "Pages", "Conversation", "Fixed"];
  const groups = new Map();
  for (const command of commands || []) {
    const name = command.group || "Navigation";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(command);
  }
  return [...groups.entries()].sort((left, right) => {
    const a = order.indexOf(left[0]); const b = order.indexOf(right[0]);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  }).map(([name, items]) => ({ name, items }));
}
