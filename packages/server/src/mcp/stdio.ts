import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createInkbackMcpServer, type McpOptions } from "./server.js";
export async function startMcpServer(
  options: McpOptions & { input?: Readable; output?: Writable } = {},
): Promise<void> {
  const { server, dispose } = createInkbackMcpServer(options);
  const input = options.input ?? process.stdin;
  const transport = new StdioServerTransport(
    input,
    options.output ?? process.stdout,
  );
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    const close = () => {
      dispose();
      void server.close().finally(resolve);
    };
    input.once("end", close);
    input.once("close", close);
    server.server.onclose = () => {
      dispose();
      resolve();
    };
  });
}
