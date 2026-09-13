
export function isAllowedAppNavigation(targetUrl: string, devServerUrl?: string): boolean {
  try {
    const target = new URL(targetUrl)
    if (target.protocol === 'file:') return true

    if (!devServerUrl) return false
    const devServer = new URL(devServerUrl)
    return target.origin === devServer.origin
  } catch {
    return false
  }
}
