import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/** Compile the shared TypeScript harness with the project's installed Vite, without writing build output. */
export async function loadConfiguredModelSmoke() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const bundled = await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      ssr: true,
      write: false,
      minify: false,
      target: 'node24',
      lib: { entry: path.join(root, 'scripts/e2e/configuredModelSmokeCore.ts'), formats: ['es'] },
    },
  })
  const output = (Array.isArray(bundled) ? bundled[0] : bundled).output
  const code = output.find((file) => file.type === 'chunk')?.code
  if (!code) throw new Error('Smoke harness compilation produced no module')
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
