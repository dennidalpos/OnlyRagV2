import { useState, useEffect, useRef } from 'react'
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

  // Ownership of asynchronous results: `generation` changes whenever the modal closes or the workspace changes,
  // and each read carries a token so only the latest request per list may update state, loading and errors.
  const generationRef = useRef(0)
  const installedReadRef = useRef(0)
  const hubReadRef = useRef(0)
  const isScopeCurrent = (generation: number) => generation === generationRef.current

  const loadSourcesAndSkills = async (sourceIdToUse?: string) => {
    const generation = generationRef.current
    const installedToken = ++installedReadRef.current
    const hubToken = ++hubReadRef.current
    const ownsHub = () => isScopeCurrent(generation) && hubToken === hubReadRef.current
    setIsLoading(true)
    try {
      const [installed, sourcesList] = await Promise.all([
        electronApi().listInstalledSkills({ workspaceRoot: workspacePath || undefined }),
        electronApi().listHubSources(),
      ])
      if (!isScopeCurrent(generation)) return
      if (installedToken === installedReadRef.current) setInstalledSkills(installed)
      setSources(sourcesList)

      const activeSourceId = sourceIdToUse || selectedSourceId || ALL_SKILL_SOURCES
      if (ownsHub()) setSelectedSourceId(activeSourceId)

      const hub =
        activeSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined })
          : await electronApi().listHubSkillsBySource({ sourceId: activeSourceId, workspaceRoot: workspacePath || undefined })
      if (ownsHub()) setHubSkills(hub)
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error loading skills/sources: ${errorMessage(err)}`)
      if (ownsHub()) setActionMessage({ type: 'error', text: errorMessage(err) })
    } finally {
      if (ownsHub()) setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    setInstalledSkills([])
    setHubSkills([])
    setInstallingSkillId(null)
    setActionMessage(null)
    void loadSourcesAndSkills()
    return () => {
      // Closing or switching workspace invalidates every request still in flight.
      generationRef.current += 1
      setIsLoading(false)
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
    const generation = generationRef.current
    const hubToken = ++hubReadRef.current
    const ownsHub = () => isScopeCurrent(generation) && hubToken === hubReadRef.current
    setSelectedSourceId(newSourceId)
    setIsLoading(true)
    if (forceRefresh) setHubSkills([]) // Clear previous items when explicitly refreshing
    try {
      const hub =
        newSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined, forceRefresh })
          : await electronApi().listHubSkillsBySource({ sourceId: newSourceId, workspaceRoot: workspacePath || undefined, forceRefresh })
      if (ownsHub()) setHubSkills(hub)
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error changing source: ${errorMessage(err)}`)
    } finally {
      if (ownsHub()) setIsLoading(false)
    }
  }

  // Refresh remote skills when tab switches to hub
  const handleTabChange = async (tab: 'installed' | 'hub') => {
    setActiveTab(tab)
    const generation = generationRef.current
    if (tab === 'hub') {
      const hubToken = ++hubReadRef.current
      const ownsHub = () => isScopeCurrent(generation) && hubToken === hubReadRef.current
      setIsLoading(true)
      try {
        const hub =
          selectedSourceId === ALL_SKILL_SOURCES
            ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined })
            : await electronApi().listHubSkillsBySource({ sourceId: selectedSourceId, workspaceRoot: workspacePath || undefined })
        if (ownsHub()) setHubSkills(hub)
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching hub skills on tab switch: ${errorMessage(err)}`)
      } finally {
        if (ownsHub()) setIsLoading(false)
      }
    } else {
      const installedToken = ++installedReadRef.current
      try {
        const installed = await electronApi().listInstalledSkills({ workspaceRoot: workspacePath || undefined })
        if (isScopeCurrent(generation) && installedToken === installedReadRef.current) setInstalledSkills(installed)
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching installed skills on tab switch: ${errorMessage(err)}`)
      }
    }
  }

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    const generation = generationRef.current
    setActionMessage(null)
    try {
      const toggled = await electronApi().toggleSkillActive({ skillId, isActive: !currentActive })
      if (!isScopeCurrent(generation)) return
      if (!toggled) {
        setActionMessage({ type: 'error', text: t('common.error') })
        return
      }
      setInstalledSkills((prev) => prev.map((s) => (s.id === skillId || s.name === skillId ? { ...s, isActive: !currentActive } : s)))
    } catch (err: unknown) {
      if (isScopeCurrent(generation)) setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    }
  }

  const handleInstallFromHub = async (hubSkillId: string) => {
    const generation = generationRef.current
    setInstallingSkillId(hubSkillId)
    setActionMessage(null)
    try {
      const res = await electronApi().installSkillFromHub({ hubSkillId, workspaceRoot: workspacePath || undefined, hubSourceId: selectedSourceId })
      // The install ran against the workspace it was issued for; only the UI update is dropped when the scope changed.
      if (!isScopeCurrent(generation)) return
      if (res.success) {
        setActionMessage({ type: 'success', text: t('skills.msgInstalled', { name: hubSkillId }) })
        // Mark as installed in local hubSkills state immediately
        setHubSkills((prev) => prev.map((s) => (s.id === hubSkillId ? { ...s, isInstalled: true } : s)))
        // Refresh installed skills in background without triggering full-page loading or scroll reset
        const installedToken = ++installedReadRef.current
        const installed = await electronApi().listInstalledSkills({ workspaceRoot: workspacePath || undefined })
        if (isScopeCurrent(generation) && installedToken === installedReadRef.current) setInstalledSkills(installed)
      } else {
        setActionMessage({ type: 'error', text: res.error || t('common.error') })
      }
    } catch (err: unknown) {
      if (isScopeCurrent(generation)) setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    } finally {
      if (isScopeCurrent(generation)) setInstallingSkillId(null)
    }
  }

  /** Runs one skill or hub mutation behind the loading state and reports its failure, returned or thrown. */
  const runSkillAction = async <T extends { success: boolean; error?: string }>(action: () => Promise<T>, onSuccess: (res: T) => Promise<void> | void) => {
    const generation = generationRef.current
    setIsLoading(true)
    try {
      const res = await action()
      // The mutation ran against the workspace it was issued for; only the UI update is dropped when the scope changed.
      if (!isScopeCurrent(generation)) return
      if (res.success) await onSuccess(res)
      else setActionMessage({ type: 'error', text: res.error || t('common.error') })
    } catch (err: unknown) {
      if (isScopeCurrent(generation)) setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    } finally {
      if (isScopeCurrent(generation)) setIsLoading(false)
    }
  }

  const handleInstallFromUrl = async (url: string, customName?: string) => {
    setActionMessage(null)
    await runSkillAction(
      () => electronApi().installSkillFromUrl({ url, workspaceRoot: workspacePath || undefined, customName }),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgUrlImported') })
        await loadSourcesAndSkills(selectedSourceId)
        setActiveTab('installed')
      },
    )
  }

  const handleSaveCustomSkill = (input: SkillSaveInput) =>
    runSkillAction(
      () => electronApi().saveCustomSkill({ input, workspaceRoot: workspacePath || undefined }),
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
      () => electronApi().resetSkillToOriginal({ skillId, workspaceRoot: workspacePath || undefined }),
      async () => {
        setActionMessage({ type: 'success', text: t('skills.msgReset', { name: skillId }) })
        await loadSourcesAndSkills(selectedSourceId)
      },
    )

  const handleDeleteSkill = (skillId: string) =>
    runSkillAction(
      () => electronApi().uninstallSkill({ skillId, workspaceRoot: workspacePath || undefined }),
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
      () => electronApi().removeCustomHubSource({ sourceId }),
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
