import React from 'react'
import { AlertTriangle, Check, X, FileCode } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { computeLineDiff, countDiffLines, type DiffLine } from '../../../electron/core/domain/agent/diffEngine'
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
  onApprove: () => void
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

  if (!pendingApproval) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 max-w-3xl w-full shadow-2xl space-y-4">
        <div className="flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 id="approval-modal-title" className="font-bold text-lg text-slate-100">
            {t('coding.pendingApprovalTitle')}
          </h3>
        </div>

        <p className="text-xs text-slate-300">
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
            onClick={onApprove}
            aria-label={t('coding.approveBtn')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 shadow-md shadow-emerald-950/50"
          >
            <Check className="w-4 h-4" /> {t('coding.approveBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
