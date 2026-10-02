import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareVersions, resolveUpdateStatus } from "./update-status";

describe("compareVersions", () => {
  it("orders numeric versions correctly", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("treats prereleases as older than stable releases", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.1")).toBeGreaterThan(0);
  });
});

describe("resolveUpdateStatus", () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    tempPaths.forEach((tempPath) => {
      fs.rmSync(tempPath, { recursive: true, force: true });
    });
    tempPaths.length = 0;
  });

  it("keeps fork updates on the matching GitHub release package", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "roughdraft",
        version: "0.1.11-pmbaumgartner.1",
        repository: {
          type: "git",
          url: "git+https://github.com/pmbaumgartner/roughdraft.git",
        },
      }),
    );
    const downloadUrl =
      "https://github.com/pmbaumgartner/roughdraft/releases/download/v0.1.11-pmbaumgartner.2/roughdraft-0.1.11-pmbaumgartner.2.tgz";
    const requestedUrls: string[] = [];
    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return Response.json({
          tag_name: "v0.1.11-pmbaumgartner.2",
          assets: [
            {
              name: "roughdraft-0.1.11-pmbaumgartner.2.tgz",
              browser_download_url: downloadUrl,
            },
          ],
        });
      },
    });

    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.11-pmbaumgartner.1",
      latestVersion: "0.1.11-pmbaumgartner.2",
      updateAvailable: true,
      updateCommand: `npm i -g ${downloadUrl}`,
    });
    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/pmbaumgartner/roughdraft/releases/latest",
    ]);
  });

  it("reports when the installed version is behind npm", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "roughdraft",
        version: "0.1.0",
        repository: { url: "git+https://github.com/Lex-Inc/roughdraft.git" },
      }),
    );

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "0.2.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      updateCommand: "npm i -g roughdraft@latest",
    });
  });

  it.each([
    { label: "unreachable GitHub", response: null },
    {
      label: "rate-limited GitHub",
      response: new Response(null, { status: 403 }),
    },
    {
      label: "release without a built package",
      response: Response.json({
        tag_name: "v0.1.11-pmbaumgartner.2",
        assets: [],
      }),
    },
    {
      label: "release with an unrelated download URL",
      response: Response.json({
        tag_name: "v0.1.11-pmbaumgartner.2",
        assets: [
          {
            name: "roughdraft-0.1.11-pmbaumgartner.2.tgz",
            browser_download_url: "https://example.com/unrelated.tgz",
          },
        ],
      }),
    },
  ])("does not switch the fork to npm after $label", async ({ response }) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "roughdraft",
        version: "0.1.11-pmbaumgartner.1",
        repository: "https://github.com/pmbaumgartner/roughdraft",
      }),
    );
    const requestedUrls: string[] = [];
    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        if (!response) throw new Error("offline");
        return response;
      },
    });

    expect(status).toMatchObject({
      latestVersion: null,
      updateAvailable: false,
      updateCommand: "",
    });
    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/pmbaumgartner/roughdraft/releases/latest",
    ]);
  });

  it("degrades cleanly when npm cannot be reached", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
      updateCommand: "npm i -g roughdraft@latest",
    });
  });
});
