import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "./api-backend";
import { detectBackend } from "./detect-backend";
import { LocalStorageBackend } from "./local-storage-backend";

describe("detectBackend", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("uses the API backend when a local server is available", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ backend: "local-files", projectDir: "/work" }),
        ),
    ) as unknown as typeof fetch;
    const backend = await detectBackend();
    expect(backend).toBeInstanceOf(ApiBackend);
    expect(backend.info.projectPath).toBe("/work");
  });

  it("uses local storage when no server is available", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const backend = await detectBackend();

    expect(backend).toBeInstanceOf(LocalStorageBackend);
  });
});
