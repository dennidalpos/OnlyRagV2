import Editor from '@monaco-editor/react'
import type { ComponentProps } from 'react'
import { ONLYRAG_MONACO_THEME_NAME, defineOnlyRagMonacoTheme, getStandardMonacoOptions } from '../../lib/monacoTheme'

interface IngestionMarkdownEditorProps {
  content: string
  onChange: (value: string) => void
  onMount: ComponentProps<typeof Editor>['onMount']
  wordWrap: boolean
}

export function IngestionMarkdownEditor({ content, onChange, onMount, wordWrap }: IngestionMarkdownEditorProps) {
  return (
    <Editor
      height="100%"
      theme={ONLYRAG_MONACO_THEME_NAME}
      beforeMount={defineOnlyRagMonacoTheme}
      language="markdown"
      value={content}
      onChange={(value) => onChange(value || '')}
      onMount={onMount}
      options={getStandardMonacoOptions({ minimap: false, wordWrap, lineNumbers: 'on' })}
    />
  )
}
