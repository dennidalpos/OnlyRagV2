import { describe, expect, it } from 'vitest'
import {
  extractDeliverablePaths,
  isDeliverableOfMilestone,
  isPlaceholderContent,
  resolveMilestoneDeliverableStatus,
  type DeliverableProbe,
} from './milestoneDeliverableResolver'

/** Builds a probe backed by an in-memory {path: content} map. */
function probeFrom(files: Record<string, string>): DeliverableProbe {
  return (relativePath: string) => {
    const content = files[relativePath]
    return { exists: content !== undefined, contentLength: content?.length ?? 0, content }
  }
}

describe('extractDeliverablePaths', () => {
  it('extracts a backtick-wrapped nested path', () => {
    expect(extractDeliverablePaths('Create `src/components/Sidebar.tsx` for the sidebar component.')).toEqual([
      'src/components/Sidebar.tsx',
    ])
  })

  it('extracts a bare config file at the workspace root', () => {
    expect(extractDeliverablePaths('m-1: Initialize the project with package.json')).toEqual(['package.json'])
  })

  it('extracts multiple deliverables preserving first-seen order without duplicates', () => {
    expect(extractDeliverablePaths('Wire src/App.tsx to src/pages/Tasks.tsx and re-export src/App.tsx')).toEqual([
      'src/App.tsx',
      'src/pages/Tasks.tsx',
    ])
  })

  it('normalises Windows separators and a leading ./ to workspace-relative form', () => {
    expect(extractDeliverablePaths('Create .\\src\\utils\\helpers.ts')).toEqual(['src/utils/helpers.ts'])
  })

  it('ignores version numbers so they are never probed as files', () => {
    expect(extractDeliverablePaths('Install React 18.2 and Vite 4.0.0')).toEqual([])
  })

  it('returns nothing for a milestone that names no artefact', () => {
    expect(extractDeliverablePaths('Design the two-column dashboard layout for tablet.')).toEqual([])
  })

  it('ignores a bare extension glob that identifies no target', () => {
    expect(extractDeliverablePaths('Format every *.tsx file in the project')).toEqual([])
  })

  it('returns an empty list for empty or non-string input', () => {
    expect(extractDeliverablePaths('')).toEqual([])
    expect(extractDeliverablePaths(undefined as unknown as string)).toEqual([])
  })
})

describe('resolveMilestoneDeliverableStatus', () => {
  it('reports satisfied when every referenced file exists with content', () => {
    const probe = probeFrom({ 'src/App.tsx': 'export function App() {}' })
    expect(resolveMilestoneDeliverableStatus('Assemble `src/App.tsx`', probe)).toBe('satisfied')
  })

  it('reports unsatisfied when one of several deliverables is missing', () => {
    const probe = probeFrom({ 'src/App.tsx': 'export function App() {}' })
    expect(resolveMilestoneDeliverableStatus('Wire src/App.tsx and src/pages/Tasks.tsx', probe)).toBe('unsatisfied')
  })

  it('reports unsatisfied for a file created but left empty', () => {
    const probe = probeFrom({ 'src/App.tsx': '' })
    expect(resolveMilestoneDeliverableStatus('Assemble src/App.tsx', probe)).toBe('unsatisfied')
  })

  it('reports not_applicable when the milestone names no file', () => {
    expect(resolveMilestoneDeliverableStatus('Validate the interface at 320px and 1440px.', probeFrom({}))).toBe(
      'not_applicable'
    )
  })

  it('never advances on a false-positive path token that does not exist on disk', () => {
    expect(resolveMilestoneDeliverableStatus('Set up the Node.js toolchain', probeFrom({}))).toBe('unsatisfied')
  })
})

