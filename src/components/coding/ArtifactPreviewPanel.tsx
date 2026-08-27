import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Code2, Eye, Plus, Save, Trash2 } from 'lucide-react'
import type { ArtifactKind, ArtifactRecord } from '../../types'

interface ArtifactPreviewPanelProps {
  workspacePath: string | null
}

const EMPTY_ARTIFACT = '<!doctype html>\n<html><body><h1>New artifact</h1></body></html>'

function previewSource(artifact: ArtifactRecord): string {
  if (artifact.kind === 'markdown') {
    return `<pre style="white-space:pre-wrap;font:14px system-ui;color:#e2e8f0;background:#020617;padding:24px;min-height:100vh">${artifact.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`
  }
  if (artifact.kind === 'svg') return artifact.content
  return artifact.content
}

export const ArtifactPreviewPanel: React.FC<ArtifactPreviewPanelProps> = ({ workspacePath }) => {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY_ARTIFACT)
  const [name, setName] = useState('Untitled artifact')
  const [kind, setKind] = useState<ArtifactKind>('html')
  const [isSaving, setIsSaving] = useState(false)

  const selected = useMemo(() => artifacts.find((artifact) => artifact.id === selectedId) || null, [artifacts, selectedId])

  const loadArtifacts = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.listArtifacts) return
    const next = await window.electronAPI.listArtifacts(workspacePath)
    setArtifacts(next)
    if (selectedId && next.some((artifact) => artifact.id === selectedId)) return
    const first = next[0]
    setSelectedId(first?.id || null)
    if (first) {
      setName(first.name)
      setKind(first.kind)
      setDraft(first.content)
    }
  }, [selectedId, workspacePath])

  useEffect(() => { void loadArtifacts() }, [loadArtifacts])

  const selectArtifact = (artifact: ArtifactRecord) => {
    setSelectedId(artifact.id)
    setName(artifact.name)
    setKind(artifact.kind)
    setDraft(artifact.content)
  }

  const createArtifact = () => {
    setSelectedId(null)
    setName('Untitled artifact')
    setKind('html')
    setDraft(EMPTY_ARTIFACT)
  }

  const save = async () => {
    if (!workspacePath || !window.electronAPI?.saveArtifact || !name.trim()) return
    setIsSaving(true)
    try {
      const saved = await window.electronAPI.saveArtifact(workspacePath, { id: selectedId || undefined, name, kind, content: draft })
      setArtifacts((current) => [saved, ...current.filter((artifact) => artifact.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setSelectedId(saved.id)
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!workspacePath || !selectedId || !window.electronAPI?.deleteArtifact) return
    if (!await window.electronAPI.deleteArtifact(workspacePath, selectedId)) return
    setArtifacts((current) => current.filter((artifact) => artifact.id !== selectedId))
    createArtifact()
  }

  const displayed: ArtifactRecord = selected || {
    id: 'draft', workspacePath: workspacePath || '', name, kind, content: draft, createdAt: '', updatedAt: '',
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-200">
      <div className="h-12 px-4 border-b border-slate-800 flex items-center gap-2 shrink-0">
        <Eye className="w-4 h-4 text-cyan-400" />
        <span className="font-semibold text-sm">Live Preview</span>
        <span className="text-[11px] text-slate-500">sandboxed artifact workspace</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={createArtifact} className="px-2 py-1 rounded border border-slate-700 text-xs hover:text-white"><Plus className="w-3 h-3 inline mr-1" />Nuovo</button>
          <button type="button" onClick={() => void save()} disabled={isSaving || !workspacePath} className="px-2 py-1 rounded bg-cyan-600 text-slate-950 text-xs font-semibold disabled:opacity-40"><Save className="w-3 h-3 inline mr-1" />Salva</button>
          <button type="button" onClick={() => void remove()} disabled={!selectedId} className="px-2 py-1 rounded border border-red-900/70 text-red-300 text-xs disabled:opacity-40"><Trash2 className="w-3 h-3 inline mr-1" />Elimina</button>
        </div>
      </div>
      {!workspacePath ? <div className="p-6 text-sm text-slate-400">Apri un workspace per usare gli artefatti.</div> : (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-56 shrink-0 border-r border-slate-800 p-3 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Artefatti</div>
            {artifacts.length === 0 && <div className="text-xs text-slate-500">Nessun artefatto salvato.</div>}
            {artifacts.map((artifact) => (
              <button key={artifact.id} type="button" onClick={() => selectArtifact(artifact)} className={`w-full text-left rounded px-2 py-2 mb-1 text-xs ${artifact.id === selectedId ? 'bg-cyan-950/60 text-cyan-200' : 'text-slate-400 hover:bg-slate-900'}`}>
                <Code2 className="w-3 h-3 inline mr-1" />{artifact.name}<span className="block pl-4 text-[10px] text-slate-500">{artifact.kind}</span>
              </button>
            ))}
          </aside>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="p-3 border-b border-slate-800 flex gap-2">
              <input value={name} onChange={(event) => setName(event.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" aria-label="Nome artefatto" />
              <select value={kind} onChange={(event) => setKind(event.target.value as ArtifactKind)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" aria-label="Tipo artefatto">
                <option value="html">HTML</option><option value="svg">SVG</option><option value="markdown">Markdown</option>
              </select>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-slate-800">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-0 resize-none bg-slate-950 p-4 font-mono text-xs text-slate-300 outline-none" aria-label="Contenuto artefatto" spellCheck={false} />
              <iframe title={`Anteprima ${displayed.name}`} sandbox="" srcDoc={previewSource(displayed)} className="w-full h-full bg-white border-0" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
