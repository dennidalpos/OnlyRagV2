import { describe, expect, it } from 'vitest'
import { isBlockingDevServerCommand } from './commandPolicy'

describe('dev server and watcher detection', () => {
  it('lets one-shot checks run, including explicit watch=false', () => {
    for (const command of [
      'jest --runInBand',
      'npx jest',
      'jest --watchAll=false',
      'vitest --watch=false',
      'npx vitest run',
      'npx tsc --noEmit',
      'npx vite build',
      'npm run build && npm test',
      'npm run build -w packages/app',
    ]) {
      expect(isBlockingDevServerCommand(command), command).toBe(false)
    }
  })

  it('refuses commands that never exit', () => {
    for (const command of [
      'tsc --watch',
      'npx tsc -w',
      'jest --watchAll',
      'npm run test -- --watch',
      'vite --port 3000',
      'npx vite',
      'uvicorn app:app --reload',
      'dotnet run',
      'node server.js',
      'npx serve dist',
      'python manage.py runserver',
    ]) {
      expect(isBlockingDevServerCommand(command), command).toBe(true)
    }
  })
})
