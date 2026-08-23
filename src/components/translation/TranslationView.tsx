import React, { useState } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import {
  Languages,
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
  Link,
  AlertTriangle,
  GripVertical,
  WrapText,
  X,
} from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { PromptConfigurationModal } from '../settings/PromptConfigurationModal'
import { QuickModelSelector } from '../common/QuickModelSelector'
import { useDocumentTranslation, LANGUAGES } from '../../hooks/useTranslation'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import {
  ONLYRAG_MONACO_THEME_NAME,
  defineOnlyRagMonacoTheme,
  getStandardMonacoOptions,
} from '../../lib/monacoTheme'

interface TranslationViewProps {
  settings?: AppSettings
  diagnostics?: DiagnosticsData | null
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const TranslationView: React.FC<TranslationViewProps> = ({ settings, diagnostics, onUpdateSettings }) => {
  const { t } = useTranslation()
  const tr = useDocumentTranslation(settings)
  const toast = useToast()
  const [copiedTranslation, setCopiedTranslation] = useState(false)
  const initialLeftWidth = typeof window !== 'undefined'
    ? Math.max(250, Math.min(Math.round(window.innerWidth * 0.45), 900))
    : 450
  const {
    width: leftEditorWidth,
    isResizing: isLeftEditorResizing,
    handleMouseDown: handleLeftEditorMouseDown,
    handleKeyDown: handleLeftEditorKeyDown,
  } = useResizablePanel(initialLeftWidth, 250, 950, 'onlyrag_translation_split_width')

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
          {/* Quick Translation Model Selector */}
          <QuickModelSelector
            currentModel={settings?.translationModel || settings?.defaultModel || 'llama3.2'}
            fallbackModel={settings?.translationFallbackModel}
            installedModels={diagnostics?.ollama?.models || []}
            presetOptions={['qwen2.5:7b', 'llama3.1:8b', 'llama3.2:3b', 'mistral:7b', 'gemma2:9b']}
            onSelectModel={(newModel) => {
              onUpdateSettings?.({
                translationModel: newModel,
              })
            }}
            onSelectFallbackModel={(fallback) => {
              onUpdateSettings?.({
                translationFallbackModel: fallback,
              })
            }}
            icon={Languages}
            featureLabel="Traduzione Documenti"
            variant="sky"
          />

          <button
            type="button"
            onClick={tr.handleResetTranslation}
            aria-label={t('translation.newTranslation')}
            title={t('translation.newTranslation')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-slate-300 hover:text-sky-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">{t('translation.newTranslation')}</span>
          </button>

          <button
            type="button"
            onClick={() => tr.setIsPromptModalOpen(true)}
            aria-label={t('common.systemPrompt')}
            title={t('common.systemPrompt')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-sky-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">{t('common.systemPrompt')}</span>
          </button>

          {tr.isTranslating ? (
            <button
              type="button"
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
              type="button"
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
              <span className="font-semibold">{tr.selectedDoc?.filename || t('common.document')}</span>
              <span className="text-slate-400">•</span>
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
              disabled={tr.isTranslating}
              onChange={(e) => {
                const found = tr.documents.find((d) => d.id === e.target.value)
                tr.setSelectedDoc(found || null)
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs flex-1 max-w-md focus-ring font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">-- {t('translation.selectDocPlaceholder')} --</option>
              {tr.documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.filename} ({doc.numPages} {t('ingestion.pages')})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={tr.fetchDocuments}
              disabled={tr.isTranslating}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
              className="p-2 text-slate-400 hover:text-sky-400 transition-colors focus-ring rounded-lg active:scale-95 bg-slate-900 border border-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  disabled={tr.isTranslating}
                  aria-pressed={tr.pageViewMode === 'page'}
                  className={`px-2 py-0.5 rounded-lg font-mono text-[11px] transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                    tr.pageViewMode === 'page' ? 'bg-sky-950 text-sky-300 border border-sky-800' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tr.pageViewMode === 'page' ? t('translation.pageOf', { current: tr.currentPage, total: tr.selectedDoc.numPages }) : t('translation.allView')}
                </button>
                {tr.pageViewMode === 'page' && (
                  <select
                    value={tr.currentPage}
                    onChange={(e) => tr.setCurrentPage(Number(e.target.value))}
                    disabled={tr.isTranslating}
                    aria-label={t('translation.pageView')}
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded px-1.5 py-0.5 font-mono outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
              disabled={tr.isTranslating}
              onChange={(e) => tr.setSourceLang(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={tr.handleSwapLanguages}
              disabled={tr.isTranslating}
              title={t('translation.swapLanguages')}
              aria-label={t('translation.swapLanguages')}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sky-400 rounded-xl transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <label className="sr-only" htmlFor="target-lang-select">{t('translation.targetLang')}</label>
            <select
              id="target-lang-select"
              aria-label={t('translation.targetLang')}
              value={tr.targetLang}
              disabled={tr.isTranslating}
              onChange={(e) => tr.setTargetLang(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
              type="button"
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
              type="button"
              role="tab"
              aria-selected={tr.viewMode === 'diff'}
              onClick={() => tr.setViewMode('diff')}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all focus-ring active:scale-95 ${
                tr.viewMode === 'diff' ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              {t('translation.diffView')}
            </button>

            {tr.viewMode === 'split' && (
              <button
                type="button"
                onClick={() => tr.setSyncScroll(!tr.syncScroll)}
                aria-pressed={tr.syncScroll}
                aria-label={t('translation.syncScroll')}
                title={t('translation.syncScroll')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                  tr.syncScroll ? 'bg-sky-950 text-sky-300 border border-sky-800/80 shadow-sm' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Link className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('translation.syncScroll')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onUpdateSettings?.({ editorWordWrap: settings?.editorWordWrap === false ? true : false })}
              aria-pressed={settings?.editorWordWrap !== false}
              aria-label={t('settings.wordWrap')}
              title={t('settings.wordWrapDesc')}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                settings?.editorWordWrap !== false ? 'bg-sky-950 text-sky-300 border border-sky-800/80 shadow-sm' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('settings.wordWrap')}</span>
            </button>
          </div>

          {tr.translatedMarkdown && (
            <div className="flex items-center gap-1.5 bg-slate-950 rounded-xl border border-slate-800 p-0.5 shadow-sm">
              <button
                type="button"
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
                type="button"
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
                type="button"
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
                type="button"
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
          <div
            role="status"
            aria-live="polite"
            className="px-4 py-2 bg-sky-950/80 border-b border-sky-800 text-sky-300 text-xs font-semibold flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>{tr.exportMessage}</span>
          </div>
        )}

        {/* Cross-Module Task Lock / Translation Error Feedback Banner */}
        {tr.translationError && (
          <div
            role="alert"
            aria-live="assertive"
            className="px-4 py-2 bg-amber-950/80 border-b border-amber-800 text-amber-300 text-xs font-semibold flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{tr.translationError}</span>
            </div>
            <button
              type="button"
              onClick={() => tr.setTranslationError(null)}
              aria-label={t('common.close')}
              title={t('common.close')}
              className="text-amber-400 hover:text-amber-200 p-1 rounded-lg hover:bg-amber-900/60 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden bg-slate-950 min-h-[300px]">
          {!tr.selectedDoc ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-slate-400">
              <FileText className="w-10 h-10 text-sky-500/40" />
              {tr.documents.length === 0 ? (
                <div className="font-semibold text-slate-400 text-sm max-w-sm">{t('translation.noDocs')}</div>
              ) : (
                <>
                  <div className="font-semibold text-slate-400 text-sm">{t('translation.selectDocPrompt')}</div>
                  <p className="text-xs max-w-sm text-slate-400">
                    {t('translation.subtitle')}
                  </p>
                </>
              )}
            </div>
          ) : tr.viewMode === 'diff' ? (
            <DiffEditor
              height="100%"
              theme={ONLYRAG_MONACO_THEME_NAME}
              beforeMount={defineOnlyRagMonacoTheme}
              original={tr.selectedDoc?.extractedMarkdown || ''}
              modified={tr.translatedMarkdown}
              language="markdown"
              options={getStandardMonacoOptions({
                wordWrap: settings?.editorWordWrap !== false,
                renderSideBySide: true,
              })}
            />
          ) : (
            <div className="h-full flex bg-[#080c14]">
              <div
                style={{ width: `${leftEditorWidth}px` }}
                className="border-r border-slate-800 bg-[#080c14] flex flex-col shrink-0"
              >
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-sky-300">
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    <span>{t('translation.sourceText')} ({tr.sourceLang})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 truncate max-w-[200px]">
                    {tr.selectedDoc.filename}
                  </span>
                </div>
                <div className="flex-1 bg-[#080c14]">
                  <Editor
                    height="100%"
                    theme={ONLYRAG_MONACO_THEME_NAME}
                    beforeMount={defineOnlyRagMonacoTheme}
                    language="markdown"
                    value={tr.selectedDoc?.extractedMarkdown || ''}
                    onMount={tr.handleLeftEditorDidMount}
                    options={getStandardMonacoOptions({
                      readOnly: true,
                      minimap: false,
                      wordWrap: settings?.editorWordWrap !== false,
                    })}
                  />
                </div>
              </div>

              {/* Resizable Translation Split Divider Handle */}
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-valuenow={leftEditorWidth}
                aria-valuemin={250}
                aria-valuemax={950}
                aria-label={t('coding.resizePanels')}
                onMouseDown={handleLeftEditorMouseDown}
                onKeyDown={handleLeftEditorKeyDown}
                className={`w-1 hover:bg-sky-500 bg-slate-800/80 cursor-col-resize transition-colors duration-150 shrink-0 flex items-center justify-center group focus-ring ${
                  isLeftEditorResizing ? 'bg-sky-500 ring-2 ring-sky-500/50' : ''
                }`}
                title={t('coding.resizePanels')}
              >
                <GripVertical className={`w-2.5 h-2.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isLeftEditorResizing ? 'opacity-100 text-slate-950' : ''}`} />
              </div>

              <div className={`flex-1 min-w-0 bg-[#080c14] flex flex-col ${isLeftEditorResizing ? 'pointer-events-none select-none' : ''}`}>
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-sky-300">
                    <Languages className="w-3.5 h-3.5 text-sky-400" />
                    <span>{t('translation.translatedText')} ({tr.targetLang})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {tr.translatedMarkdown ? `${tr.translatedMarkdown.length} chars` : tr.isTranslating ? t('translation.translating') : '—'}
                  </span>
                </div>
                <div className="flex-1 bg-[#080c14]">
                  <Editor
                    height="100%"
                    theme={ONLYRAG_MONACO_THEME_NAME}
                    beforeMount={defineOnlyRagMonacoTheme}
                    language="markdown"
                    value={tr.translatedMarkdown}
                    onChange={(val) => tr.setTranslatedMarkdown(val || '')}
                    onMount={tr.handleEditorDidMount}
                    options={getStandardMonacoOptions({
                      minimap: false,
                      wordWrap: settings?.editorWordWrap !== false,
                    })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {settings && onUpdateSettings && (
        <PromptConfigurationModal
          isOpen={tr.isPromptModalOpen}
          onClose={() => tr.setIsPromptModalOpen(false)}
          initialNodeId="translation"
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}
