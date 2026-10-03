import fs from "node:fs";
import { gzipSync } from "node:zlib";

const html = fs.readFileSync(
  new URL("../packages/app/dist-mcp-app/mcp-app.html", import.meta.url),
);
console.log(
  `Inkback MCP App: ${html.length.toLocaleString()} bytes (${gzipSync(html).length.toLocaleString()} bytes gzip)`,
);
if (html.length > 3_000_000)
  throw new Error("MCP App exceeds the 3,000,000 byte limit.");
