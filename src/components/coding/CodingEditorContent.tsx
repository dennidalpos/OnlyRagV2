import React from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { FileCode2, ChevronRight, Copy, Check } from 'lucide-react'
import { AppSettings } from '../../types'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { useTranslation } from '../../i18n'
import { getLanguageFromExtension, getBreadcrumbParts } from './codingEditorUtils'
import {
  ONLYRAG_MONACO_THEME_NAME,
  defineOnlyRagMonacoTheme,
  getStandardMonacoOptions,
} from '../../lib/monacoTheme'

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
  const isWordWrap = settings?.editorWordWrap !== false

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-slate-950 relative">
      {/* Breadcrumbs Navigation Bar */}
      {c.selectedFile && (
        <div className="px-4 py-1.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
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
            className="p-1 text-slate-400 hover:text-slate-300 transition-colors focus-ring rounded"
            title={t('coding.copyPath')}
          >
            {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-slate-950 flex flex-col">
        {c.selectedFile ? (
          isDiffMode ? (
            <DiffEditor
              width="100%"
              height="100%"
              theme={ONLYRAG_MONACO_THEME_NAME}
              beforeMount={defineOnlyRagMonacoTheme}
              language={getLanguageFromExtension(c.selectedFile?.name)}
              original={c.originalContent || ''}
              modified={c.editorContent}
              options={getStandardMonacoOptions({
                wordWrap: isWordWrap,
                minimap: false,
                renderSideBySide: false,
              })}
            />
          ) : (
            <Editor
              width="100%"
              height="100%"
              theme={ONLYRAG_MONACO_THEME_NAME}
              beforeMount={defineOnlyRagMonacoTheme}
              language={getLanguageFromExtension(c.selectedFile?.name)}
              value={c.editorContent}
              onChange={(val) => {
                c.setEditorContent(val || '')
                c.setIsSaved(false)
              }}
              options={getStandardMonacoOptions({
                wordWrap: isWordWrap,
                minimap: true,
                lineNumbers: 'on',
              })}
            />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-400 font-sans select-text">
            <FileCode2 className="w-10 h-10 text-cyan-500/30" />
            <div className="text-slate-300 font-semibold text-sm">{t('coding.noFilesOpen')}</div>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              {t('coding.emptyLogs')}
            </p>
            <button
              type="button"
              onClick={onShowWorkspaceSidebar}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-300 font-semibold rounded-xl text-xs transition-all shadow-sm active:scale-95 focus-ring cursor-pointer"
            >
              {t('coding.filesTab')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
