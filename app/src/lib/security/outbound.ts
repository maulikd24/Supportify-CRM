import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Guards requests to customer-supplied URLs (outgoing webhooks) against SSRF: they may
 * only reach public addresses over HTTPS. Two layers:
 *  - assertPublicHttpsUrl() when the URL is saved, so the admin gets a clear error;
 *  - postJsonToPublicUrl() for every delivery, which re-checks the address the socket
 *    actually connects to (a DNS answer can change after the URL was saved — rebinding)
 *    and never follows redirects (a public URL could 302 to http://169.254.169.254/…).
 */

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(net, prefix, "ipv6");

export class UnsafeUrlError extends Error {}

/** True only for globally routable unicast addresses (no private, loopback, link-local, metadata…). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]); // IPv4-mapped IPv6 — judge the embedded IPv4
  return !BLOCKED.check(address, "ipv6");
}

function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Enter a valid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Webhook URLs must use https://");
  if (url.username || url.password) throw new UnsafeUrlError("Webhook URLs can't contain a username or password");
  return url;
}

/** Resolves every address for a hostname (IP literals resolve to themselves). */
async function resolveAll(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return [host];
  return new Promise((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, addresses: LookupAddress[]) =>
      err ? reject(new UnsafeUrlError(`Couldn't resolve ${host}`)) : resolve(addresses.map((a) => a.address)),
    ),
  );
}

/** Throws UnsafeUrlError unless `raw` is an https URL whose host resolves only to public addresses. */
export async function assertPublicHttpsUrl(raw: string): Promise<void> {
  const url = parseHttpsUrl(raw);
  const addresses = await resolveAll(url.hostname);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new UnsafeUrlError("Webhook URLs must point to a public internet address, not a private or internal one");
  }
}

/** DNS lookup for the socket itself: refuses to connect anywhere non-public, whatever the URL said. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const allowed = addresses.filter((a) => isPublicAddress(a.address));
    if (allowed.length === 0) return callback(new UnsafeUrlError(`Refused to connect to non-public address for ${hostname}`), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
};

/** POSTs a JSON body to a customer URL: https only, public addresses only, no redirects followed. */
export async function postJsonToPublicUrl(
  raw: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number }> {
  const url = parseHttpsUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP-literal hosts never hit the lookup hook, so check them here.
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError("Refused to connect to a non-public address");

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
        lookup: publicOnlyLookup,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // the body isn't needed; drain it so the socket is released
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
}
