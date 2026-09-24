import { useState, useEffect } from 'react'
import { SkillDefinition, HubSkillItem, SkillHubSource, CustomHubInput, SkillSaveInput } from '../types'
import { electronApi } from '../services/electronApi'
import { logger } from '../lib/logger'
import { useTranslation } from '../i18n'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

export const ALL_SKILL_SOURCES = '__all__'

/** All state and API-calling handlers behind SkillHubModal: loading installed/marketplace skills, switching hub sources, and every install/save/reset/delete/add-hub action. */
export function useSkillHubModal(isOpen: boolean, workspacePath: string | null, onClose: () => void) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'installed' | 'hub'>('installed')
  const [installedSkills, setInstalledSkills] = useState<SkillDefinition[]>([])
  const [hubSkills, setHubSkills] = useState<HubSkillItem[]>([])
  const [sources, setSources] = useState<SkillHubSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>(ALL_SKILL_SOURCES)
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
      const [installed, sourcesList] = await Promise.all([electronApi().listInstalledSkills(workspacePath || undefined), electronApi().listHubSources()])
      setInstalledSkills(installed)
      setSources(sourcesList)

      const activeSourceId = sourceIdToUse || selectedSourceId || ALL_SKILL_SOURCES
      setSelectedSourceId(activeSourceId)

      const hub =
        activeSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources(workspacePath || undefined)
          : await electronApi().listHubSkillsBySource(activeSourceId, workspacePath || undefined)
      setHubSkills(hub)
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error loading skills/sources: ${errorMessage(err)}`)
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
  const handleSourceChange = async (newSourceId: string, forceRefresh = false) => {
    setSelectedSourceId(newSourceId)
    setIsLoading(true)
    if (forceRefresh) setHubSkills([]) // Clear previous items when explicitly refreshing
    try {
      const hub =
        newSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources(workspacePath || undefined, forceRefresh)
          : await electronApi().listHubSkillsBySource(newSourceId, workspacePath || undefined, forceRefresh)
      setHubSkills(hub)
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error changing source: ${errorMessage(err)}`)
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
        const hub =
          selectedSourceId === ALL_SKILL_SOURCES
            ? await electronApi().listHubSkillsAcrossSources(workspacePath || undefined)
            : await electronApi().listHubSkillsBySource(selectedSourceId, workspacePath || undefined)
        setHubSkills(hub)
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching hub skills on tab switch: ${errorMessage(err)}`)
      } finally {
        setIsLoading(false)
      }
    } else {
      try {
        setInstalledSkills(await electronApi().listInstalledSkills(workspacePath || undefined))
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching installed skills on tab switch: ${errorMessage(err)}`)
      }
    }
  }

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    try {
      if (!(await electronApi().toggleSkillActive(skillId, !currentActive))) {
        setActionMessage({ type: 'error', text: t('common.error') })
        return
      }
      setInstalledSkills((prev) => prev.map((s) => (s.id === skillId || s.name === skillId ? { ...s, isActive: !currentActive } : s)))
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    }
  }

  const handleInstallFromHub = async (hubSkillId: string) => {
    setInstallingSkillId(hubSkillId)
    setActionMessage(null)
    try {
      const res = await electronApi().installSkillFromHub(hubSkillId, workspacePath || undefined, selectedSourceId)
      if (res.success) {
        setActionMessage({ type: 'success', text: t('skills.msgInstalled', { name: hubSkillId }) })
        // Mark as installed in local hubSkills state immediately
        setHubSkills((prev) => prev.map((s) => (s.id === hubSkillId ? { ...s, isInstalled: true } : s)))
        // Refresh installed skills in background without triggering full-page loading or scroll reset
        const installed = await electronApi().listInstalledSkills(workspacePath || undefined)
        setInstalledSkills(installed)
      } else {
        setActionMessage({ type: 'error', text: res.error || t('common.error') })
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    } finally {
      setInstallingSkillId(null)
    }
  }

  /** Runs one skill or hub mutation behind the loading state and reports its failure, returned or thrown. */
  const runSkillAction = async <T extends { success: boolean; error?: string }>(action: () => Promise<T>, onSuccess: (res: T) => Promise<void> | void) => {
    setIsLoading(true)
    try {
      const res = await action()
      if (res.success) await onSuccess(res)
      else setActionMessage({ type: 'error', text: res.error || t('common.error') })
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    } finally {
      setIsLoading(false)
    }
  }

  const handleInstallFromUrl = async (url: string, customName?: string) => {
    setActionMessage(null)
    await runSkillAction(
      () => electronApi().installSkillFromUrl(url, workspacePath || undefined, customName),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgUrlImported') })
        await loadSourcesAndSkills(selectedSourceId)
        setActiveTab('installed')
      },
    )
  }

  const handleSaveCustomSkill = (input: SkillSaveInput) =>
    runSkillAction(
      () => electronApi().saveCustomSkill(input, workspacePath || undefined),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgSaved', { name: input.name }) })
        setIsEditorOpen(false)
        setEditingSkill(null)
        await loadSourcesAndSkills(selectedSourceId)
        setActiveTab('installed')
      },
    )

  const handleResetSkill = (skillId: string) =>
    runSkillAction(
      () => electronApi().resetSkillToOriginal(skillId, workspacePath || undefined),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgReset', { name: skillId }) })
        await loadSourcesAndSkills(selectedSourceId)
      },
    )

  const handleDeleteSkill = (skillId: string) =>
    runSkillAction(
      () => electronApi().uninstallSkill(skillId, workspacePath || undefined),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgDeleted', { name: skillId }) })
        await loadSourcesAndSkills(selectedSourceId)
      },
    )

  const handleAddCustomHub = (input: CustomHubInput) =>
    runSkillAction(
      () => electronApi().addCustomHubSource(input),
      async ({ source }) => {
        if (!source) {
          setActionMessage({ type: 'error', text: t('common.error') })
          return
        }
        setActionMessage({ type: 'success', text: t('skills.msgHubAdded', { name: input.name }) })
        setIsAddHubOpen(false)
        await loadSourcesAndSkills(source.id)
      },
    )

  const handleRemoveCustomHub = (sourceId: string) =>
    runSkillAction(
      () => electronApi().removeCustomHubSource(sourceId),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgHubRemoved') })
        await loadSourcesAndSkills(selectedSourceId === sourceId ? ALL_SKILL_SOURCES : selectedSourceId)
      },
    )

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
