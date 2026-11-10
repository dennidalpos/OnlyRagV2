import path from 'node:path'
import { app } from 'electron'

/** Electron's userData, or the repository-local `userdata_dev` store when running headless (tests, live harness). */
export function userDataRoot(): string {
  return app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), 'userdata_dev')
}

/** Session store for runs without a usable workspace, so no store writes to the user's home folder. */
export function userDataSessionsDir(): string {
  return path.join(userDataRoot(), 'sessions')
}
