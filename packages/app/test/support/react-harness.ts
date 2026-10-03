import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export function createReactHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    async render(node: ReactNode) {
      await act(async () => root.render(node));
    },
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
