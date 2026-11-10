import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { missingAcceptanceDirectories, unreachableUiDeliverables } from './workspaceUiReachability'

describe('workspace UI reachability', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects an unused layout and duplicate page while accepting a unique reachable extension alias', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-reachability-'))
    roots.push(root)
    const write = (relative: string, content: string) => {
      const target = path.join(root, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
    }
    write('index.html', '<script type="module" src="/src/main.tsx"></script>')
    write('src/main.tsx', "import './routes'\n")
    write('src/routes.tsx', "import './pages/DashboardPage'\nimport './pages/Tasks'\n")
    write('src/pages/DashboardPage.tsx', 'export const DashboardPage = () => null')
    write('src/pages/Dashboard.jsx', 'export const Dashboard = () => null')
    write('src/pages/Tasks.tsx', 'export const Tasks = () => null')
    write('src/components/Layout.tsx', 'export const Layout = () => null')
    write('src/index.js', 'export const unused = true')

    expect(unreachableUiDeliverables(root, { title: 'Navigation', filePaths: ['src/components/Layout.tsx'] })).toEqual(['src/components/Layout.tsx'])
    expect(unreachableUiDeliverables(root, { title: 'Dashboard', filePaths: ['src/pages/Dashboard.jsx'] })).toEqual(['src/pages/Dashboard.jsx'])
    expect(unreachableUiDeliverables(root, { title: 'Tasks', filePaths: ['src/pages/Tasks.jsx'] })).toEqual([])
    expect(unreachableUiDeliverables(root, { title: 'Entrypoint', filePaths: ['src/index.js'] })).toEqual(['src/index.js'])
    expect(missingAcceptanceDirectories(root, { acceptanceCriteria: ['Directories created: src/pages, src/components/ui, src/services.'] })).toEqual([
      'src/components/ui',
      'src/services',
    ])
  })
})
