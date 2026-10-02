import { cpSync } from "node:fs";

// Publish the canonical packaged skill as a downloadable directory in the app.
cpSync(
  new URL("../packages/skill/roughdraft/", import.meta.url),
  new URL("../packages/app/public/skill/roughdraft/", import.meta.url),
  { recursive: true },
);
