import { ipcMain } from 'electron'
import { skillAppService } from '../application/skillAppService'
import { CustomHubInput, SkillSaveInput } from '../domain/skills/skillTypes'

export function registerSkillIpcHandlers() {
  ipcMain.handle('skills:list-installed', async (_event, workspaceRoot?: string) => {
    return skillAppService.listInstalledSkills(workspaceRoot)
  })

  ipcMain.handle('skills:list-hub', async (_event, workspaceRoot?: string) => {
    return skillAppService.listHubSkills(workspaceRoot)
  })

  ipcMain.handle('skills:list-sources', async () => {
    return skillAppService.listHubSources()
  })

  ipcMain.handle('skills:add-custom-source', async (_event, input: CustomHubInput) => {
    return skillAppService.addCustomHubSource(input)
  })

  ipcMain.handle('skills:remove-custom-source', async (_event, sourceId: string) => {
    return skillAppService.removeCustomHubSource(sourceId)
  })

  ipcMain.handle('skills:list-hub-by-source', async (_event, sourceId: string, workspaceRoot?: string) => {
    return skillAppService.listHubSkillsBySource(sourceId, workspaceRoot)
  })

  ipcMain.handle('skills:toggle-active', async (_event, skillId: string, isActive: boolean) => {
    return skillAppService.toggleSkillActive(skillId, isActive)
  })

  ipcMain.handle('skills:install-from-hub', async (_event, hubSkillId: string, workspaceRoot?: string, hubSourceId?: string) => {
    return skillAppService.installFromHub(hubSkillId, workspaceRoot, hubSourceId)
  })

  ipcMain.handle('skills:install-from-url', async (_event, url: string, workspaceRoot?: string, customName?: string) => {
    return skillAppService.installFromUrl(url, workspaceRoot, customName)
  })

  ipcMain.handle('skills:save-custom', async (_event, input: SkillSaveInput, workspaceRoot?: string) => {
    return skillAppService.createOrUpdateSkill(input, workspaceRoot)
  })

  ipcMain.handle('skills:reset-original', async (_event, skillId: string, workspaceRoot?: string) => {
    return skillAppService.resetSkillToOriginal(skillId, workspaceRoot)
  })

  ipcMain.handle('skills:uninstall', async (_event, skillId: string, workspaceRoot?: string) => {
    return skillAppService.uninstallSkill(skillId, workspaceRoot)
  })
}
