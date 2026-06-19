// ============================================================================
// Subnet Detection
//
// Reads local network interfaces to discover which /24 subnets the agent is
// on. Only private RFC 1918 ranges are returned — the agent never scans
// public internet addresses.
// ============================================================================

import os from 'node:os'
import { isPrivateIp } from '../config.js'

// Returns an array of /24 base addresses to scan, e.g. ['192.168.1', '10.0.0']
export function detectLocalSubnets() {
  const subnets = new Set()

  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!isPrivateIp(addr.address)) continue
      // Derive /24 base (first 3 octets)
      const base = addr.address.split('.').slice(0, 3).join('.')
      subnets.add(base)
    }
  }

  return [...subnets]
}

// Returns all host IPs in a /24 subnet (.1 to .254)
export function hostsInSubnet(base24) {
  const hosts = []
  for (let i = 1; i <= 254; i++) hosts.push(`${base24}.${i}`)
  return hosts
}

// If a user provides a custom range (e.g. "192.168.5.0/24" or "10.10.0.0/24"),
// parse it and return the /24 base.
export function parseScanRange(scanRange) {
  if (!scanRange) return null
  const match = scanRange.trim().match(/^(\d+\.\d+\.\d+)\.\d+(?:\/24)?$/)
  if (!match) return null
  const base = match[1]
  // Security: only allow private ranges
  if (!isPrivateIp(`${base}.1`)) {
    console.warn(`[discovery] Rejected non-private scan range: ${scanRange}`)
    return null
  }
  return base
}
