import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

afterEach(() => {
  vi.restoreAllMocks();

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }

  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
});

describe("copyTextToClipboard", () => {
  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a hidden textarea when navigator.clipboard rejects", async () => {
    const writeText = vi.fn<Clipboard["writeText"]>().mockRejectedValue(new Error("blocked"));
    const execCommand = vi.fn<(command: string) => boolean>().mockReturnValue(true);
    const textarea = {
      focus: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
      setAttribute: vi.fn(),
      style: {},
      value: "",
    };
    const fakeDocument = {
      activeElement: null,
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand,
      getSelection: vi.fn(() => null),
    };

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    await expect(copyTextToClipboard("fallback")).resolves.toBe(true);
    expect(textarea.value).toBe("fallback");
    expect(fakeDocument.body.appendChild).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalled();
  });

  it("returns false when no clipboard strategy is available", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });

    await expect(copyTextToClipboard("nope")).resolves.toBe(false);
  });
});
