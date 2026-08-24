; ==============================================================================
; OnlyRag V2 - Custom NSIS Uninstaller Script
; ==============================================================================
; Ensures that upon uninstalling OnlyRag V2:
; 1. Any lingering sidecar or app processes are terminated so files are not locked.
; 2. All application caches, logs, user settings, and LanceDB stores are wiped.
; ==============================================================================

!macro customUnInstall
  ; Terminate running background processes if any (sidecar.exe, OnlyRag V2.exe)
  nsExec::Exec 'taskkill /F /IM sidecar.exe /T'
  nsExec::Exec 'taskkill /F /IM "OnlyRag V2.exe" /T'
  nsExec::Exec 'taskkill /F /IM electron.exe /T'

  ; Small delay to allow file handles to be released
  Sleep 1000

  ; Remove all app data, caches, logs, LanceDB, and user configurations
  RMDir /r "$APPDATA\onlyrag-v2"
  RMDir /r "$APPDATA\OnlyRag V2"
  RMDir /r "$LOCALAPPDATA\OnlyRagV2"
  RMDir /r "$LOCALAPPDATA\onlyrag-v2"
  RMDir /r "$LOCALAPPDATA\onlyrag-v2-updater"
  RMDir /r "$PROFILE\.onlyragv2"
  RMDir /r "$PROFILE\.onlyrag_v2"
!macroend
