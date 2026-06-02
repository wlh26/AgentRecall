export const GLOBAL_SHORTCUT_OPTIONS = [
  { label: "Option + Space", value: "Alt+Space" },
  { label: "Control + Option + Space", value: "Ctrl+Alt+Space" },
  { label: "Command + Option + Space", value: "CommandOrControl+Alt+Space" },
  { label: "Disabled", value: "" },
] as const;

export type GlobalShortcut = (typeof GLOBAL_SHORTCUT_OPTIONS)[number]["value"];

const GLOBAL_SHORTCUT_VALUES = new Set<string>(GLOBAL_SHORTCUT_OPTIONS.map((option) => option.value));

export function defaultGlobalShortcut(platform: NodeJS.Platform = process.platform): GlobalShortcut {
  return platform === "win32" ? "Ctrl+Alt+Space" : "Alt+Space";
}

export const DEFAULT_GLOBAL_SHORTCUT: GlobalShortcut = defaultGlobalShortcut();

export function normalizeGlobalShortcut(value: unknown, platform: NodeJS.Platform = process.platform): GlobalShortcut {
  return typeof value === "string" && GLOBAL_SHORTCUT_VALUES.has(value)
    ? (value as GlobalShortcut)
    : defaultGlobalShortcut(platform);
}

// On Windows, Electron accelerators use Alt/Control; macOS shows Option/Command.
function relabelForPlatform(label: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return label;
  return label.replace(/Option/g, "Alt").replace(/Command/g, "Ctrl").replace(/Control/g, "Ctrl");
}

export function globalShortcutOptions(
  platform: NodeJS.Platform = process.platform,
): Array<{ label: string; value: GlobalShortcut }> {
  return GLOBAL_SHORTCUT_OPTIONS.map((option) => ({
    label: relabelForPlatform(option.label, platform),
    value: option.value,
  }));
}

export function globalShortcutLabel(value: string, platform: NodeJS.Platform = process.platform): string {
  const found = globalShortcutOptions(platform).find((option) => option.value === value);
  return found?.label ?? relabelForPlatform("Option + Space", platform);
}
