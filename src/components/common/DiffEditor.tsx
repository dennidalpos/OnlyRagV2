import { useLayoutEffect, useRef, type ComponentProps } from 'react'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

/** Monaco 0.56 requires detaching the diff before disposing either text model. */
export function DiffEditor(props: ComponentProps<typeof MonacoDiffEditor>) {
  const instance = useRef<editor.IStandaloneDiffEditor | null>(null)
  useLayoutEffect(
    () => () => {
      const current = instance.current
      instance.current = null
      const model = current?.getModel()
      current?.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
    },
    [],
  )
  return (
    <MonacoDiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(current, monaco) => {
        instance.current = current
        props.onMount?.(current, monaco)
      }}
    />
  )
}
