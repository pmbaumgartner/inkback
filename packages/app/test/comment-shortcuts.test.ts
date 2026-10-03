// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  getAddCommentShortcutLabel,
  matchesAddCommentShortcut,
} from "../src/comment-shortcuts";

describe("comment shortcuts", () => {
  it("formats the add comment shortcut label for Mac platforms", () => {
    expect(getAddCommentShortcutLabel("MacIntel")).toBe("Cmd + Option + M");
    expect(getAddCommentShortcutLabel("iPhone")).toBe("Cmd + Option + M");
  });

  it("formats the add comment shortcut label for non-Mac platforms", () => {
    expect(getAddCommentShortcutLabel("Win32")).toBe("Ctrl + Alt + M");
    expect(getAddCommentShortcutLabel("Linux x86_64")).toBe("Ctrl + Alt + M");
  });

  it("matches the Mac add comment shortcut", () => {
    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyM",
          key: "m",
          altKey: true,
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);
  });

  it("matches the Windows add comment shortcut", () => {
    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyM",
          key: "M",
          altKey: true,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        "Win32",
      ),
    ).toBe(true);
  });

  it("rejects partial or conflicting modifier combinations", () => {
    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyM",
          key: "m",
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        "Win32",
      ),
    ).toBe(false);

    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyM",
          key: "m",
          altKey: true,
          ctrlKey: true,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(false);
  });

  it("matches the Mac shortcut from the physical key code even when Option changes the character", () => {
    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyM",
          key: "µ",
          altKey: true,
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);
  });

  it("rejects non-M physical keys even if the produced character is m", () => {
    expect(
      matchesAddCommentShortcut(
        {
          code: "KeyN",
          key: "m",
          altKey: true,
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(false);
  });
});
