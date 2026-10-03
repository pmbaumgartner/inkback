import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";

let host: App | null = null;
export function setHostBridge(app: App | null) {
  host = app;
}
export function applyHostTheme(context?: Pick<McpUiHostContext, "theme">) {
  document.documentElement.classList.toggle(
    "dark",
    context?.theme
      ? context.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
export async function copyHostText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showLinkNotice("Copy is not available in this host.");
  }
}
export function showLinkNotice(message: string, url?: string) {
  document.getElementById("inkback-host-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "inkback-host-notice";
  notice.setAttribute("role", "status");
  notice.className =
    "fixed bottom-4 left-4 right-4 z-[100] rounded-xl border bg-background p-4 text-foreground shadow-lg";
  const text = document.createElement("p");
  text.textContent = message;
  notice.append(text);
  if (url) {
    const copy = document.createElement("button");
    copy.textContent = "Copy URL";
    copy.onclick = () => {
      void copyHostText(url);
    };
    notice.append(copy);
  }
  const close = document.createElement("button");
  close.textContent = "Dismiss";
  close.className = "ml-4";
  close.onclick = () => notice.remove();
  notice.append(close);
  document.body.append(notice);
}
export async function openExternalLink(url: string) {
  if (!host && !/^(?:javascript|vbscript|data):/i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    if (host) showLinkNotice("Links to other files do not open in this view.");
    return;
  }
  if (host?.getHostCapabilities()?.openLinks) {
    try {
      const result = await host.openLink({ url });
      if (!result.isError) return;
    } catch {
      /* Show copy fallback. */
    }
  }
  showLinkNotice(url, url);
}
export function captureHostLinks(root: HTMLElement) {
  const listener = (event: MouseEvent) => {
    const link =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    void openExternalLink(link.getAttribute("href") ?? "");
  };
  root.addEventListener("click", listener, true);
  return () => root.removeEventListener("click", listener, true);
}
