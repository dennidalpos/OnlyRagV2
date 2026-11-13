import { AppSelect } from '../common/AppSelect'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Code2, Eye, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import type { ArtifactKind, ArtifactRecord, ArtifactSaveInput } from '../../types'
import { useTranslation } from '../../i18n'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

interface ArtifactPreviewPanelProps {
  workspacePath: string | null
}

const EMPTY_ARTIFACT = '<!doctype html>\n<html><body><h1>New artifact</h1></body></html>'
const NEW_DRAFT: ArtifactSaveInput = { name: 'Untitled artifact', kind: 'html', content: EMPTY_ARTIFACT }

function previewSource(artifact: ArtifactSaveInput): string {
  if (artifact.kind === 'markdown') {
    return `<pre style="white-space:pre-wrap;font:14px system-ui;color:#e2e8f0;background:#020617;padding:24px;min-height:100vh">${artifact.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`
  }
  return artifact.content
}

// Each mounted editor belongs to one workspace, including pending reads and writes.
export const ArtifactPreviewPanel: React.FC<ArtifactPreviewPanelProps> = ({ workspacePath }) => (
  <WorkspaceArtifactPanel key={workspacePath} workspacePath={workspacePath} />
)

const WorkspaceArtifactPanel: React.FC<ArtifactPreviewPanelProps> = ({ workspacePath }) => {
  const { t } = useTranslation()
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  // null allows the initial load to select the first record. A draft without an ID is an explicit choice.
  const [editor, setEditor] = useState<ArtifactSaveInput | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isWriting, setIsWriting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<{ action: 'save' | 'remove'; message: string } | null>(null)
  const scope = useRef(0)
  const read = useRef(0)
  const writing = useRef(false)
  const draft = editor ?? NEW_DRAFT
  const selectedId = draft.id
  const source = previewSource(draft)

  useLayoutEffect(
    () => () => {
      scope.current += 1
    },
    [],
  )

  const loadArtifacts = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.listArtifacts || writing.current) return
    const generation = scope.current
    const request = ++read.current
    const isCurrent = () => generation === scope.current && request === read.current
    setIsLoading(true)
    try {
      const next = await window.electronAPI.listArtifacts({ workspacePath })
      if (!isCurrent()) return
      setReadError(null)
      setArtifacts(next)
      setEditor((current) => current ?? next[0] ?? NEW_DRAFT)
    } catch (err: unknown) {
      if (isCurrent()) setReadError(errorMessage(err))
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void loadArtifacts()
  }, [loadArtifacts])

  const selectArtifact = (artifact: ArtifactRecord) => {
    setWriteError(null)
    setEditor(artifact)
  }

  const createArtifact = () => {
    setWriteError(null)
    setEditor(NEW_DRAFT)
  }

  const updateDraft = (changes: Partial<ArtifactSaveInput>) => {
    setEditor((current) => ({ ...(current ?? NEW_DRAFT), ...changes }))
  }

  const writeArtifact = async (action: 'save' | 'remove', write: (isCurrent: () => boolean) => Promise<void>) => {
    if (writing.current) return
    const generation = scope.current
    const isCurrent = () => generation === scope.current
    writing.current = true
    ++read.current
    setIsLoading(false)
    setIsWriting(true)
    setWriteError(null)
    try {
      await write(isCurrent)
    } catch (err: unknown) {
      if (isCurrent()) setWriteError({ action, message: errorMessage(err) })
    } finally {
      if (isCurrent()) {
        writing.current = false
        setIsWriting(false)
      }
    }
  }

  const save = () => {
    const api = window.electronAPI
    if (!workspacePath || !api?.saveArtifact || !draft.name.trim()) return
    const { id, name, kind, content } = draft
    void writeArtifact('save', async (isCurrent) => {
      const saved = await api.saveArtifact({ workspacePath, input: { id, name, kind, content } })
      if (!isCurrent()) return
      setArtifacts((current) => [saved, ...current.filter((artifact) => artifact.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setEditor(saved)
    })
  }

  const remove = () => {
    const api = window.electronAPI
    if (!workspacePath || !selectedId || !api?.deleteArtifact) return
    void writeArtifact('remove', async (isCurrent) => {
      if (!(await api.deleteArtifact({ workspacePath, artifactId: selectedId })) || !isCurrent()) return
      setArtifacts((current) => current.filter((artifact) => artifact.id !== selectedId))
      createArtifact()
    })
  }
  const retry = writeError?.action === 'save' ? save : writeError?.action === 'remove' ? remove : () => void loadArtifacts()
  const storeError = writeError?.message ?? readError

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-200">
      <div className="min-h-12 px-3 py-2 border-b border-slate-800 flex flex-wrap items-center gap-2 shrink-0">
        <Eye className="w-4 h-4 text-cyan-400" />
        <span className="font-semibold text-sm">Live Preview</span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={createArtifact}
            disabled={isWriting || !workspacePath}
            className="px-2 py-1 rounded border border-slate-700 text-xs hover:text-white disabled:opacity-40"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            {t('codingPanels.artifactNew')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isWriting || isLoading || !workspacePath || !draft.name.trim()}
            className="px-2 py-1 rounded bg-cyan-600 text-slate-950 text-xs font-semibold disabled:opacity-40"
          >
            <Save className="w-3 h-3 inline mr-1" />
            {t('codingPanels.artifactSave')}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={isWriting || isLoading || !selectedId}
            className="px-2 py-1 rounded border border-red-900/70 text-red-300 text-xs disabled:opacity-40"
          >
            <Trash2 className="w-3 h-3 inline mr-1" />
            {t('codingPanels.artifactDelete')}
          </button>
        </div>
      </div>
      {!workspacePath ? (
        <div className="p-6 text-sm text-slate-400">{t('uiShell.artifactsNeedWorkspace')}</div>
      ) : (
        <div className="relative flex-1 min-h-0 flex">
          {storeError && (
            <div role="alert" className="absolute inset-x-0 top-12 z-10 flex items-center gap-2 bg-red-950/80 px-4 py-2 text-xs text-red-200">
              <span className="flex-1 min-w-0 break-words">
                {t('uiShell.artifactsError')} {storeError}
              </span>
              <button
                type="button"
                onClick={retry}
                disabled={isWriting || isLoading || (writeError?.action === 'save' && !draft.name.trim())}
                className="px-2 py-1 rounded border border-red-700 hover:text-white disabled:opacity-40 focus-ring"
              >
                {t('uiShell.artifactsRetry')}
              </button>
            </div>
          )}
          <aside aria-busy={isLoading} className="w-[28%] max-w-56 shrink-0 border-r border-slate-800 p-2 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0 truncate text-[10px] uppercase tracking-wider text-slate-500">{t('codingPanels.artifacts')}</div>
              <button
                type="button"
                onClick={() => void loadArtifacts()}
                disabled={isWriting || isLoading}
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-40 focus-ring"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            {artifacts.length === 0 && !readError && <div className="text-xs text-slate-500">{t(isLoading ? 'common.loading' : 'uiShell.noArtifacts')}</div>}
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                disabled={isWriting}
                aria-pressed={artifact.id === selectedId}
                onClick={() => selectArtifact(artifact)}
                className={`w-full text-left rounded px-2 py-2 mb-1 text-xs ${artifact.id === selectedId ? 'bg-cyan-950/60 text-cyan-200' : 'text-slate-400 hover:bg-slate-900'}`}
              >
                <Code2 className="w-3 h-3 inline mr-1" />
                {artifact.name}
                <span className="block pl-4 text-[10px] text-slate-500">{artifact.kind}</span>
              </button>
            ))}
          </aside>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="p-2 border-b border-slate-800 grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)] gap-2">
              <input
                value={draft.name}
                readOnly={isWriting}
                onChange={(event) => updateDraft({ name: event.target.value })}
                className="min-w-0 flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                aria-label={t('codingPanels.artifactName')}
              />
              <AppSelect
                compact
                value={draft.kind}
                disabled={isWriting}
                onChange={(event) => updateDraft({ kind: event.target.value as ArtifactKind })}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                aria-label={t('codingPanels.artifactKind')}
              >
                <option value="html">HTML</option>
                <option value="svg">SVG</option>
                <option value="markdown">Markdown</option>
              </AppSelect>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-slate-800">
              <textarea
                value={draft.content}
                readOnly={isWriting}
                onChange={(event) => updateDraft({ content: event.target.value })}
                className="min-w-0 min-h-0 resize-none bg-slate-950 p-3 font-mono text-xs text-slate-300 focus-ring"
                aria-label={t('codingPanels.artifactContent')}
                spellCheck={false}
              />
              <iframe
                title={`Anteprima ${draft.name}`}
                sandbox=""
                srcDoc={source}
                onLoad={({ currentTarget: frame }) => {
                  // Chromium can commit srcdoc without laying it out. Reattach its layout after navigation.
                  frame.style.display = 'none'
                  frame.getBoundingClientRect()
                  frame.style.removeProperty('display')
                }}
                className="w-full h-full bg-white border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
