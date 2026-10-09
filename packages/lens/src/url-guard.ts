/**
 * G09-01 Lens URL intake guard: fail-closed validation for capture URLs.
 * Only http(s) without embedded credentials; loopback, private,
 * link-local, carrier-grade NAT, reserved, and cloud-metadata targets are
 * rejected before any navigation, and every redirect target is
 * re-resolved and revalidated. DNS resolution itself is caller-injected
 * so tests stay deterministic and offline; production callers MUST pass
 * a real DNS view and pin fetches to guarded answers, because this gate
 * cannot close the check-to-fetch race on its own.
 */

export type LensGuardCode =
  | "lens/invalid-url"
  | "lens/unsupported-scheme"
  | "lens/blocked-host";

export class LensError extends Error {
  readonly code: LensGuardCode;
  constructor(code: LensGuardCode, message: string) {
    super(message);
    this.name = "LensError";
    this.code = code;
  }
}

const MAX_URL_CHARS = 2048;
const MAX_REDIRECT_HOPS = 5;

function blocked(message = "Capture target is blocked."): LensError {
  return new LensError("lens/blocked-host", message);
}

function invalid(message = "Capture URL is invalid."): LensError {
  return new LensError("lens/invalid-url", message);
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function expandIPv6(host: string): number[] | null {
  let address = host;
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  const percent = address.indexOf("%");
  if (percent >= 0) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = (halves[0] ?? "").split(":").filter((part) => part.length > 0);
  const tail = halves.length === 2 ? (halves[1] ?? "").split(":").filter((part) => part.length > 0) : [];
  const groups: number[] = [];
  const push = (part: string): boolean => {
    if (part.includes(".")) {
      const bytes = parseIPv4(part);
      if (bytes === null || bytes.length !== 4) return false;
      groups.push((bytes[0] as number) * 256 + (bytes[1] as number), (bytes[2] as number) * 256 + (bytes[3] as number));
      return true;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
    groups.push(parseInt(part, 16));
    return true;
  };
  for (const part of head) {
    if (!push(part)) return null;
  }
  const tailStart = groups.length;
  for (const part of tail) {
    if (!push(part)) return null;
  }
  const total = groups.length;
  if (halves.length === 2) {
    if (total >= 8) return null;
    const zeros = new Array(8 - total).fill(0) as number[];
    return [...groups.slice(0, tailStart), ...zeros, ...groups.slice(tailStart)];
  }
  if (total !== 8) return null;
  return groups;
}

function ipv4Blocked(bytes: number[]): boolean {
  const [a = 0, b = 0, c = 0] = bytes;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function ipv6Blocked(groups: number[]): boolean {
  const hex = groups.map((part) => part.toString(16).padStart(4, "0")).join(":");
  if (/^(0{1,4}:){7}0{0,3}1$/.test(hex)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(hex)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(hex) || /^fd[0-9a-f]{2}:/i.test(hex)) return true;
  if (/^(0{1,4}:){7}0{1,4}$/.test(hex)) return true;
  if (/^ff[0-9a-f]{2}:/i.test(hex)) return true;
  if (/^2001:0*db8:/i.test(hex)) return true;
  return false;
}

/** True when the low 32 bits embed an IPv4 address (compat/transition ranges). */
function embeddedV4(groups: number[]): number[] | null {
  if (groups.length !== 8) return null;
  const first = groups.slice(0, 6);
  const isCompat = first.every((part) => part === 0);
  const isWellKnown = groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0;
  const isSiit = groups.slice(0, 4).every((part) => part === 0) && groups[4] === 0xffff && groups[5] === 0;
  const is6to4 = groups[0] === 0x2002;
  if (isCompat || isWellKnown || isSiit) {
    const low = groups[7] ?? 0;
    const high = groups[6] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff];
  }
  if (is6to4) {
    const high = groups[1] ?? 0;
    const low = groups[2] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff];
  }
  return null;
}

function ipv6BlockedWithEmbedded(groups: number[]): boolean {
  if (ipv6Blocked(groups)) return true;
  const mapped = addressToV4Mapped(groups);
  if (mapped !== null) {
    const bytes = parseIPv4(mapped);
    if (bytes === null || ipv4Blocked(bytes)) return true;
    return false;
  }
  const embedded = embeddedV4(groups);
  if (embedded !== null && ipv4Blocked(embedded)) return true;
  return false;
}

function addressToV4Mapped(groups: number[]): string | null {
  if (groups.length !== 8) return null;
  if (groups.slice(0, 5).some((part) => part !== 0) || groups[5] !== 0xffff) return null;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".invalid",
  ".example",
  ".test",
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data-compute",
]);

