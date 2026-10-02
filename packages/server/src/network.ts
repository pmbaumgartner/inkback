export { NAME_PLACEHOLDER_DEFAULT_PORT } from "../defaults.mjs";
export const NAME_PLACEHOLDER_BIND_HOST = "127.0.0.1";
export const NAME_PLACEHOLDER_LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;
export const NAME_PLACEHOLDER_PUBLIC_HOST = "localhost";

export const NAME_PLACEHOLDER_BIND_HOST_ENV = "NAME_PLACEHOLDER_BIND_HOST";

const LOOPBACK_HOST_NAMES = new Set<string>([
  ...NAME_PLACEHOLDER_LOOPBACK_HOSTS,
  "localhost",
]);

export function resolveBindHosts(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const raw = env[NAME_PLACEHOLDER_BIND_HOST_ENV];

  if (raw === undefined) {
    return NAME_PLACEHOLDER_LOOPBACK_HOSTS;
  }

  const hosts = raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);

  if (hosts.length === 0) {
    return NAME_PLACEHOLDER_LOOPBACK_HOSTS;
  }

  return hosts;
}

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOST_NAMES.has(host)) return true;
  // Any address in 127.0.0.0/8 is loopback (RFC 5735).
  if (host.startsWith("127.")) return true;
  return false;
}

export function hasNonLoopbackHost(hosts: readonly string[]): boolean {
  return hosts.some((host) => !isLoopbackHost(host));
}