describe('isDeliverableOfMilestone', () => {
  const title = 'Create `src/components/Sidebar.tsx` for the sidebar component.'

  it('recognises a write that lands on the milestone own deliverable', () => {
    expect(isDeliverableOfMilestone(title, 'src/components/Sidebar.tsx')).toBe(true)
  })

  it('accepts the absolute path a tool result reports', () => {
    expect(isDeliverableOfMilestone(title, 'C:\\Users\\dev\\app\\src\\components\\Sidebar.tsx')).toBe(true)
  })

  it('rejects a write to an unrelated file', () => {
    // The regression from session-1787476734227-nkn0: writing App.tsx closed whichever
    // milestone happened to be active, including "Run the application".
    expect(isDeliverableOfMilestone(title, 'src/App.tsx')).toBe(false)
  })

  it('rejects a different file whose name merely ends similarly', () => {
    expect(isDeliverableOfMilestone(title, 'src/legacy/OldSidebar.tsx')).toBe(false)
  })

  it('rejects any write for a milestone that names no deliverable', () => {
    expect(isDeliverableOfMilestone('Run the application to ensure it is runnable.', 'src/App.tsx')).toBe(false)
  })

  it('rejects an absent path', () => {
    expect(isDeliverableOfMilestone(title, undefined)).toBe(false)
    expect(isDeliverableOfMilestone(title, '')).toBe(false)
  })
})

describe('isPlaceholderContent', () => {
  it('rejects an empty or near-empty file', () => {
    expect(isPlaceholderContent('')).toBe(true)
    expect(isPlaceholderContent('   \n\n ')).toBe(true)
    expect(isPlaceholderContent('{}')).toBe(true)
  })

  it('rejects a file that is nothing but comments', () => {
    expect(isPlaceholderContent('// TODO: implement the sidebar component')).toBe(true)
    expect(isPlaceholderContent('# placeholder for the ingest pipeline\n# fill this in later')).toBe(true)
    expect(isPlaceholderContent('/*\n * Sidebar\n */')).toBe(true)
  })

  it('rejects a one-liner whose only content is a deferral marker', () => {
    expect(isPlaceholderContent('export default function App() { /* TODO */ }')).toBe(true)
    expect(isPlaceholderContent('def build_report():\n    raise NotImplementedError("TODO")')).toBe(true)
  })

  it('accepts a short but real implementation', () => {
    expect(isPlaceholderContent("export * from './Sidebar'")).toBe(false)
    expect(isPlaceholderContent('{\n  "name": "app",\n  "version": "1.0.0"\n}')).toBe(false)
  })

  it('accepts real code that merely mentions a marker in passing', () => {
    const realFile = [
      'import { useState } from "react"',
      '',
      'export function Counter() {',
      '  const [n, setN] = useState(0)',
      '  // TODO: persist this across reloads',
      '  return <button onClick={() => setN(n + 1)}>{n}</button>',
      '}',
    ].join('\n')
    expect(isPlaceholderContent(realFile)).toBe(false)
  })

  it('does not mistake a word that merely contains a marker for a marker', () => {
    expect(isPlaceholderContent('const stubbornRetries = 3\nexport default stubbornRetries')).toBe(false)
  })
})

describe('resolveMilestoneDeliverableStatus — placeholder deliverables', () => {
  it('refuses to satisfy a milestone whose deliverable is a stub', () => {
    const probe = probeFrom({ 'src/components/Sidebar.tsx': '// TODO: implement the sidebar' })
    expect(resolveMilestoneDeliverableStatus('m-2: Create `src/components/Sidebar.tsx`', probe)).toBe('unsatisfied')
  })

  it('satisfies the same milestone once the file holds real code', () => {
    const probe = probeFrom({
      'src/components/Sidebar.tsx': 'export function Sidebar() {\n  return <aside>Navigation</aside>\n}',
    })
    expect(resolveMilestoneDeliverableStatus('m-2: Create `src/components/Sidebar.tsx`', probe)).toBe('satisfied')
  })

  it('refuses when only one of several deliverables is a stub', () => {
    const probe = probeFrom({
      'src/App.tsx': 'export function App() {\n  return <Sidebar />\n}',
      'src/components/Sidebar.tsx': '// TODO',
    })
    expect(resolveMilestoneDeliverableStatus('Wire src/App.tsx to src/components/Sidebar.tsx', probe)).toBe('unsatisfied')
  })

  it('leaves large files alone when the probe supplies no content to inspect', () => {
    const probe: DeliverableProbe = () => ({ exists: true, contentLength: 8192 })
    expect(resolveMilestoneDeliverableStatus('Create src/App.tsx', probe)).toBe('satisfied')
  })
})
