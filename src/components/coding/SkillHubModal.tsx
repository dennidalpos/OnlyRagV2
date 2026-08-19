import React from 'react'
import { X, Sparkles, Download, CheckCircle } from 'lucide-react'
import { SkillHubSourceSelector } from './skills/SkillHubSourceSelector'
import { InstalledSkillsList } from './skills/InstalledSkillsList'
import { MarketplaceSkillsList } from './skills/MarketplaceSkillsList'
import { SkillEditorModal } from './skills/SkillEditorModal'
import { CustomHubGuideModal } from './skills/CustomHubGuideModal'
import { AddCustomHubModal } from './skills/AddCustomHubModal'
import { useTranslation } from '../../i18n'
import { useSkillHubModal } from '../../hooks/useSkillHubModal'

export const DEFAULT_SKILL_HUB_URL = 'https://raw.githubusercontent.com/antigravity-community/skills/main/skills/clean-code/SKILL.md'

interface SkillHubModalProps {
  isOpen: boolean
  onClose: () => void
  workspacePath: string | null
}

export const SkillHubModal: React.FC<SkillHubModalProps> = ({ isOpen, onClose, workspacePath }) => {
  const { t } = useTranslation()
  const {
    activeTab,
    installedSkills,
    hubSkills,
    sources,
    selectedSourceId,
    isLoading,
    installingSkillId,
    actionMessage,
    isEditorOpen,
    setIsEditorOpen,
    editingSkill,
    setEditingSkill,
    isGuideOpen,
    setIsGuideOpen,
    isAddHubOpen,
    setIsAddHubOpen,
    handleSourceChange,
    handleTabChange,
    handleToggleActive,
    handleInstallFromHub,
    handleInstallFromUrl,
    handleSaveCustomSkill,
    handleResetSkill,
    handleDeleteSkill,
    handleAddCustomHub,
    handleRemoveCustomHub,
  } = useSkillHubModal(isOpen, workspacePath, onClose)

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
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all focus-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950/30" role="tablist" aria-label={t('skills.hubTitle')}>
          <div className="flex gap-4">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'installed'}
              id="skill-tab-installed"
              aria-controls="skill-panel-installed"
              onClick={() => handleTabChange('installed')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 focus-ring ${
                activeTab === 'installed'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" /> {t('skills.installedTab')} ({installedSkills.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'hub'}
              id="skill-tab-hub"
              aria-controls="skill-panel-hub"
              onClick={() => handleTabChange('hub')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 focus-ring ${
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
            role={actionMessage.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
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
            <div id="skill-panel-installed" role="tabpanel" aria-labelledby="skill-tab-installed">
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
            </div>
          ) : (
            <div id="skill-panel-hub" role="tabpanel" aria-labelledby="skill-tab-hub" className="space-y-6">
              <SkillHubSourceSelector
                sources={sources}
                selectedSourceId={selectedSourceId}
                onSelectSource={handleSourceChange}
                onOpenAddHubModal={() => setIsAddHubOpen(true)}
                onOpenGuideModal={() => setIsGuideOpen(true)}
                onRemoveCustomSource={handleRemoveCustomHub}
                onRefresh={() => handleSourceChange(selectedSourceId, true)}
                isLoading={isLoading}
              />

              <MarketplaceSkillsList
                hubSkills={hubSkills}
                isLoading={isLoading}
                installingSkillId={installingSkillId}
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
