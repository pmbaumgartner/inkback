import type { App } from "@modelcontextprotocol/ext-apps";
import { afterEach, expect, it, vi } from "vitest";
import { applyHostTheme, openExternalLink, setHostBridge } from "./host-bridge";

afterEach(() => {
  setHostBridge(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("tracks theme and routes external links through host capabilities", async () => {
  applyHostTheme({ theme: "dark" });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  applyHostTheme({ theme: "light" });
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  const openLink = vi.fn().mockResolvedValue({});
  setHostBridge({
    openLink,
    getHostCapabilities: () => ({ openLinks: {} }),
  } as unknown as App);
  await openExternalLink("https://example.com");
  expect(openLink).toHaveBeenCalledWith({ url: "https://example.com" });
});
it("offers copy when host links are unavailable and blocks unsafe links", async () => {
  setHostBridge({ getHostCapabilities: () => ({}) } as unknown as App);
  await openExternalLink("https://example.com");
  expect(document.body.textContent).toContain("Copy URL");
  await openExternalLink("javascript:alert(1)");
  expect(document.body.textContent).toContain(
    "Links to other files do not open",
  );
});
