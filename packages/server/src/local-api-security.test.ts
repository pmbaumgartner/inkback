import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./index.js";

let root: string;
let outside: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-security-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-outside-"));
  fs.writeFileSync(path.join(root, "draft.md"), "draft");
  fs.writeFileSync(path.join(outside, "draft.md"), "private");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

it("accepts loopback hosts across ports and rejects foreign Host and Origin", async () => {
  const { app } = createApp({ projectDir: root });
  expect(
    (
      await request(app)
        .get("/api/status")
        .set("Host", "localhost:5173")
        .set("Origin", "http://localhost:5173")
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .get("/api/status")
        .set("Host", "[::1]:4317")
        .set("Origin", "http://localhost:80")
    ).status,
  ).toBe(200);
  expect(
    (await request(app).get("/api/status").set("Host", "attacker.example"))
      .status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .get("/api/status")
        .set("Origin", "https://attacker.example")
    ).status,
  ).toBe(403);
});

it("enforces allowed directories on reads, writes, deletion and symlink targets", async () => {
  const { app } = createApp({ projectDir: root });
  for (const method of ["get", "put", "delete"] as const) {
    const response = await request(app)
      [method]("/api/pages/draft")
      .query({ projectPath: outside })
      .send({ content: "overwrite" });
    expect(response.status).toBe(403);
  }
  fs.symlinkSync(path.join(outside, "draft.md"), path.join(root, "escape.md"));
  expect(
    (
      await request(app)
        .get("/api/markdown-file")
        .query({ projectPath: root, path: "escape.md" })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post("/api/project/create")
        .send({ path: path.join(outside, "new") })
    ).status,
  ).toBe(403);
  expect(fs.readFileSync(path.join(outside, "draft.md"), "utf8")).toBe(
    "private",
  );
});

it("serves sandboxed images and rejects active non-image files", async () => {
  const { app } = createApp({ projectDir: root });
  fs.writeFileSync(
    path.join(root, "image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  fs.writeFileSync(path.join(root, "page.html"), "<script>alert(1)</script>");
  const image = await request(app)
    .get("/api/files")
    .query({ projectPath: root, path: "image.svg" });
  expect(image.status).toBe(200);
  expect(image.headers["content-security-policy"]).toBe("sandbox");
  expect(image.headers["x-content-type-options"]).toBe("nosniff");
  expect(
    (
      await request(app)
        .get("/api/files")
        .query({ projectPath: root, path: "page.html" })
    ).status,
  ).toBe(400);
});

it("writes assets exclusively without following a dangling symlink", async () => {
  const { app } = createApp({ projectDir: root });
  fs.mkdirSync(path.join(root, ".inkback-assets"));
  const escaped = path.join(outside, "escaped.png");
  fs.symlinkSync(escaped, path.join(root, ".inkback-assets", "image.png"));
  const response = await request(app)
    .post("/api/assets")
    .send({
      projectPath: root,
      filename: "image.png",
      mimeType: "image/png",
      dataBase64: Buffer.from("image").toString("base64"),
    });
  expect(response.status).toBe(201);
  expect(response.body.markdownPath).toBe("./.inkback-assets/image-1.png");
  expect(fs.existsSync(escaped)).toBe(false);
});

it("delivers open requests as document paths and review IDs", async () => {
  const { app } = createApp({ projectDir: root });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const documentPath = path.join(root, "draft.md");
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stream = await fetch(
      `${base}/api/open-requests?path=${encodeURIComponent(documentPath)}`,
    );
    if (!stream.body) throw new Error("Expected open-request event stream");
    reader = stream.body.getReader();
    await reader.read();
    const response = await request(app)
      .post("/api/open-request")
      .send({ path: documentPath, reviewId: "review-1" });
    expect(response.body).toEqual({ delivered: true });
    const event = new TextDecoder().decode((await reader.read()).value);
    const data = event.split("data: ")[1];
    if (!data) throw new Error(`Expected open-request event data: ${event}`);
    const payload = JSON.parse(data.trim());
    expect(payload).toEqual({ path: documentPath, reviewId: "review-1" });
  } finally {
    await reader?.cancel();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
