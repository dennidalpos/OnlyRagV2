
export function isAllowedExternalUrl(targetUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    return ['https:', 'http:', 'mailto:'].includes(target.protocol)
      && !target.username && !target.password
      && (target.protocol !== 'mailto:' || Boolean(target.pathname))
  } catch {
    return false
  }
}

export function isAllowedAppNavigation(targetUrl: string, devServerUrl?: string, packagedIndexUrl?: string): boolean {
  try {
    const target = new URL(targetUrl)
    if (target.protocol === 'file:') {
      if (!packagedIndexUrl) return false
      const index = new URL(packagedIndexUrl)
      return target.href === index.href
    }

    if (!devServerUrl) return false
    const devServer = new URL(devServerUrl)
    return target.origin === devServer.origin
  } catch {
    return false
  }
}
