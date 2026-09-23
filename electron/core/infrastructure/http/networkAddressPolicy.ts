import dns from 'node:dns'
import net from 'node:net'

const privateRanges = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  privateRanges.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  privateRanges.addSubnet(address, prefix, 'ipv6')
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses, including IPv4-mapped IPv6. */
export function isPrivateNetworkAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '')
  const family = net.isIP(bare)
  if (family === 0) return false
  return privateRanges.check(bare, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * dns.lookup that refuses private addresses. A hostname check alone cannot see where a public
 * name resolves (or re-resolves, via DNS rebinding); this runs at connect time, on every hop.
 */
export function publicOnlyLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const blocked = addresses.find((entry) => isPrivateNetworkAddress(entry.address))
    if (blocked) {
      const error: NodeJS.ErrnoException = new Error(
        `Access to private/local network address ${blocked.address} (resolved from ${hostname}) is forbidden (SSRF Protection).`,
      )
      error.code = 'ESSRF'
      return callback(error, '')
    }
    if (options.all) return callback(null, addresses)
    const [first] = addresses
    return callback(null, first.address, first.family)
  })
}
