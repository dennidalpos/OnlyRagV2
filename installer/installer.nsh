; ==============================================================================
; OnlyRag V2 - Custom NSIS Uninstaller Script
; ==============================================================================
; Ensures that upon uninstalling OnlyRag V2:
; 1. The OnlyRag application process is terminated so installed files are not locked.
; 2. All application caches, logs, user settings, and LanceDB stores are wiped.
; ==============================================================================

!macro customUnInstall
  ; Only the product-specific executable is targeted. Never kill generic Electron,
  ; Python, or sidecar process names because they may belong to another application.
  nsExec::Exec 'taskkill /F /IM "OnlyRag V2.exe" /T'

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
