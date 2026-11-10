import dns from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrivateNetworkAddress, publicOnlyLookup } from './networkAddressPolicy'
import { WebClient } from './webClient'

describe('isPrivateNetworkAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (ip) => expect(isPrivateNetworkAddress(ip)).toBe(true))

  it.each(['93.184.216.34', '2606:4700::1111', 'example.com'])('allows %s', (value) => {
    expect(isPrivateNetworkAddress(value)).toBe(false)
  })
})

describe('publicOnlyLookup', () => {
  afterEach(() => vi.restoreAllMocks())

  const resolveTo = (addresses: dns.LookupAddress[]) =>
    vi
      .spyOn(dns, 'lookup')
      .mockImplementation(((_host: string, _opts: unknown, cb: (err: null, a: dns.LookupAddress[]) => void) =>
        cb(null, addresses)) as unknown as typeof dns.lookup)

  it('refuses a public hostname that resolves to a loopback address (DNS rebinding)', async () => {
    resolveTo([{ address: '127.0.0.1', family: 4 }])
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup('rebind.example', {}, (err) => resolve(err)))
    expect(error?.code).toBe('ESSRF')
  })

  it('refuses a mixed DNS answer even when its first address is public', async () => {
    resolveTo([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    const result = await new Promise<unknown[]>((resolve) => publicOnlyLookup('mixed.example', { all: true }, (...args) => resolve(args)))
    expect((result[0] as NodeJS.ErrnoException).code).toBe('ESSRF')
    expect(result[1]).toBe('')
  })

  it('passes DNS lookup failures to the caller without returning an address', async () => {
    const failure: NodeJS.ErrnoException = Object.assign(new Error('DNS unavailable'), { code: 'ENOTFOUND' })
    vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException) => void) =>
      cb(failure)) as unknown as typeof dns.lookup)
    const result = await new Promise<unknown[]>((resolve) => publicOnlyLookup('missing.example', {}, (...args) => resolve(args)))
    expect(result).toEqual([failure, ''])
  })

  it.each([{}, { all: true }])('returns an error for an empty DNS answer with options %j', async (options) => {
    resolveTo([])
    const result = await new Promise<unknown[]>((resolve) => publicOnlyLookup('empty.example', options, (...args) => resolve(args)))
    expect((result[0] as NodeJS.ErrnoException).code).toBe('ENOTFOUND')
    expect(result[1]).toBe('')
  })

  it('passes public addresses through in the shape the caller asked for', async () => {
    resolveTo([{ address: '93.184.216.34', family: 4 }])
    const single = await new Promise<unknown[]>((resolve) => publicOnlyLookup('example.com', {}, (...args) => resolve(args)))
    expect(single).toEqual([null, '93.184.216.34', 4])
    const all = await new Promise<unknown[]>((resolve) => publicOnlyLookup('example.com', { all: true }, (...args) => resolve(args)))
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]])
  })
})

describe('WebClient.validateUrlSafety IP literals', () => {
  const client = new WebClient()

  it.each(['http://[::1]:8000/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://100.64.1.1/'])('blocks %s', (url) => {
    expect(client.validateUrlSafety(url).safeUrl).toBeNull()
  })
})
