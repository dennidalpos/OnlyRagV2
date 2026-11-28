/** Classifies a hostname returned by URL, without DNS resolution or mapped-address expansion. */
export function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())
}
