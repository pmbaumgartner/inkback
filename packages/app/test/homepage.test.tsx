import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Homepage } from "../src/App";

describe("Homepage", () => {
  it("explains how to start when no document is open", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Homepage message="Open a local Markdown file to begin reviewing." />,
      );
    });
    expect(container.querySelector("h1")?.textContent).toBe("Inkback");
    expect(container.textContent).toContain(
      "Open a local Markdown file to begin reviewing.",
    );
    await act(async () => root.unmount());
    container.remove();
  });

  it("displays a file opening error", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<Homepage message="Could not open that markdown file." />),
    );
    expect(container.textContent).toContain(
      "Could not open that markdown file.",
    );
    await act(async () => root.unmount());
    container.remove();
  });
});
