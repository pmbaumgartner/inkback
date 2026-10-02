import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPackageJsonPath = path.resolve(__dirname, "../../../package.json");
const DEFAULT_PACKAGE_NAME = "roughdraft";
const FORK_REPOSITORY = "pmbaumgartner/roughdraft";

interface PackageManifest {
  name?: string;
  version?: string;
  repository?: string | { url?: string };
}

interface ParsedVersion {
  parts: number[];
  prerelease: string[];
}

export interface UpdateStatus {
  packageName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

interface ResolveUpdateStatusOptions {
  fetchImpl?: typeof fetch;
  packageJsonPath?: string;
  packageName?: string;
}

function readInstalledPackageInfo(packageJsonPath = defaultPackageJsonPath): {
  packageName: string;
  currentVersion: string | null;
  repository?: PackageManifest["repository"];
} {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    return {
      packageName: manifest.name?.trim() || DEFAULT_PACKAGE_NAME,
      currentVersion: manifest.version?.trim() || null,
      repository: manifest.repository,
    };
  } catch {
    return {
      packageName: DEFAULT_PACKAGE_NAME,
      currentVersion: null,
    };
  }
}

function usesForkReleases(repository: PackageManifest["repository"]): boolean {
  const url = typeof repository === "string" ? repository : repository?.url;
  return (
    typeof url === "string" &&
    url.replace(/^git\+/, "").replace(/\.git\/?$|\/$/, "") ===
      `https://github.com/${FORK_REPOSITORY}`
  );
}

async function fetchLatestForkRelease(fetchImpl: typeof fetch): Promise<{
  version: string;
  updateCommand: string;
} | null> {
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${FORK_REPOSITORY}/releases/latest`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) return null;

    const release = (await response.json()) as {
      tag_name?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const version = release.tag_name?.match(
      /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
    )?.[1];
    if (!version || release.draft || release.prerelease) return null;

    const assetName = `roughdraft-${version}.tgz`;
    const downloadUrl = `https://github.com/${FORK_REPOSITORY}/releases/download/${release.tag_name}/${assetName}`;
    const asset = release.assets?.find(
      (candidate) =>
        candidate.name === assetName &&
        candidate.browser_download_url === downloadUrl,
    );
    if (!asset) return null;

    return { version, updateCommand: `npm i -g ${downloadUrl}` };
  } catch {
    return null;
  }
}

function parseVersion(version: string): ParsedVersion {
  const normalizedVersion = version.trim().replace(/^v/i, "");
  const [mainVersion, prereleaseVersion = ""] = normalizedVersion.split("-", 2);
  const parts = mainVersion
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));

  const prerelease = prereleaseVersion
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  return { parts, prerelease };
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = Number.parseInt(leftPart, 10);
    const rightNumber = Number.parseInt(rightPart, 10);
    const leftIsNumeric = /^[0-9]+$/.test(leftPart);
    const rightIsNumeric = /^[0-9]+$/.test(rightPart);

    if (leftIsNumeric && rightIsNumeric) {
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
      continue;
    }

    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    return leftPart.localeCompare(rightPart);
  }

  return 0;
}

export function compareVersions(leftVersion: string, rightVersion: string) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  const length = Math.max(left.parts.length, right.parts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left.parts[index] ?? 0;
    const rightPart = right.parts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

async function fetchLatestVersion(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as PackageManifest;
    return payload.version?.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveUpdateStatus(
  options: ResolveUpdateStatusOptions = {},
): Promise<UpdateStatus> {
  const installedPackageInfo = readInstalledPackageInfo(
    options.packageJsonPath,
  );
  const packageName =
    options.packageName?.trim() || installedPackageInfo.packageName;
  const currentVersion = installedPackageInfo.currentVersion;
  const fetchImpl = options.fetchImpl ?? fetch;
  const useForkReleases = usesForkReleases(installedPackageInfo.repository);
  const release = useForkReleases
    ? await fetchLatestForkRelease(fetchImpl)
    : null;
  const latestVersion = useForkReleases
    ? (release?.version ?? null)
    : await fetchLatestVersion(packageName, fetchImpl);

  return {
    packageName,
    currentVersion,
    latestVersion,
    updateAvailable:
      !!currentVersion &&
      !!latestVersion &&
      compareVersions(currentVersion, latestVersion) < 0,
    updateCommand: useForkReleases
      ? (release?.updateCommand ?? "")
      : `npm i -g ${packageName}@latest`,
  };
}
