import React, { useState } from 'react'
import { Database, Sparkles, ExternalLink } from 'lucide-react'
import { VectorSearchModal } from './VectorSearchModal'

interface VectorSearchPanelProps {
  embeddingModel?: string
}

export const VectorSearchPanel: React.FC<VectorSearchPanelProps> = ({ embeddingModel }) => {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <>
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-300 flex items-center gap-1.5 text-xs">
            <Database className="w-3.5 h-3.5 text-cyan-400" /> Test Ricerca Vettoriale
          </span>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-1.5 py-0.5 rounded font-semibold">
            LanceDB
          </span>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Ispeziona i chunk estratti, la pertinenza semantica e i vettori indicizzati nel database.
        </p>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          aria-label="Apri finestra di test per ricerca vettoriale LanceDB"
          className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-cyan-300 font-semibold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center justify-center gap-2 shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Apri Inspector Vettoriale</span>
          <ExternalLink className="w-3 h-3 opacity-60 ml-auto" />
        </button>
      </div>

      <VectorSearchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        embeddingModel={embeddingModel}
      />
    </>
  )
}

