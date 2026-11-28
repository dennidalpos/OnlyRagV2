import path from 'node:path'
import { app } from 'electron'

export const distributionLicenseRepository = {
  getDirectory: (): string =>
    app.isPackaged ? path.join(process.resourcesPath, 'licenses') : path.join(__dirname, '..', 'docs', 'licenses', 'agpl-route-2026-10-10'),
}
