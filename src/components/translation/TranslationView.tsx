import React, { useState } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import {
  Languages,
  ArrowRight,
  ArrowLeftRight,
  Download,
  Play,
  Square,
  RefreshCw,
  Sliders,
  Loader2,
  FileText,
  RotateCcw,
  Copy,
  Check,
} from 'lucide-react'
import { AppSettings } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { ModelBadge } from '../common/ModelBadge'
import { useDocumentTranslation, LANGUAGES } from '../../hooks/useTranslation'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'

interface TranslationViewProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const TranslationView: React.FC<TranslationViewProps> = ({ settings, onUpdateSettings }) => {
  const { t } = useTranslation()
  const tr = useDocumentTranslation(settings)
  const toast = useToast()
  const [copiedTranslation, setCopiedTranslation] = useState(false)

  const progressPercent = tr.totalChunks > 0
    ? Math.round((tr.currentChunkIndex / tr.totalChunks) * 100)
    : 0

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950 overflow-hidden select-text">
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
            <Languages className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide">{t('translation.title')}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Active Translation Model Badge */}
          <ModelBadge
            modelName={settings?.translationModel || settings?.defaultModel || 'llama3.2'}
            tooltip={`Translation Model: ${settings?.translationModel || settings?.defaultModel || 'llama3.2'}`}
          />

