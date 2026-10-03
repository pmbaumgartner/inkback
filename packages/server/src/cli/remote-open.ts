import crypto from "node:crypto";
import fs from "node:fs";
import { emitJson } from "./output.js";
import type {
  CliDependencies,
  ParsedSseChunk,
  RemoteOpenOptions,
  SseEvent,
} from "./types.js";

function parseSseEvents(buffer: string): ParsedSseChunk {
  // Normalize CRLF to LF up front so the rest of the parser can treat \n
  // as the only line terminator. SSE allows \r\n; some proxies rewrite it.
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: SseEvent[] = [];
  let cursor = 0;
  while (true) {
    const blank = normalized.indexOf("\n\n", cursor);
    if (blank === -1) break;
    const block = normalized.slice(cursor, blank);
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        eventName = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      }
    }
    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join("\n") });
    }
    cursor = blank + 2;
  }
  return { events, remainder: normalized.slice(cursor) };
}

async function atomicWriteFile(
  targetPath: string,
  content: string,
): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmpPath, content);
  await fs.promises.rename(tmpPath, targetPath);
}

function appendTokenToViewerUrl(viewerUrl: string, token: string): string {
  if (token.length === 0) return viewerUrl;
  try {
    const parsed = new URL(viewerUrl);
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    // Fall back to a simple suffix if the URL is malformed; the browser will
    // reject it the same way it would have without the token.
    const separator = viewerUrl.includes("?") ? "&" : "?";
    return `${viewerUrl}${separator}token=${encodeURIComponent(token)}`;
  }
}

export async function runRemoteOpen(
  deps: CliDependencies,
  options: RemoteOpenOptions,
): Promise<number> {
  const baseUrl = options.host.replace(/\/$/, "");
  const remoteToken =
    typeof deps.env.INKBACK_TOKEN === "string"
      ? deps.env.INKBACK_TOKEN.trim()
      : "";
  const authHeaders: Record<string, string> =
    remoteToken.length > 0 ? { Authorization: `Bearer ${remoteToken}` } : {};

  let content: string;
  try {
    content = await fs.promises.readFile(options.openPath, "utf-8");
  } catch (error) {
    deps.error(
      error instanceof Error
        ? error.message
        : `Could not read ${options.openPath}`,
    );
    return 1;
  }

  const sessionId = crypto.randomUUID();

  const REGISTER_TIMEOUT_MS = 10_000;
  let registerResponse: Response;
  try {
    registerResponse = await deps.fetchImpl(`${baseUrl}/api/remote-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        sessionId,
        originPath: options.openPath,
        content,
      }),
      signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
    });
  } catch (error) {
    deps.error(
      `Could not register remote session at ${baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }

  if (!registerResponse.ok) {
    if (registerResponse.status === 401) {
      deps.error(
        `Remote host rejected the session register (HTTP 401). Set INKBACK_TOKEN to the token configured on the host before retrying.`,
      );
    } else {
      deps.error(
        `Remote host rejected the session register (HTTP ${registerResponse.status}).`,
      );
    }
    return 1;
  }

  const registerPayload = (await registerResponse.json()) as {
    id?: string;
    version?: string;
    viewerUrl?: string;
  };

  // The browser viewer must include the same token so its fetches and
  // EventSource connection authenticate. The server's viewerUrl response field
  // is unaware of the token (it doesn't see secrets in plaintext over the wire
  // unless we add them); the CLI knows the token and can append it.
  const baseViewer =
    typeof registerPayload.viewerUrl === "string"
      ? registerPayload.viewerUrl
      : `${baseUrl}/?session=${encodeURIComponent(sessionId)}`;
  const viewerUrl = appendTokenToViewerUrl(baseViewer, remoteToken);

  if (options.printUrl) {
    deps.log(viewerUrl);
    return 0;
  }

  if (!options.noOpen && deps.env.INKBACK_NO_OPEN !== "1") {
    deps.openUrl(viewerUrl);
  }

  if (options.json) {
    emitJson(deps.log, {
      opened: true,
      mode: "remote",
      sessionId,
      url: viewerUrl,
      host: baseUrl,
      path: options.openPath,
    });
  } else {
    deps.log(`Opened remote Inkback session: ${viewerUrl}`);
    deps.log(`Holding session open for ${options.openPath}. Ctrl-C to exit.`);
  }

  const SSE_CONNECT_TIMEOUT_MS = 10_000;
  const eventsUrl = new URL(
    `/api/remote-document/${encodeURIComponent(sessionId)}/events`,
    baseUrl,
  );
  eventsUrl.searchParams.set("role", "cli");

  let eventsResponse: Response;
  try {
    eventsResponse = await deps.fetchImpl(eventsUrl.toString(), {
      headers: { Accept: "text/event-stream", ...authHeaders },
      signal: AbortSignal.timeout(SSE_CONNECT_TIMEOUT_MS),
    });
  } catch (error) {
    deps.error(
      `Lost connection to remote host: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }

  if (!eventsResponse.ok || !eventsResponse.body) {
    deps.error(
      `Could not open remote event stream (HTTP ${eventsResponse.status}).`,
    );
    return 1;
  }

  const reader = eventsResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        if (event.event === "save") {
          let payload: { content?: unknown } = {};
          try {
            payload = JSON.parse(event.data) as { content?: unknown };
          } catch {
            continue;
          }
          if (typeof payload.content === "string") {
            try {
              await atomicWriteFile(options.openPath, payload.content);
              if (!options.json) {
                deps.log(`Saved ${options.openPath} from remote.`);
              }
            } catch (error) {
              deps.error(
                `Failed to write ${options.openPath}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be in an errored state; ignore.
    }
  }

  if (!options.json) {
    deps.log("Remote session disconnected.");
  }
  return 0;
}
