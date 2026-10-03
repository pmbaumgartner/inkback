import os from "node:os";
import { createServer } from "../../server/src/index";

process.env.INKBACK_ALLOWED_DIRS = os.tmpdir();

await createServer(Number(process.env.API_PORT ?? 4317));
