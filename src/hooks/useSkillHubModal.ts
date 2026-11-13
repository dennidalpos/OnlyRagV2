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
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sub-modal states
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [editorSaveError, setEditorSaveError] = useState<string>()
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [isAddHubOpen, setIsAddHubOpen] = useState(false)

  // Ownership of asynchronous results: `generation` changes whenever the modal closes or the workspace changes,
  // and each read carries a token so only the latest request per list may update state, loading and errors.
  const generationRef = useRef(0)
  const installedReadRef = useRef(0)
  const hubReadRef = useRef(0)
  const foregroundReadRef = useRef(0)
  const isScopeCurrent = (generation: number) => generation === generationRef.current

  const loadSourcesAndSkills = async (sourceIdToUse?: string) => {
    const generation = generationRef.current
    const installedToken = ++installedReadRef.current
    const hubToken = ++hubReadRef.current
    const foregroundToken = ++foregroundReadRef.current
    const ownsHub = () => isScopeCurrent(generation) && hubToken === hubReadRef.current
    setIsLoading(true)
    setIsLoadingSources(true)
    try {
      const [installed, sourcesList] = await Promise.all([
        electronApi().listInstalledSkills({ workspaceRoot: workspacePath || undefined }),
        electronApi().listHubSources(),
      ])
      if (!isScopeCurrent(generation)) return
      if (installedToken === installedReadRef.current) setInstalledSkills(installed)
      if (!ownsHub()) return
      setSources(sourcesList)

      const activeSourceId = sourceIdToUse || selectedSourceId || ALL_SKILL_SOURCES
      setSelectedSourceId(activeSourceId)

      const hub =
        activeSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined })
          : await electronApi().listHubSkillsBySource({ sourceId: activeSourceId, workspaceRoot: workspacePath || undefined })
      if (ownsHub()) {
        setHubSkills(hub)
        setLoadError(null)
      }
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error loading skills/sources: ${errorMessage(err)}`)
      if (ownsHub()) setLoadError(errorMessage(err))
    } finally {
      if (isScopeCurrent(generation) && foregroundToken === foregroundReadRef.current) setIsLoading(false)
      if (ownsHub()) setIsLoadingSources(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    setInstalledSkills([])
    setHubSkills([])
    setInstallingSkillId(null)
    setActionMessage(null)
    setLoadError(null)
    setEditorSaveError(undefined)
    setIsEditorOpen(false)
    setEditingSkill(null)
    void loadSourcesAndSkills()
    return () => {
      // Closing or switching workspace invalidates every request still in flight.
      generationRef.current += 1
      setIsLoading(false)
      setIsLoadingSources(false)
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
    const foregroundToken = ++foregroundReadRef.current
    const ownsHub = () => isScopeCurrent(generation) && hubToken === hubReadRef.current
    setSelectedSourceId(newSourceId)
    setIsLoading(true)
    if (forceRefresh) setHubSkills([]) // Clear previous items when explicitly refreshing
    try {
      const hub =
        newSourceId === ALL_SKILL_SOURCES
          ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined, forceRefresh })
          : await electronApi().listHubSkillsBySource({ sourceId: newSourceId, workspaceRoot: workspacePath || undefined, forceRefresh })
      if (ownsHub()) {
        setHubSkills(hub)
        setLoadError(null)
      }
    } catch (err: unknown) {
      logger.error('SkillHubModal', `Error changing source: ${errorMessage(err)}`)
      if (ownsHub()) setLoadError(errorMessage(err))
    } finally {
      if (ownsHub()) {
        setIsLoadingSources(false)
        if (foregroundToken === foregroundReadRef.current) setIsLoading(false)
      }
    }
  }

  // Refresh remote skills when tab switches to hub
  const handleTabChange = async (tab: 'installed' | 'hub') => {
    setActiveTab(tab)
    const generation = generationRef.current
    // A tab switch supersedes both lists and owns loading until its own read completes.
    const hubToken = ++hubReadRef.current
    const installedToken = ++installedReadRef.current
    const foregroundToken = ++foregroundReadRef.current
    const ownsTab = () => isScopeCurrent(generation) && foregroundToken === foregroundReadRef.current
    setIsLoading(true)
    if (tab === 'hub') {
      try {
        const hub =
          selectedSourceId === ALL_SKILL_SOURCES
            ? await electronApi().listHubSkillsAcrossSources({ workspaceRoot: workspacePath || undefined })
            : await electronApi().listHubSkillsBySource({ sourceId: selectedSourceId, workspaceRoot: workspacePath || undefined })
        if (ownsTab() && hubToken === hubReadRef.current) {
          setHubSkills(hub)
          setLoadError(null)
        }
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching hub skills on tab switch: ${errorMessage(err)}`)
        if (ownsTab() && hubToken === hubReadRef.current) setLoadError(errorMessage(err))
      } finally {
        if (ownsTab()) setIsLoading(false)
      }
    } else {
      try {
        const installed = await electronApi().listInstalledSkills({ workspaceRoot: workspacePath || undefined })
        if (ownsTab() && installedToken === installedReadRef.current) {
          setInstalledSkills(installed)
          setLoadError(null)
        }
      } catch (err: unknown) {
        logger.error('SkillHubModal', `Error fetching installed skills on tab switch: ${errorMessage(err)}`)
        if (ownsTab() && installedToken === installedReadRef.current) setLoadError(errorMessage(err))
      } finally {
        if (ownsTab()) setIsLoading(false)
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
  const runSkillAction = async <T extends { success: boolean; error?: string }>(
    action: () => Promise<T>,
    onSuccess: (res: T, isCurrent: () => boolean) => Promise<void> | void,
  ) => {
    const generation = generationRef.current
    setIsLoading(true)
    const foregroundToken = ++foregroundReadRef.current
    try {
      const res = await action()
      // The mutation ran against the workspace it was issued for; only the UI update is dropped when the scope changed.
      if (!isScopeCurrent(generation)) return
      if (res.success) await onSuccess(res, () => isScopeCurrent(generation))
      else setActionMessage({ type: 'error', text: res.error || t('common.error') })
    } catch (err: unknown) {
      if (isScopeCurrent(generation)) setActionMessage({ type: 'error', text: errorMessage(err) || t('common.error') })
    } finally {
      if (isScopeCurrent(generation) && foregroundToken === foregroundReadRef.current) setIsLoading(false)
    }
  }

  const handleInstallFromUrl = async (url: string, customName?: string) => {
    setActionMessage(null)
    await runSkillAction(
      () => electronApi().installSkillFromUrl({ url, workspaceRoot: workspacePath || undefined, customName }),
      async (_res, isCurrent) => {
        setActionMessage({ type: 'success', text: t('skills.msgUrlImported') })
        await loadSourcesAndSkills(selectedSourceId)
        if (isCurrent()) setActiveTab('installed')
      },
    )
  }

  const handleSaveCustomSkill = (input: SkillSaveInput) => {
    setEditorSaveError(undefined)
    return runSkillAction(
      async () => {
        const generation = generationRef.current
        try {
          const result = await electronApi().saveCustomSkill({ input, workspaceRoot: workspacePath || undefined })
          if (!result.success && isScopeCurrent(generation)) setEditorSaveError(result.error || t('common.error'))
          return result
        } catch (error) {
          if (isScopeCurrent(generation)) setEditorSaveError(errorMessage(error))
          throw error
        }
      },
      async (_res, isCurrent) => {
        setActionMessage({ type: 'success', text: t('skills.msgSaved', { name: input.name }) })
        setIsEditorOpen(false)
        setEditingSkill(null)
        await loadSourcesAndSkills(selectedSourceId)
        if (isCurrent()) setActiveTab('installed')
      },
    )
  }

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
    isLoadingSources,
    loadError,
    retryLoad: () => loadSourcesAndSkills(selectedSourceId),
    installingSkillId,
    actionMessage,
    isEditorOpen,
    setIsEditorOpen,
    editingSkill,
    setEditingSkill,
    editorSaveError,
    clearEditorSaveError: () => setEditorSaveError(undefined),
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
