import { secureIpcMain as ipcMain } from './secureIpcMain'
import { skillAppService } from '../application/skillAppService'

export function registerSkillIpcHandlers() {
  ipcMain.handle('skills:list-installed', async (_event, payload) => {
    return skillAppService.listInstalledSkills(payload?.workspaceRoot)
  })

  ipcMain.handle('skills:list-sources', async () => {
    return skillAppService.listHubSources()
  })

  ipcMain.handle('skills:add-custom-source', async (_event, input) => {
    return skillAppService.addCustomHubSource(input)
  })

  ipcMain.handle('skills:remove-custom-source', async (_event, { sourceId }) => {
    return skillAppService.removeCustomHubSource(sourceId)
  })

  ipcMain.handle('skills:list-hub-by-source', async (_event, { sourceId, workspaceRoot, forceRefresh }) => {
    return skillAppService.listHubSkillsBySource(sourceId, workspaceRoot, forceRefresh)
  })

  ipcMain.handle('skills:list-hub-all', async (_event, payload) => {
    return skillAppService.listHubSkillsAcrossSources(payload?.workspaceRoot, payload?.forceRefresh)
  })

  ipcMain.handle('skills:get-hub-skill-content', async (_event, item) => {
    return skillAppService.getHubSkillContent(item)
  })

  ipcMain.handle('skills:toggle-active', async (_event, { skillId, isActive }) => {
    return skillAppService.toggleSkillActive(skillId, isActive)
  })

  ipcMain.handle('skills:install-from-hub', async (_event, { hubSkillId, workspaceRoot, hubSourceId }) => {
    return skillAppService.installFromHub(hubSkillId, workspaceRoot, hubSourceId)
  })

  ipcMain.handle('skills:install-from-url', async (_event, { url, workspaceRoot, customName }) => {
    return skillAppService.installFromUrl(url, workspaceRoot, customName)
  })

  ipcMain.handle('skills:save-custom', async (_event, { input, workspaceRoot }) => {
    return skillAppService.createOrUpdateSkill(input, workspaceRoot)
  })

  ipcMain.handle('skills:reset-original', async (_event, { skillId, workspaceRoot }) => {
    return skillAppService.resetSkillToOriginal(skillId, workspaceRoot)
  })

  ipcMain.handle('skills:uninstall', async (_event, { skillId, workspaceRoot }) => {
    return skillAppService.uninstallSkill(skillId, workspaceRoot)
  })
}
