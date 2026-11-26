/** Type declarations for shortcuts.js. Keep in sync with the exports. */

export type ShortcutBinding = { code: string; modifiers: string[] };
export type ShortcutCommand = {
  id: string;
  label: string;
  group: string;
  binding: ShortcutBinding | null;
  fixed?: boolean;
  scope?: string;
  overridden?: boolean;
};
export type ShortcutOverrides = Record<string, ShortcutBinding | null>;

export declare const SHORTCUT_STORAGE_KEY: string;
export declare const MODIFIER_ORDER: string[];
export declare function keyLabel(code: string): string;
export declare function primaryModifier(platform?: string): string;
export declare function normalizeModifiers(modifiers: string[] | undefined, platform?: string): string[];
export declare function bindingKey(binding: ShortcutBinding | null | undefined, platform?: string): string;
export declare function bindingKeycaps(binding: ShortcutBinding | null | undefined, platform?: string): string[];
export declare function formatBinding(binding: ShortcutBinding | null | undefined, platform?: string): string;
export declare function eventBinding(event: KeyboardEvent | Record<string, unknown>): ShortcutBinding | null;
export declare function matchesBinding(binding: ShortcutBinding | null | undefined, event: KeyboardEvent | Record<string, unknown>, platform?: string): boolean;
export declare function findConflicts(commands: ShortcutCommand[], id: string, binding: ShortcutBinding | null, platform?: string): Array<{ id: string; label: string }>;
export declare function overridesFrom(commands: ShortcutCommand[]): ShortcutOverrides;
export declare function resolveShortcuts(defaults: ShortcutCommand[], overrides: ShortcutOverrides | null | undefined, platform?: string): ShortcutCommand[];
export declare function withOverride(overrides: ShortcutOverrides | null | undefined, id: string, binding: ShortcutBinding | null): ShortcutOverrides;
export declare function withoutOverride(overrides: ShortcutOverrides | null | undefined, id: string): ShortcutOverrides;
export declare const DEFAULT_SHORTCUTS: ShortcutCommand[];
export declare function shortcutGroups(commands: ShortcutCommand[]): Array<{ name: string; items: ShortcutCommand[] }>;
