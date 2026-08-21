import React from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { FileCode2, ChevronRight, Copy, Check } from 'lucide-react'
import { AppSettings } from '../../types'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { useTranslation } from '../../i18n'
import { getLanguageFromExtension, getBreadcrumbParts } from './codingEditorUtils'

interface CodingEditorContentProps {
  c: ReturnType<typeof useCodingAgent>
  settings?: AppSettings
  isDiffMode: boolean
  copiedPath: boolean
  onCopyPath: () => void
  onShowWorkspaceSidebar: () => void
}

export const CodingEditorContent: React.FC<CodingEditorContentProps> = ({
  c,
  settings,
  isDiffMode,
  copiedPath,
  onCopyPath,
  onShowWorkspaceSidebar,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0d121d] relative">
      {/* Breadcrumbs Navigation Bar */}
      {c.selectedFile && (
        <div className="px-4 py-1.5 bg-[#0e131f] border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-1 truncate">
            {getBreadcrumbParts(c.selectedFile.path, t('common.noFileOpen')).map((part, idx, arr) => (
              <React.Fragment key={idx}>
                <span className={idx === arr.length - 1 ? 'text-slate-200 font-semibold' : 'text-slate-400'}>
                  {part}
                </span>
                {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />}
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            onClick={onCopyPath}
            aria-label={t('coding.copyPath')}
            className="p-1 text-slate-400 hover:text-slate-300 transition-colors"
            title={t('coding.copyPath')}
          >
            {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {c.selectedFile ? (
          isDiffMode ? (
            <DiffEditor
              height="100%"
              theme="vs-dark"
              language={getLanguageFromExtension(c.selectedFile?.name)}
              original={c.originalContent || ''}
              modified={c.editorContent}
              options={{
                fontSize: 13,
                automaticLayout: true,
                fontFamily: 'Fira Code, Cascadia Code, monospace',
                minimap: { enabled: false },
                renderSideBySide: false,
                wordWrap: settings?.editorWordWrap !== false ? 'on' : 'off',
              }}
            />
          ) : (
            <Editor
              height="100%"
              theme="vs-dark"
              language={getLanguageFromExtension(c.selectedFile?.name)}
              value={c.editorContent}
              onChange={(val) => {
                c.setEditorContent(val || '')
                c.setIsSaved(false)
              }}
              options={{
                fontSize: 13,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: 'Fira Code, Cascadia Code, monospace',
                wordWrap: settings?.editorWordWrap !== false ? 'on' : 'off',
                lineNumbers: 'on',
              }}
            />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-400 font-sans select-none">
            <FileCode2 className="w-10 h-10 text-cyan-500/40" />
            <div className="text-slate-300 font-semibold text-sm">{t('coding.noFilesOpen')}</div>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              {t('coding.emptyLogs')}
            </p>
            <button
              type="button"
              onClick={onShowWorkspaceSidebar}
              className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition-colors"
            >
              {t('coding.filesTab')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
