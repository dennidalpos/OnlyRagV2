import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './diagnostics'
import { sidecarProcessManager } from './core/infrastructure/process/sidecarProcessManager'
import { taskRunner } from './core/infrastructure/process/taskRunner'
import { registerAgentIpcHandlers } from './core/presentation/agentIpc'
import { registerWorkspaceIpcHandlers } from './core/presentation/workspaceIpc'
import { registerSidecarIpcHandlers } from './core/presentation/sidecarIpc'
import { registerOllamaIpcHandlers } from './core/presentation/ollamaIpc'
import { registerSystemIpcHandlers } from './core/presentation/systemIpc'
import { registerSkillIpcHandlers } from './core/presentation/skillIpc'
import { registerSessionHistoryIpcHandlers } from './core/presentation/sessionHistoryIpc'
import { registerProjectRegistryIpcHandlers } from './core/presentation/projectRegistryIpc'
import { registerDiagnosticsIpcHandlers } from './core/presentation/diagnosticsIpc'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../public')

let win: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Global Exception & Unhandled Rejection Crash Safeguards
process.on('uncaughtException', (error) => {
  logger.log('ERROR', 'MainProcess', `Uncaught Exception in Main Process: ${error.message}\n${error.stack}`)
  taskRunner.cancelAllTasks()
})

process.on('unhandledRejection', (reason: any) => {
  logger.log('ERROR', 'MainProcess', `Unhandled Promise Rejection: ${reason?.message || reason}`)
})

function createWindow() {
  const iconPath = path.join(__dirname, '../assets/icon.png')
  win = new BrowserWindow({
    title: 'OnlyRag V2 - Local AI Workspace',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#020617', // slate-950
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('render-process-gone', (_, details) => {
    logger.log('WARN', 'MainProcess', `Renderer process gone/crashed: ${details.reason} (exitCode: ${details.exitCode})`)
    taskRunner.cancelAllTasks()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST || path.join(__dirname, '../dist'), 'index.html'))
  }

  logger.log('INFO', 'MainProcess', 'Window created successfully.')
}

app.on('before-quit', () => {
  logger.log('INFO', 'MainProcess', 'Application before-quit event triggered. Cleaning up active tasks & temp files...')
  taskRunner.cancelAllTasks()
  sidecarProcessManager.stopPythonSidecar()
  taskRunner.cleanTempResiduals().catch(() => {})
})

app.on('window-all-closed', () => {
  taskRunner.cancelAllTasks()
  sidecarProcessManager.stopPythonSidecar()
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Run context first, before anything else can fail. Without it a log line cannot be
  // attributed to a run: dev and the installed package resolve app.getPath('userData') to the
  // SAME folder (%APPDATA%/onlyrag-v2 — app.getName() reads `name`, not `productName`), so the
  // two write into one app.log with nothing distinguishing them. Investigating "app.log is
  // silent during my test sessions" then means guessing which build produced which line, and
  // the only accidental tell today is whether the sidecar path points at the repo or at
  // resources/. isPackaged and the PID make every future session attributable on sight.
  logger.log(
    'INFO',
    'MainProcess',
    `Run context: ${app.isPackaged ? 'PACKAGED' : 'DEV'} | version ${app.getVersion()} | pid ${process.pid} | exec ${process.execPath} | userData ${app.getPath('userData')}`
  )
  logger.log('INFO', 'MainProcess', 'Electron App Ready. Creating window & initializing Sidecar...')
  
  // Clean startup residuals
  taskRunner.cleanTempResiduals().catch(() => {})

  createWindow()
  sidecarProcessManager.startPythonSidecar()

  registerSystemIpcHandlers(() => win)
  registerOllamaIpcHandlers()
  registerWorkspaceIpcHandlers()
  registerSidecarIpcHandlers()
  registerAgentIpcHandlers(() => win)
  registerSkillIpcHandlers()
  registerSessionHistoryIpcHandlers()
  registerProjectRegistryIpcHandlers()
  registerDiagnosticsIpcHandlers()
})