          <button
            onClick={tr.handleResetTranslation}
            aria-label={t('translation.newTranslation')}
            title={t('translation.newTranslation')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-slate-300 hover:text-sky-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">{t('translation.newTranslation')}</span>
          </button>

          <button
            onClick={() => tr.setIsPromptModalOpen(true)}
            aria-label={t('translation.systemPrompt')}
            title={t('translation.systemPrompt')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-sky-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">{t('translation.systemPrompt')}</span>
          </button>

          {tr.isTranslating ? (
            <button
              onClick={() => tr.handleStopTranslation()}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2 shadow-lg shadow-rose-950/40 animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{t('translation.stopTranslation', { percent: progressPercent })}</span>
            </button>
          ) : (
            <button
              onClick={() => tr.handleStartTranslation()}
              disabled={!tr.selectedDoc}
              aria-label={t('translation.startTranslation')}
              className="px-4 py-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2 shadow-lg shadow-sky-950/40"
            >
              <Play className="w-4 h-4" />
              <span>{t('translation.startTranslation')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Translation Progress Bar Banner */}
      {tr.isTranslating && (
        <div className="px-4 py-3 bg-slate-900/95 border-b border-slate-800 shrink-0" role="status" aria-live="polite">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs text-slate-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span className="font-semibold">{tr.selectedDoc?.filename || 'Documento'}</span>
              <span className="text-slate-500">•</span>
              <span className="text-sky-300 font-mono">
                Chunk {tr.currentChunkIndex}/{tr.totalChunks} ({tr.sourceLang} &rarr; {tr.targetLang})
              </span>
            </div>
            <span className="text-xs text-sky-300 font-mono font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Translation Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Control Bar */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-between text-xs gap-3 shrink-0">
          <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
            <span className="text-slate-400 font-bold uppercase text-[11px] shrink-0">{t('translation.sourceDocTitle')}:</span>
            <select
              aria-label={t('translation.selectDocPlaceholder')}
              value={tr.selectedDoc?.id || ''}
              onChange={(e) => {
                const found = tr.documents.find((d) => d.id === e.target.value)
                tr.setSelectedDoc(found || null)
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs flex-1 max-w-md focus-ring font-mono"
            >
              <option value="">-- {t('translation.selectDocPlaceholder')} --</option>
              {tr.documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.filename} ({doc.numPages} {t('ingestion.pages')})
                </option>
              ))}
            </select>
            <button
              onClick={tr.fetchDocuments}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
              className="p-2 text-slate-400 hover:text-sky-400 transition-colors focus-ring rounded-lg active:scale-95 bg-slate-900 border border-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {tr.selectedDoc && tr.selectedDoc.numPages > 1 && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs">
                <button
                  type="button"
                  onClick={() => tr.setPageViewMode(tr.pageViewMode === 'page' ? 'all' : 'page')}
                  className={`px-2 py-0.5 rounded-lg font-mono text-[11px] transition-colors ${
                    tr.pageViewMode === 'page' ? 'bg-sky-950 text-sky-300 border border-sky-800' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tr.pageViewMode === 'page' ? `${t('translation.pageView')} ${tr.currentPage}` : t('translation.allView')}
                </button>
                {tr.pageViewMode === 'page' && (
                  <select
                    value={tr.currentPage}
                    onChange={(e) => tr.setCurrentPage(Number(e.target.value))}
                    aria-label={t('translation.pageView')}
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded px-1.5 py-0.5 font-mono outline-none"
                  >
                    {Array.from({ length: tr.selectedDoc.numPages }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <label className="sr-only" htmlFor="source-lang-select">{t('translation.sourceLang')}</label>
            <select
              id="source-lang-select"
              aria-label={t('translation.sourceLang')}
              value={tr.sourceLang}
              onChange={(e) => tr.setSourceLang(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={tr.handleSwapLanguages}
              title={t('translation.swapLanguages')}
              aria-label={t('translation.swapLanguages')}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sky-400 rounded-xl transition-all active:scale-90"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <label className="sr-only" htmlFor="target-lang-select">{t('translation.targetLang')}</label>
            <select
              id="target-lang-select"
              aria-label={t('translation.targetLang')}
              value={tr.targetLang}
              onChange={(e) => tr.setTargetLang(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dual-Pane View Toggle & Export Actions */}
        <div className="bg-slate-900/80 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2" role="tablist" aria-label={t('translation.title')}>
            <button
              role="tab"
              aria-selected={tr.viewMode === 'split'}
              onClick={() => tr.setViewMode('split')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all focus-ring active:scale-95 ${
                tr.viewMode === 'split' ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              {t('translation.splitView')}
            </button>
            <button
              role="tab"
              aria-selected={tr.viewMode === 'diff'}
              onClick={() => tr.setViewMode('diff')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all focus-ring active:scale-95 ${
                tr.viewMode === 'diff' ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              {t('translation.diffView')}
            </button>
          </div>

          {tr.translatedMarkdown && (
            <div className="flex items-center gap-1.5 bg-slate-950 rounded-xl border border-slate-800 p-0.5 shadow-sm">
              <button
                onClick={async () => {
                  if (tr.translatedMarkdown) {
                    await navigator.clipboard.writeText(tr.translatedMarkdown)
                    setCopiedTranslation(true)
                    toast.success(t('translation.translationCopied'))
                    setTimeout(() => setCopiedTranslation(false), 2000)
                  }
                }}
                aria-label={t('translation.copyTranslation')}
                title={t('translation.copyTranslation')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-sky-300 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all focus-ring active:scale-95"
              >
                {copiedTranslation ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span>{t('common.copy')}</span>
              </button>

              <button
                onClick={() => {
                  tr.handleExportTranslation('pdf')
                  toast.info(t('translation.exportPdf'))
                }}
                aria-label={t('translation.exportPdf')}
                title={t('translation.exportPdf')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-sky-300 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all focus-ring active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => {
                  tr.handleExportTranslation('docx')
                  toast.info(t('translation.exportDocx'))
                }}
                aria-label={t('translation.exportDocx')}
                title={t('translation.exportDocx')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-sky-300 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all focus-ring active:scale-95"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>DOCX</span>
              </button>
              <button
                onClick={() => {
                  tr.handleExportTranslation('md')
                  toast.info(t('translation.exportMd'))
                }}
                aria-label={t('translation.exportMd')}
                title={t('translation.exportMd')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-sky-300 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all focus-ring active:scale-95 font-mono"
              >
                MD
              </button>
            </div>
          )}
        </div>

        {/* Translation Export Status Feedback Banner */}
        {tr.exportMessage && (
          <div className="px-4 py-2 bg-sky-950/80 border-b border-sky-800 text-sky-300 text-xs font-semibold flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>{tr.exportMessage}</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden bg-slate-950 min-h-[300px]">
          {!tr.selectedDoc ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-slate-500">
              <FileText className="w-10 h-10 text-sky-500/40" />
              <div className="font-semibold text-slate-400 text-sm">{t('translation.selectDocPrompt')}</div>
              <p className="text-xs max-w-sm text-slate-500">
                {t('translation.subtitle')}
              </p>
            </div>
          ) : tr.viewMode === 'diff' ? (
            <DiffEditor
              height="100%"
              theme="onlyrag-dark"
              beforeMount={(monaco) => {
                monaco.editor.defineTheme('onlyrag-dark', {
                  base: 'vs-dark',
                  inherit: true,
                  rules: [],
                  colors: {
                    'editor.background': '#020617',
                    'editor.lineHighlightBackground': '#0f172a60',
                    'editorGutter.background': '#020617',
                    'diffEditor.insertedTextBackground': '#064e3b60',
                    'diffEditor.insertedLineBackground': '#064e3b35',
                    'diffEditor.removedTextBackground': '#88133760',
                    'diffEditor.removedLineBackground': '#88133735',
                  },
                })
              }}
              original={tr.selectedDoc?.extractedMarkdown || ''}
              modified={tr.translatedMarkdown}
              language="markdown"
              options={{ fontSize: 13, automaticLayout: true }}
            />
          ) : (
            <div className="h-full flex">
              <div className="w-1/2 border-r border-slate-800 bg-slate-950 flex flex-col">
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-sky-300">
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    <span>{t('translation.sourceText')} ({tr.sourceLang})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 truncate max-w-[200px]">
                    {tr.selectedDoc.filename}
                  </span>
                </div>
                <div className="flex-1">
                  <Editor
                    height="100%"
                    theme="onlyrag-dark"
                    beforeMount={(monaco) => {
                      monaco.editor.defineTheme('onlyrag-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [],
                        colors: {
                          'editor.background': '#020617',
                          'editor.lineHighlightBackground': '#0f172a60',
                          'editorGutter.background': '#020617',
                        },
                      })
                    }}
                    language="markdown"
                    value={tr.selectedDoc?.extractedMarkdown || ''}
                    onMount={(editor) => {
                      tr.leftPaneRef.current = editor.getDomNode() as HTMLDivElement | null
                    }}
                    options={{ fontSize: 13, readOnly: true, automaticLayout: true, minimap: { enabled: false } }}
                  />
                </div>
              </div>
              <div className="w-1/2 bg-slate-950 flex flex-col">
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-sky-300">
                    <Languages className="w-3.5 h-3.5 text-sky-400" />
                    <span>{t('translation.translatedText')} ({tr.targetLang})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {tr.translatedMarkdown ? `${tr.translatedMarkdown.length} chars` : t('common.loading')}
                  </span>
                </div>
                <div className="flex-1">
                  <Editor
                    height="100%"
                    theme="onlyrag-dark"
                    beforeMount={(monaco) => {
                      monaco.editor.defineTheme('onlyrag-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [],
                        colors: {
                          'editor.background': '#020617',
                          'editor.lineHighlightBackground': '#0f172a60',
                          'editorGutter.background': '#020617',
                        },
                      })
                    }}
                    language="markdown"
                    value={tr.translatedMarkdown}
                    onChange={(val) => tr.setTranslatedMarkdown(val || '')}
                    onMount={tr.handleEditorDidMount}
                    options={{ fontSize: 13, automaticLayout: true, minimap: { enabled: false } }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {settings && onUpdateSettings && (
        <SystemPromptModal
          isOpen={tr.isPromptModalOpen}
          onClose={() => tr.setIsPromptModalOpen(false)}
          module="translation"
          moduleTitle={t('translation.title')}
          activeModelName={settings.translationModel || settings.defaultModel || 'llama3.2'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}
