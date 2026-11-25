; Included by electron-builder (buildResources/installer.nsh) into the NSIS installer.
;
; The Start menu shortcut comes back when it is missing. electron-builder keeps existing shortcuts on update and
; reinstall (registry KeepShortcuts=true): it never recreates one that is gone. On 25.11.2026 Giannino's
; «SPACE Media Engine.lnk» was gone; neither the auto-update nor running the installer again brought it back, and
; Windows Search showed the app with a blank page as icon. customInstall runs after electron-builder's own
; shortcut step. An existing shortcut is left as it is. The desktop shortcut is not touched: deleting it is a
; choice of the person.
!macro customInstall
  ${ifNot} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
!macroend
