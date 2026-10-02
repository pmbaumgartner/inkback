import { marked } from "marked";
export class ImageCache {
  private images = new Map<string, string>();
  get(path: string) {
    return this.images.get(path) ?? null;
  }
  set(path: string, mimeType: string, dataBase64: string) {
    const url = `data:${mimeType};base64,${dataBase64}`;
    this.images.set(path, url);
    return url;
  }
  async prefetch(
    content: string,
    read: (path: string) => Promise<{ mimeType: string; dataBase64: string }>,
  ) {
    const paths = new Set<string>();
    marked.walkTokens(marked.lexer(content), (token) => {
      if (
        token.type === "image" &&
        !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(token.href)
      )
        paths.add(token.href);
    });
    const pending = [...paths].filter((path) => !this.images.has(path));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (next < pending.length) {
          const path = pending[next++];
          try {
            const image = await read(path);
            this.set(path, image.mimeType, image.dataBase64);
          } catch {
            /* Missing images show alt text. */
          }
        }
      }),
    );
  }
}
