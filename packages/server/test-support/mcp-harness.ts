import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createInkbackMcpServer, type McpOptions } from "../src/mcp/server.js";

export async function createMcpHarness(options: McpOptions) {
  const instance = createInkbackMcpServer(options);
  const client = new Client({ name: "test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await instance.server.connect(remote);
    await client.connect(local);
  } catch (error) {
    await client.close();
    await instance.server.close();
    throw error;
  }
  return {
    instance,
    client,
    async close() {
      await client.close();
      await instance.server.close();
    },
  };
}
