import { describe, expect, it } from 'vitest'
import {
  extractDeliverablePaths,
  isDeliverableOfMilestone,
  resolveMilestoneDeliverableStatus,
  type DeliverableProbe,
} from './milestoneDeliverableResolver'

/** Builds a probe backed by an in-memory {path: content} map. */
function probeFrom(files: Record<string, string>): DeliverableProbe {
  return (relativePath: string) => {
    const content = files[relativePath]
    return { exists: content !== undefined, contentLength: content?.length ?? 0 }
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
