// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ImageCache } from "./image-cache";

it("prefetches nested local images with at most four concurrent reads", async () => {
  const cache = new ImageCache();
  let active = 0;
  let peak = 0;
  const read = vi.fn(async () => {
    active++;
    peak = Math.max(active, peak);
    await Promise.resolve();
    active--;
    return { mimeType: "image/png", dataBase64: "eA==" };
  });
  await cache.prefetch(
    Array.from({ length: 9 }, (_, index) => `- ![image](img${index}.png)`).join(
      "\n",
    ) +
      "\n![remote](https://example.com/a.png)\n![remote](//example.com/a.png)",
    read,
  );
  expect(read).toHaveBeenCalledTimes(9);
  expect(peak).toBeLessThanOrEqual(4);
  expect(cache.get("img0.png")).toBe("data:image/png;base64,eA==");
});
