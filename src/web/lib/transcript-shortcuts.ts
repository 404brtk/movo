import { isMac, type KeyPress, pressesModifier } from "./platform.ts";

export interface Shortcut {
  label: string;
  keys: string;
  matches: (event: KeyPress) => boolean;
}

export const searchShortcut: Shortcut = {
  label: isMac ? "⌘F" : "Ctrl+F",
  keys: isMac ? "Meta+F" : "Control+F",
  matches: (event) =>
    event.code === "KeyF" && pressesModifier(event) && !event.shiftKey && !event.altKey,
};

export const replaceShortcut: Shortcut = {
  label: isMac ? "⇧⌘H" : "Ctrl+H",
  keys: isMac ? "Shift+Meta+H" : "Control+H",
  matches: (event) =>
    event.code === "KeyH" && pressesModifier(event) && event.shiftKey === isMac && !event.altKey,
};
