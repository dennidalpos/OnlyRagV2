import path from 'node:path'
import { app } from 'electron'

/**
 * Imported first by main.ts, before any module reads userData: the logger opens its app.log when
 * its module loads, so the app name and an isolated E2E/smoke userData must already be in place.
 */

// Canonical app name across dev and packaged runs, so userData is always %APPDATA%/onlyrag-v2.
app.name = 'onlyrag-v2'

/** E2E and smoke runs: isolated userData and no Sidecar start. */
export const isElectronE2ETest = process.env.ONLYRAG_E2E_TEST === '1'

const e2eUserDataPath = process.env.ONLYRAG_E2E_USER_DATA?.trim()
if (isElectronE2ETest && e2eUserDataPath) {
  app.setPath('userData', path.resolve(e2eUserDataPath))
  app.setPath('appData', path.dirname(path.resolve(e2eUserDataPath)))
}
