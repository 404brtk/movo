import { describe, expect, it } from "vitest";
import type { KeyPress } from "../../../../src/web/lib/platform.ts";
import { replaceShortcut, searchShortcut } from "../../../../src/web/lib/transcript-shortcuts.ts";

const press = (code: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("transcript shortcuts outside macOS", () => {
  it("opens search with Ctrl+F only", () => {
    expect(searchShortcut.label).toBe("Ctrl+F");
    expect(searchShortcut.matches(press("KeyF", { ctrlKey: true }))).toBe(true);
    expect(searchShortcut.matches(press("KeyF", { metaKey: true }))).toBe(false);
    expect(searchShortcut.matches(press("KeyF", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(searchShortcut.matches(press("KeyF", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(searchShortcut.matches(press("KeyG", { ctrlKey: true }))).toBe(false);
  });

  it("opens find and replace with Ctrl+H, not with Shift", () => {
    expect(replaceShortcut.label).toBe("Ctrl+H");
    expect(replaceShortcut.matches(press("KeyH", { ctrlKey: true }))).toBe(true);
    expect(replaceShortcut.matches(press("KeyH", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(replaceShortcut.matches(press("KeyH"))).toBe(false);
  });
});
