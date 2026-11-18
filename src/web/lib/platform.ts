export const isMac = /Mac|iPhone|iPad/u.test(globalThis.navigator?.userAgent ?? "");

export const modifierKey = isMac ? "⌘" : "Ctrl";

export type KeyPress = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export const pressesModifier = (event: KeyPress) => (isMac ? event.metaKey : event.ctrlKey);