function guardHostname(hostname: string): void {
  // Trailing dots are insignificant to resolvers but defeat suffix and
  // exact-host checks: normalize before every comparison.
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host.length === 0) throw invalid();
  const v4 = parseIPv4(host);
  if (v4 !== null) {
    if (ipv4Blocked(v4)) throw blocked();
    return;
  }
  if (host.includes(":")) {
    const groups = expandIPv6(host);
    if (groups === null) throw invalid();
    if (ipv6BlockedWithEmbedded(groups)) throw blocked();
    return;
  }
  if (BLOCKED_HOSTS.has(host)) throw blocked();
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw blocked();
  if (/^[0-9]+$/.test(host.replaceAll(".", "")) && host.includes(".")) {
    throw invalid();
  }
}

export interface ValidatedUrl {
  /** Canonical href with credentials stripped (credentials reject first). */
  href: string;
  hostname: string;
}

/**
 * Validate URL shape, scheme, credentials, port, and literal/hostname
 * policy. DNS names pass shape checks here; callers must resolve and
 * guard every address with guardResolvedIps before navigating.
 */
export function validateCaptureUrl(input: string): ValidatedUrl {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_CHARS) {
    throw invalid();
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalid();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LensError("lens/unsupported-scheme", "Only http and https captures are supported.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw invalid("Capture URL must not embed credentials.");
  }
  if (url.port !== "" && (url.port === "0" || !/^[0-9]{1,5}$/.test(url.port))) {
    throw invalid();
  }
  guardHostname(url.hostname);
  return { href: url.href, hostname: url.hostname };
}

/**
 * Guard resolved addresses (every A/AAAA answer, every redirect hop).
 * Any blocked address fails the whole set closed: public names that
 * resolve to private space are rejected, defeating rebinding setups.
 */
export function guardResolvedIps(ips: string[]): void {
  if (!Array.isArray(ips) || ips.length === 0) {
    throw blocked("Capture target did not resolve.");
  }
  for (const ip of ips) {
    if (typeof ip !== "string") throw blocked();
    const v4 = parseIPv4(ip);
    if (v4 !== null) {
      if (ipv4Blocked(v4)) throw blocked();
      continue;
    }
    const groups = expandIPv6(ip);
    if (groups === null) throw invalid();
    if (ipv6BlockedWithEmbedded(groups)) throw blocked();
  }
}

export interface DnsResolver {
  resolve(hostname: string): Promise<string[]>;
}

/**
 * Single policy-plus-resolution gate: validate the hostname, resolve it
 * with a real DNS view, and guard every answer. Navigation paths MUST
 * use this (or guardRedirectTarget) instead of validateCaptureUrl alone:
 * names are meaningless until their answers are checked, and answers
 * must be re-checked per hop because DNS can rotate between checks.
 */
export async function validateAndResolve(
  hostname: string,
  resolver: DnsResolver,
): Promise<{ hostname: string; ips: string[] }> {
  guardHostname(hostname);
  const ips = await resolver.resolve(hostname);
  guardResolvedIps(ips);
  return { hostname, ips };
}

export interface RedirectHop {
  url: ValidatedUrl;
  hopsUsed: number;
  /** Guarded answers for this hop: pin the fetch to these, no re-resolution. */
  ips: string[];
}

/**
 * Validate a redirect target against the hop budget, resolving relative
 * Locations against the current URL inside this function (callers pass
 * the raw Location and never pre-join). The target is resolved and
 * guarded before return. Fetch layers MUST additionally pin navigation
 * to a guarded answer (no second resolution) and re-resolve per hop:
 * this gate closes policy holes, not the check-to-fetch race, which
 * only pinning closes. TTL-0/per-query rotation remains a residual
 * unless the fetcher pins.
 */
export async function guardRedirectTarget(
  location: string,
  baseHref: string,
  hopsUsed: number,
  resolver: DnsResolver,
): Promise<RedirectHop> {
  if (!Number.isInteger(hopsUsed) || hopsUsed < 0 || hopsUsed >= MAX_REDIRECT_HOPS) {
    throw blocked("Redirect budget exhausted.");
  }
  let absolute: string;
  try {
    absolute = new URL(location, baseHref).href;
  } catch {
    throw invalid();
  }
  const validated = validateCaptureUrl(absolute);
  const resolved = await validateAndResolve(validated.hostname, resolver);
  return { url: validated, hopsUsed: hopsUsed + 1, ips: resolved.ips };
}

export const LENS_LIMITS = {
  maxUrlChars: MAX_URL_CHARS,
  maxRedirectHops: MAX_REDIRECT_HOPS,
} as const;
