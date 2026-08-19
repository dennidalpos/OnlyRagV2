import { useState, useEffect } from 'react'
import { SkillDefinition, HubSkillItem, SkillHubSource, CustomHubInput, SkillSaveInput } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { useTranslation } from '../i18n'

/**
 * All state and API-calling handlers behind SkillHubModal: loading installed/marketplace
 * skills, switching hub sources, and every install/save/reset/delete/add-hub action. Kept
 * separate from the modal's JSX so the component stays a pure composition/view layer.
 */
export function useSkillHubModal(isOpen: boolean, workspacePath: string | null, onClose: () => void) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'installed' | 'hub'>('installed')
  const [installedSkills, setInstalledSkills] = useState<SkillDefinition[]>([])
  const [hubSkills, setHubSkills] = useState<HubSkillItem[]>([])
  const [sources, setSources] = useState<SkillHubSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('official-core')
  const [isLoading, setIsLoading] = useState(false)
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const handleSourceChange = async (newSourceId: string, forceRefresh = false) => {
    setSelectedSourceId(newSourceId)
    setIsLoading(true)
    if (forceRefresh) setHubSkills([]) // Clear previous items when explicitly refreshing
    try {
      const hub = await apiService.listHubSkillsBySource(newSourceId, workspacePath || undefined, forceRefresh)
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
    setInstallingSkillId(hubSkillId)
    setActionMessage(null)
    try {
      const res = await apiService.installSkillFromHub(hubSkillId, workspacePath || undefined, selectedSourceId)
      if (res.success) {
        setActionMessage({ type: 'success', text: t('skills.msgInstalled', { name: hubSkillId }) })
        // Mark as installed in local hubSkills state immediately
        setHubSkills((prev) =>
          prev.map((s) => (s.id === hubSkillId ? { ...s, isInstalled: true } : s))
        )
        // Refresh installed skills in background without triggering full-page loading or scroll reset
        const installed = await apiService.listInstalledSkills(workspacePath || undefined)
        setInstalledSkills(installed)
      } else {
        setActionMessage({ type: 'error', text: res.error || t('common.error') })
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || t('common.error') })
    } finally {
      setInstallingSkillId(null)
    }
  }

  const handleInstallFromUrl = async (url: string, customName?: string) => {
    setIsLoading(true)
    setActionMessage(null)
    const res = await apiService.installSkillFromUrl(url, workspacePath || undefined, customName)
    if (res.success) {
      setActionMessage({ type: 'success', text: t('skills.msgUrlImported') })
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
      setActionMessage({ type: 'success', text: t('skills.msgSaved', { name: input.name }) })
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
      setActionMessage({ type: 'success', text: t('skills.msgReset', { name: skillId }) })
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
      setActionMessage({ type: 'success', text: t('skills.msgDeleted', { name: skillId }) })
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
      setActionMessage({ type: 'success', text: t('skills.msgHubAdded', { name: input.name }) })
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
      setActionMessage({ type: 'success', text: t('skills.msgHubRemoved') })
      const nextSourceId = selectedSourceId === sourceId ? 'official-core' : selectedSourceId
      await loadSourcesAndSkills(nextSourceId)
    } else {
      setActionMessage({ type: 'error', text: res.error || t('common.error') })
    }
    setIsLoading(false)
  }

  return {
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
  }
}
