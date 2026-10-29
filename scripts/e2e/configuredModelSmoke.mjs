import path from 'node:path'
import os from 'node:os'
import { loadConfiguredModelSmoke } from './loadConfiguredModelSmoke.mjs'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--session-dir' || args[2] !== '--roles' || !path.isAbsolute(args[1])) {
  throw new Error('Usage: npm run test:models:smoke -- --session-dir <absolute shared work-session directory> --roles chat,translation,coding,embedding')
}
const { runConfiguredModelSmoke } = await loadConfiguredModelSmoke()
const settingsFile = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'onlyrag-v2/settings.json')
const result = await runConfiguredModelSmoke({ sessionDirectory: args[1], settingsFile, roles: args[3].split(',') })
console.log(`Functional smoke completed. Evidence: ${result.runDirectory}`)
