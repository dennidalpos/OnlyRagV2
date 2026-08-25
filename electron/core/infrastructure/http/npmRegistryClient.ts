/**
 * npm Registry Client.
 *
 * Answers the two questions a small model cannot: **does this package exist**, and **what
 * version is current**. Both come from the registry itself, verbatim, for the same reason
 * `npmResolutionConflict.ts` copies npm's version range instead of composing one — the service
 * that knows is a better source than anything inferred.
 *
 * Why it exists, measured across the live runs of 2026-08-25. Every version a 7B writes comes
 * out of its training data, and the runs show what that costs: `typescript@^4.7.3`, which could
 * not parse the `@types/node` npm had just installed and took run 10 to 0/12; `vite@^4.0.0`,
 * `react@^18.2.0` and `tailwindcss@^3.3.3`, all years behind; `@vitejs/plugin-react@6.1.0`,
 * whose pin produced repeated ERESOLVE conflicts; and `@tailwindcss/react` and
 * `react-tailwindcss@^0.0.1`, which **do not exist on npm at all** and were ordered thirteen
 * times across the series before the failure threshold stopped them.
 *
 * A model with a knowledge cutoff cannot know any of this, and no prompt wording fixes it. One
 * HTTP GET does.
 */

import { logger } from '../../../diagnostics'

export interface PackageFacts {
  name: string
  /** Absent when the registry does not know this package at all (HTTP 404). */
  latest?: string
  exists: boolean
}

const REGISTRY = 'https://registry.npmjs.org'

/** Registry answers do not change inside one agent session, and each lookup costs a round trip. */
const cache = new Map<string, PackageFacts>()

/** A scoped or plain package name, rejecting anything that is not one. */
const VALID_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i

export class NpmRegistryClient {
  /**
   * Looks a package up, once per session.
   *
   * A network failure answers `exists: true` with no version: unreachable is not the same as
   * non-existent, and reporting "this package does not exist" because the wifi dropped would
   * send the agent deleting a correct import. Silence is the safe answer here.
   */
  async lookup(name: string, timeoutMs = 5000): Promise<PackageFacts> {
    if (!VALID_NAME.test(name)) return { name, exists: false }
    const cached = cache.get(name)
    if (cached) return cached

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}/latest`, { signal: controller.signal })
      if (res.status === 404) {
        const missing: PackageFacts = { name, exists: false }
        cache.set(name, missing)
        return missing
      }
      if (!res.ok) return { name, exists: true }
      const body = (await res.json()) as { version?: string }
      const facts: PackageFacts = { name, exists: true, latest: typeof body?.version === 'string' ? body.version : undefined }
      cache.set(name, facts)
      return facts
    } catch (err: any) {
      logger.log('WARN', 'NpmRegistry', `Lookup failed for ${name}: ${err?.message}`)
      return { name, exists: true }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Looks up several packages concurrently, preserving input order. */
  async lookupAll(names: string[], timeoutMs = 5000): Promise<PackageFacts[]> {
    return Promise.all(names.map((name) => this.lookup(name, timeoutMs)))
  }

  /** Test seam: the cache is process-wide and would otherwise leak between cases. */
  clearCache(): void {
    cache.clear()
  }
}

export const npmRegistryClient = new NpmRegistryClient()
