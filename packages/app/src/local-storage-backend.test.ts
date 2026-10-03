import { expect, it } from "vitest";
import { LocalStorageBackend } from "./local-storage-backend";

it("retains concurrent uploads and allocates distinct asset paths", async () => {
  localStorage.clear();
  const backend = new LocalStorageBackend();
  const assets = await Promise.all([
    backend.saveAsset(new File(["first"], "image.png", { type: "image/png" })),
    backend.saveAsset(new File(["second"], "image.png", { type: "image/png" })),
  ]);
  expect(new Set(assets.map((asset) => asset.markdownPath)).size).toBe(2);
  for (const asset of assets)
    expect(backend.resolveFileUrl(asset.markdownPath)).toBe(asset.previewUrl);
  localStorage.clear();
});
