import React from 'react'
import { Modal } from '../common/Modal'
import { AlertTriangle, Check, X, FileCode } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { computeLineDiff, countDiffLines, groupDiffIntoHunks, type DiffLine, type DiffHunkGroup } from '../../../electron/core/domain/agent/diffEngine'
import { projectPendingChange, type PendingMutationType } from '../../../electron/core/domain/agent/pendingChangeProjection'
import { DiffLinesView, ChangeCounts } from './DiffLinesView'

interface PendingApproval {
  sessionId: string
  type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd' | 'git_commit'
  target: string
  contentOrCmd: string
  replacement?: string
  replacements?: { targetContent: string; replacementContent: string }[]
  parameters?: Record<string, any>
}

interface PendingApprovalModalProps {
  pendingApproval: PendingApproval | null
  /** Called with no args for a full accept (or a non-file-mutation action); with the approved hunk ids for a partial accept. */
  onApprove: (approvedHunkIndices?: number[]) => void
  onReject: () => void
}

/** The action types whose effect on a file can be shown as a before/after diff. */
const FILE_MUTATION_TYPES: PendingApproval['type'][] = ['write_file', 'replace_chunk', 'multi_replace', 'delete_file']

export const PendingApprovalModal: React.FC<PendingApprovalModalProps> = ({
  pendingApproval,
  onApprove,
  onReject,
}) => {
  const { t } = useTranslation()
  const [currentContent, setCurrentContent] = React.useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = React.useState<boolean>(false)

  const isFileMutation = Boolean(pendingApproval && FILE_MUTATION_TYPES.includes(pendingApproval.type))
  const targetPath = pendingApproval?.parameters?.filePath || pendingApproval?.target || ''

  // ESC Key Listener for Accessibility
  React.useEffect(() => {
    if (!pendingApproval) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onReject()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pendingApproval, onReject])

  // Load the file as it exists on disk right now, so the modal shows the real before/after
  // rather than only the replacement text. A file that does not exist yet reads as empty,
  // which renders the proposal as a pure addition.
  React.useEffect(() => {
    let cancelled = false
    if (!pendingApproval || !isFileMutation || !targetPath) {
      setCurrentContent(null)
      return
    }

    setIsLoadingContent(true)
    const load = async () => {
      let content = ''
      try {
        const res = await window.electronAPI?.readWorkspaceFile?.(targetPath)
        if (res?.success && typeof res.content === 'string') content = res.content
      } catch {
        content = ''
      }
      if (!cancelled) {
        setCurrentContent(content)
        setIsLoadingContent(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [pendingApproval, isFileMutation, targetPath])

  const diffLines: DiffLine[] = React.useMemo(() => {
    if (!pendingApproval || !isFileMutation || currentContent === null) return []
    return computeLineDiff(
      currentContent,
      projectPendingChange(
        {
          type: pendingApproval.type as PendingMutationType,
          content: String(pendingApproval.parameters?.content ?? pendingApproval.contentOrCmd ?? ''),
          targetContent: pendingApproval.contentOrCmd,
          replacementContent: pendingApproval.replacement,
          replacements: pendingApproval.replacements,
        },
        currentContent
      )
    )
  }, [pendingApproval, isFileMutation, currentContent])

  const counts = React.useMemo(() => countDiffLines(diffLines), [diffLines])

  const hunks: DiffHunkGroup[] = React.useMemo(() => groupDiffIntoHunks(diffLines), [diffLines])
  const [selectedHunkIds, setSelectedHunkIds] = React.useState<Set<number>>(new Set())

  // Default every new proposal to "everything selected" — a single click on Approve still
  // behaves exactly like the old all-or-nothing flow unless the user deliberately unchecks a hunk.
  React.useEffect(() => {
    setSelectedHunkIds(new Set(hunks.map((h) => h.id)))
  }, [hunks])

  const toggleHunk = (id: number) => {
    setSelectedHunkIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const showPerHunkSelection = hunks.length > 1
  const allHunksSelected = selectedHunkIds.size >= hunks.length
  const canApprove = !showPerHunkSelection || selectedHunkIds.size > 0

  const handleApproveClick = () => {
    // A full accept is sent as "no hunk list" so the executor keeps the original tool's own
    // semantics (e.g. delete_file stays a real delete instead of becoming an empty write_file).
    onApprove(showPerHunkSelection && !allHunksSelected ? Array.from(selectedHunkIds) : undefined)
  }

  if (!pendingApproval) return null

  return (
    <Modal
      isOpen={Boolean(pendingApproval)}
      onClose={onReject}
      labelledById="approval-modal-title"
      layer="approval"
      dismissible={false}
      panelClassName="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 max-w-3xl shadow-2xl space-y-4 overflow-y-auto max-h-[85vh]"
    >
        <div className="flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 id="approval-modal-title" className="font-bold text-lg text-slate-100">
            {t('coding.pendingApprovalTitle')}
          </h3>
        </div>

        <p id="approval-modal-desc" className="text-xs text-slate-300">
          {t('coding.pendingApprovalDesc')}
        </p>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-slate-300 truncate">
              {t('common.actions')}: <span className="text-amber-300 font-bold uppercase">{pendingApproval.type}</span>
            </div>
            {isFileMutation && diffLines.length > 0 && <ChangeCounts additions={counts.additions} deletions={counts.deletions} />}
          </div>
          <div className="text-slate-300 truncate">
            Target: <span className="text-slate-200 font-bold">{pendingApproval.target}</span>
          </div>

          {isFileMutation ? (
            <div className="mt-2 rounded border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-900 border-b border-slate-800">
                <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-[11px] text-slate-300 truncate">{targetPath}</span>
              </div>
              {isLoadingContent ? (
                <div className="px-3 py-3 text-[11px] text-slate-400 italic">Calcolo del diff in corso…</div>
              ) : diffLines.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-slate-400 italic">
                  Nessuna differenza rilevata rispetto al contenuto attuale del file.
                </div>
              ) : showPerHunkSelection ? (
                <div className="max-h-72 overflow-auto divide-y divide-slate-800/60">
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-900/70 text-[10px] text-slate-400 sticky top-0">
                    <span>{selectedHunkIds.size}/{hunks.length} modifiche selezionate</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setSelectedHunkIds(new Set(hunks.map((h) => h.id)))} className="text-cyan-400 hover:text-cyan-300 font-semibold">
                        Tutte
                      </button>
                      <button type="button" onClick={() => setSelectedHunkIds(new Set())} className="text-slate-400 hover:text-slate-300 font-semibold">
                        Nessuna
                      </button>
                    </div>
                  </div>
                  {hunks.map((hunk) => {
                    const hunkCounts = countDiffLines(hunk.lines)
                    return (
                      <div key={hunk.id}>
                        <label className="flex items-center gap-2 px-2.5 py-1 bg-slate-900/40 cursor-pointer select-none hover:bg-slate-900/70">
                          <input
                            type="checkbox"
                            checked={selectedHunkIds.has(hunk.id)}
                            onChange={() => toggleHunk(hunk.id)}
                            className="accent-emerald-500"
                          />
                          <span className="text-[10px] text-slate-400">Modifica {hunk.id + 1}/{hunks.length}</span>
                          <ChangeCounts additions={hunkCounts.additions} deletions={hunkCounts.deletions} />
                        </label>
                        <DiffLinesView lines={hunk.lines} />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="max-h-72 overflow-auto">
                  <DiffLinesView lines={diffLines} collapse contextRadius={3} />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap bg-slate-900 p-2.5 rounded border border-slate-800">
              {pendingApproval.type === 'download_file' ? (
                <div>
                  <div className="text-sky-400 text-[10px] uppercase font-bold">Source URL:</div>
                  <div className="text-slate-200 mb-2 break-all">{pendingApproval.contentOrCmd}</div>
                  <div className="text-amber-400 text-[10px] uppercase font-bold">Destination:</div>
                  <div className="text-emerald-300">{pendingApproval.target}</div>
                </div>
              ) : pendingApproval.type === 'git_commit' ? (
                <div>
                  <div className="text-amber-400 text-[10px] uppercase font-bold">Commit Message:</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{pendingApproval.contentOrCmd}</div>
                </div>
              ) : (
                pendingApproval.contentOrCmd
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onReject}
            aria-label={t('coding.rejectBtn')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5"
          >
            <X className="w-4 h-4 text-slate-400" /> {t('coding.rejectBtn')}
          </button>
          <button
            type="button"
            onClick={handleApproveClick}
            disabled={!canApprove}
            aria-label={t('coding.approveBtn')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 shadow-md shadow-emerald-950/50"
          >
            <Check className="w-4 h-4" /> {t('coding.approveBtn')}
          </button>
        </div>
    </Modal>
  )
}
