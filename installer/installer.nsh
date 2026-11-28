!ifdef BUILD_UNINSTALLER
!include "nsDialogs.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var OnlyRagDeleteData
Var OnlyRagDeleteDataCheckbox
Var OnlyRagIsUpdated

!macro customUnInit
  StrCpy $OnlyRagDeleteData "0"
  StrCpy $OnlyRagIsUpdated "0"
  ${If} ${isUpdated}
    StrCpy $OnlyRagIsUpdated "1"
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.OnlyRagDataPage un.OnlyRagDataPageLeave
!macroend

Function un.OnlyRagDataPage
  ${If} $OnlyRagIsUpdated == "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Personal data / Dati personali" "Choose whether to remove saved data / Scegli se eliminare i dati salvati"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    MessageBox MB_ICONSTOP "Cannot show the data removal choice. / Impossibile mostrare la scelta sui dati."
    SetErrorLevel 1
    Quit
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 36u "By default, settings, chat history and indexed documents are preserved.$\r$\nImpostazioni, cronologia chat e documenti indicizzati sono conservati per impostazione predefinita."
  Pop $0
  ${NSD_CreateCheckbox} 0 45u 100% 20u "Delete personal data too / Elimina anche i dati personali"
  Pop $OnlyRagDeleteDataCheckbox
  ${If} $OnlyRagDeleteData == "1"
    ${NSD_Check} $OnlyRagDeleteDataCheckbox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function un.OnlyRagDataPageLeave
  ${NSD_GetState} $OnlyRagDeleteDataCheckbox $OnlyRagDeleteData
FunctionEnd

!macro customUnInstall
  ; Updates preserve data; silent removal needs the explicit existing flag.
  ${IfNot} ${isUpdated}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      StrCpy $OnlyRagDeleteData "1"
    ${EndIf}
    ${If} $OnlyRagDeleteData == "1"
      SetShellVarContext current
      RMDir /r "$APPDATA\onlyrag-v2"
      RMDir /r "$APPDATA\OnlyRag V2"
      RMDir /r "$LOCALAPPDATA\OnlyRagV2"
      RMDir /r "$LOCALAPPDATA\onlyrag-v2"
      RMDir /r "$LOCALAPPDATA\onlyrag-v2-updater"
      RMDir /r "$PROFILE\.onlyragv2"
      RMDir /r "$PROFILE\.onlyrag_v2"
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
!endif
