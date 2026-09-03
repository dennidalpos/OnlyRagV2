/**
 * Centralized Monaco Editor Theme and Options Configuration for OnlyRag V2.
 * Provides unified theme registration ('onlyrag-dark') and standard editor settings
 * across Coding Studio, Document Translation, and Document Ingestion markdown preview.
 */
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

if (typeof window !== 'undefined') {
  loader.config({ monaco })
}

export const ONLYRAG_MONACO_THEME_NAME = 'onlyrag-dark'

export const ONLYRAG_MONACO_COLORS = {
  'editor.background': '#080c14',
  'editor.foreground': '#e2e8f0',
  'editor.lineHighlightBackground': '#0f172a60',
  'editor.selectionBackground': '#0369a140',
  'editor.inactiveSelectionBackground': '#0369a120',
  'editorGutter.background': '#080c14',
  'editorLineNumber.foreground': '#475569',
  'editorLineNumber.activeForeground': '#38bdf8',
  'editorCursor.foreground': '#38bdf8',
  'editorWhitespace.foreground': '#1e293b',
  'editorIndentGuide.background': '#1e293b80',
  'editorIndentGuide.activeBackground': '#38bdf840',
  'diffEditor.insertedTextBackground': '#064e3b50',
  'diffEditor.insertedLineBackground': '#064e3b30',
  'diffEditor.removedTextBackground': '#88133750',
  'diffEditor.removedLineBackground': '#88133730',
  'scrollbarSlider.background': '#1e293b60',
  'scrollbarSlider.hoverBackground': '#33415580',
  'scrollbarSlider.activeBackground': '#475569a0',
}

/**
 * Registers the official `onlyrag-dark` Monaco theme on the monaco instance.
 * Safe to call multiple times (idempotent).
 */
export function defineOnlyRagMonacoTheme(monaco: any): void {
  if (!monaco || !monaco.editor) return
  try {
    monaco.editor.defineTheme(ONLYRAG_MONACO_THEME_NAME, {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '38bdf8' },
        { token: 'string', foreground: '34d399' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: 'a78bfa' },
        { token: 'function', foreground: '60a5fa' },
        { token: 'variable', foreground: 'f1f5f9' },
      ],
      colors: ONLYRAG_MONACO_COLORS,
    })
  } catch {
    // Theme already defined or runtime error handled gracefully
  }
}

export interface MonacoOptionsConfig {
  wordWrap?: boolean
  readOnly?: boolean
  minimap?: boolean
  lineNumbers?: 'on' | 'off' | 'relative'
  fontSize?: number
  lineHeight?: number
  renderSideBySide?: boolean
  [key: string]: any
}

/**
 * Returns standardized Monaco editor options with unified typography, padding,
 * smooth scrolling, and cursor aesthetics.
 */
export function getStandardMonacoOptions(config: MonacoOptionsConfig = {}) {
  const {
    wordWrap = true,
    readOnly = false,
    minimap = false,
    lineNumbers = 'on',
    fontSize = 14,
    lineHeight = 22,
    renderSideBySide = false,
    ...rest
  } = config

  return {
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
    fontSize,
    lineHeight,
    cursorBlinking: 'smooth' as const,
    smoothScrolling: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection' as const,
    padding: { top: 8, bottom: 8 },
    wordWrap: wordWrap ? ('on' as const) : ('off' as const),
    readOnly,
    minimap: { enabled: minimap },
    lineNumbers,
    renderSideBySide,
    ...rest,
  }
}
