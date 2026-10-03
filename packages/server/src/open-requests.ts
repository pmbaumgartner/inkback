import type { Express, Response } from "express";

interface OpenRequestClient {
  id: number;
  path: string | null;
  response: Response;
}

interface OpenRequestPayload {
  path?: string;
  url?: string;
}

export function registerOpenRequests(app: Express) {
  let nextOpenRequestClientId = 1;
  const openRequestClients = new Set<OpenRequestClient>();
  app.get("/api/open-requests", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? req.query.path.trim()
        : null;
    const client: OpenRequestClient = {
      id: nextOpenRequestClientId,
      path: requestedPath,
      response: res,
    };
    nextOpenRequestClientId += 1;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(
      `event: connected\ndata: ${JSON.stringify({ id: client.id })}\n\n`,
    );

    openRequestClients.add(client);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      openRequestClients.delete(client);
    });
  });

  app.post("/api/open-request", (req, res) => {
    const payload = req.body as OpenRequestPayload;
    const targetPath =
      typeof payload.path === "string" && payload.path.trim().length > 0
        ? payload.path.trim()
        : null;
    const targetUrl =
      typeof payload.url === "string" && payload.url.trim().length > 0
        ? payload.url.trim()
        : null;

    if (!targetPath || !targetUrl) {
      res.status(400).json({ error: "path and url are required" });
      return;
    }

    const matchingClient = Array.from(openRequestClients)
      .reverse()
      .find((client) => client.path === targetPath);

    if (!matchingClient) {
      res.json({ delivered: false });
      return;
    }

    matchingClient.response.write(
      `event: open-request\ndata: ${JSON.stringify({
        path: targetPath,
        url: targetUrl,
      })}\n\n`,
    );
    res.json({ delivered: true });
  });
}
