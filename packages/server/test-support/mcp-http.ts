import crypto from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createInkbackMcpServer, type McpOptions } from "../src/mcp/server.js";
// Loopback test transport. Outside src/dist; never shipped.
export async function startMcpHttp(
  options: McpOptions & { port?: number } = {},
) {
  const app = createMcpExpressApp({ host: "127.0.0.1", jsonLimit: "10mb" });
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, mcp-session-id, mcp-protocol-version, last-event-id",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "mcp-session-id, mcp-protocol-version",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  type Session = ReturnType<typeof createInkbackMcpServer> & {
    transport: NodeStreamableHTTPServerTransport;
  };
  const sessions = new Map<string, Session>();
  app.all("/mcp", async (req, res) => {
    const sessionId = req.get("mcp-session-id");
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      if (
        sessionId ||
        req.method !== "POST" ||
        req.body?.method !== "initialize"
      ) {
        res.sendStatus(400);
        return;
      }
      const instance = createInkbackMcpServer(options);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { ...instance, transport });
        },
      });
      await instance.server.connect(transport);
      session = { ...instance, transport };
    }
    await session.transport.handleRequest(req, res, req.body);
  });
  const http = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(options.port ?? 0, "127.0.0.1", () =>
      resolve(listener),
    );
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback port.");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      for (const session of sessions.values()) {
        session.dispose();
        await session.server.close();
      }
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
