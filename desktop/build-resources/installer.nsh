# electron-builder invokes this before running the installed uninstaller.
!macro customCheckAppRunning
  Push $0
  Push $1
  Push $2
  StrCpy $1 ""
  StrCpy $2 ""
  !ifndef BUILD_UNINSTALLER
    # The chosen destination may differ from the install that will be removed.
    ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $installMode == "all"
      ReadRegStr $2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
  !endif

  InitPluginsDir
  File /oname=$PLUGINSDIR\close-installed-app.ps1 "${BUILD_RESOURCES_DIR}\close-installed-app.ps1"
  DetailPrint "$(appClosing)"
  nsExec::ExecToLog '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-installed-app.ps1" "${APP_EXECUTABLE_FILENAME}" "$INSTDIR\." "$1\." "$2\."'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "Hymnix process check did not complete (exit $0)."
    IfSilent +2
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(appCannotBeClosed)"
    SetErrorLevel 2
    Quit
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend
