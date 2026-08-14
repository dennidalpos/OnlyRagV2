import React, { useState, useEffect } from 'react'
import { X, Sparkles, Download, CheckCircle } from 'lucide-react'
import { SkillDefinition, HubSkillItem, SkillHubSource, CustomHubInput, SkillSaveInput } from '../../types'
import { apiService } from '../../services/api'
import { logger } from '../../lib/logger'
import { SkillHubSourceSelector } from './skills/SkillHubSourceSelector'
import { InstalledSkillsList } from './skills/InstalledSkillsList'
import { MarketplaceSkillsList } from './skills/MarketplaceSkillsList'
import { SkillEditorModal } from './skills/SkillEditorModal'
import { CustomHubGuideModal } from './skills/CustomHubGuideModal'
import { AddCustomHubModal } from './skills/AddCustomHubModal'
import { useTranslation } from '../../i18n'

export const DEFAULT_SKILL_HUB_URL = 'https://raw.githubusercontent.com/antigravity-community/skills/main/skills/clean-code/SKILL.md'

interface SkillHubModalProps {
  isOpen: boolean
  onClose: () => void
  workspacePath: string | null
}

export const SkillHubModal: React.FC<SkillHubModalProps> = ({ isOpen, onClose, workspacePath }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'installed' | 'hub'>('installed')
  const [installedSkills, setInstalledSkills] = useState<SkillDefinition[]>([])
  const [hubSkills, setHubSkills] = useState<HubSkillItem[]>([])
  const [sources, setSources] = useState<SkillHubSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('official-core')
  const [isLoading, setIsLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sub-modal states
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [isAddHubOpen, setIsAddHubOpen] = useState(false)

  const loadSourcesAndSkills = async (sourceIdToUse?: string) => {
    setIsLoading(true)
    try {
      const [installed, sourcesList] = await Promise.all([
        apiService.listInstalledSkills(workspacePath || undefined),
        apiService.listHubSources(),
      ])
      setInstalledSkills(installed)
      setSources(sourcesList)

      const activeSourceId = sourceIdToUse || selectedSourceId || sourcesList[0]?.id || 'official-core'
      setSelectedSourceId(activeSourceId)

      const hub = await apiService.listHubSkillsBySource(activeSourceId, workspacePath || undefined)
      setHubSkills(hub)
    } catch (err: any) {
      logger.error('SkillHubModal', `Error loading skills/sources: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadSourcesAndSkills()
      setActionMessage(null)
    }
  }, [isOpen, workspacePath])

  // ESC Key Listener for Accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEditorOpen && !isGuideOpen && !isAddHubOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isEditorOpen, isGuideOpen, isAddHubOpen, onClose])

  // Instant remote refresh when hub source is changed
  const handleSourceChange = async (newSourceId: string) => {
    setSelectedSourceId(newSourceId)
    setIsLoading(true)
    setHubSkills([]) // Clear previous items immediately to indicate fresh remote fetch
    try {
      const hub = await apiService.listHubSkillsBySource(newSourceId, workspacePath || undefined)
      setHubSkills(hub)
    } catch (err: any) {
      logger.error('SkillHubModal', `Error changing source: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // Refresh remote skills when tab switches to hub
  const handleTabChange = async (tab: 'installed' | 'hub') => {
    setActiveTab(tab)
    if (tab === 'hub') {
      setIsLoading(true)
      try {
        const hub = await apiService.listHubSkillsBySource(selectedSourceId, workspacePath || undefined)
        setHubSkills(hub)
      } catch (err: any) {
        logger.error('SkillHubModal', `Error fetching hub skills on tab switch: ${err.message}`)
      } finally {
        setIsLoading(false)
      }
    } else {
      const installed = await apiService.listInstalledSkills(workspacePath || undefined)
      setInstalledSkills(installed)
    }
  }

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    await apiService.toggleSkillActive(skillId, !currentActive)
    setInstalledSkills((prev) =>
      prev.map((s) => (s.id === skillId || s.name === skillId ? { ...s, isActive: !currentActive } : s))
    )
  }

  const handleInstallFromHub = async (hubSkillId: string) => {
    setIsLoading(true)
    setActionMessage(null)
    const res = await apiService.installSkillFromHub(hubSkillId, workspacePath || undefined, selectedSourceId)
    if (res.success) {
      setActionMessage({ type: 'success', text: `Skill '${hubSkillId}' installed!` })
      await loadSourcesAndSkills(selectedSourceId)
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleInstallFromUrl = async (url: string, customName?: string) => {
    setIsLoading(true)
    setActionMessage(null)
    const res = await apiService.installSkillFromUrl(url, workspacePath || undefined, customName)
    if (res.success) {
      setActionMessage({ type: 'success', text: 'Skill URL imported!' })
      await loadSourcesAndSkills(selectedSourceId)
      setActiveTab('installed')
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleSaveCustomSkill = async (input: SkillSaveInput) => {
    setIsLoading(true)
    const res = await apiService.saveCustomSkill(input, workspacePath || undefined)
    if (res.success) {
      setActionMessage({ type: 'success', text: `Skill '${input.name}' saved!` })
      setIsEditorOpen(false)
      setEditingSkill(null)
      await loadSourcesAndSkills(selectedSourceId)
      setActiveTab('installed')
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleResetSkill = async (skillId: string) => {
    if (!confirm(t('skills.confirmReset'))) return
    setIsLoading(true)
    const res = await apiService.resetSkillToOriginal(skillId, workspacePath || undefined)
    if (res.success) {
      setActionMessage({ type: 'success', text: `Skill '${skillId}' reset!` })
      await loadSourcesAndSkills(selectedSourceId)
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleDeleteSkill = async (skillId: string) => {
    if (!confirm(t('skills.confirmDelete'))) return
    setIsLoading(true)
    const res = await apiService.uninstallSkill(skillId, workspacePath || undefined)
    if (res.success) {
      setActionMessage({ type: 'success', text: `Skill '${skillId}' deleted.` })
      await loadSourcesAndSkills(selectedSourceId)
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleAddCustomHub = async (input: CustomHubInput) => {
    setIsLoading(true)
    const res = await apiService.addCustomHubSource(input)
    if (res.success && res.source) {
      setActionMessage({ type: 'success', text: `Hub '${input.name}' added!` })
      setIsAddHubOpen(false)
      await loadSourcesAndSkills(res.source.id)
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  const handleRemoveCustomHub = async (sourceId: string) => {
    if (!confirm(t('skills.confirmRemoveHub'))) return
    setIsLoading(true)
    const res = await apiService.removeCustomHubSource(sourceId)
    if (res.success) {
      setActionMessage({ type: 'success', text: 'Hub source removed.' })
      await loadSourcesAndSkills('official-core')
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-hub-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 select-text"
    >
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="skill-hub-modal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                {t('skills.hubTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('skills.hubSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all focus-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950/30">
          <div className="flex gap-4">
            <button
              onClick={() => handleTabChange('installed')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'installed'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" /> {t('skills.installedTab')} ({installedSkills.length})
            </button>
            <button
              onClick={() => handleTabChange('hub')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'hub'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <Download className="w-3.5 h-3.5" /> {t('skills.marketplaceTab')}
            </button>
          </div>
        </div>

        {/* Action Status Banner */}
        {actionMessage && (
          <div
            className={`px-6 py-2 text-xs font-medium border-b ${
              actionMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'installed' ? (
            <InstalledSkillsList
              skills={installedSkills}
              onToggleActive={handleToggleActive}
              onEditSkill={(skill) => {
                setEditingSkill(skill)
                setIsEditorOpen(true)
              }}
              onResetSkill={handleResetSkill}
              onDeleteSkill={handleDeleteSkill}
              onOpenCreateModal={() => {
                setEditingSkill(null)
                setIsEditorOpen(true)
              }}
              onSwitchToHub={() => handleTabChange('hub')}
            />
          ) : (
            <div className="space-y-6">
              <SkillHubSourceSelector
                sources={sources}
                selectedSourceId={selectedSourceId}
                onSelectSource={handleSourceChange}
                onOpenAddHubModal={() => setIsAddHubOpen(true)}
                onOpenGuideModal={() => setIsGuideOpen(true)}
                onRemoveCustomSource={handleRemoveCustomHub}
                onRefresh={() => handleSourceChange(selectedSourceId)}
                isLoading={isLoading}
              />

              <MarketplaceSkillsList
                hubSkills={hubSkills}
                isLoading={isLoading}
                onInstallSkill={handleInstallFromHub}
                onInstallFromUrl={handleInstallFromUrl}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sub-modals */}
      <SkillEditorModal
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false)
          setEditingSkill(null)
        }}
        onSave={handleSaveCustomSkill}
        initialSkill={editingSkill}
        isLoading={isLoading}
      />

      <CustomHubGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />

      <AddCustomHubModal
        isOpen={isAddHubOpen}
        onClose={() => setIsAddHubOpen(false)}
        onAdd={handleAddCustomHub}
        isLoading={isLoading}
      />
    </div>
  )
}
