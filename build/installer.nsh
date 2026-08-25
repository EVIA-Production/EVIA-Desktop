!ifndef BUILD_UNINSTALLER

!macro taylosFailBootstrap
  MessageBox MB_OK|MB_ICONEXCLAMATION "Taylos could not start the Windows installer bootstrap. Close other Taylos installers and try again." /SD IDOK
  SetErrorLevel 3
  Quit
!macroend

# The release asset and installed application are both named Taylos.exe. The
# legacy uninstaller identifies a running app by image name, so it otherwise
# mistakes the new installer for the app and kills its own parent. Hand the
# exact signed bytes to a stable, non-conflicting filename before any mutex or
# uninstall checks run. The child waits on the original process handle so the
# legacy taskkill command can never observe a Taylos.exe installer process.
!macro preInit
  ${StdUtils.GetParameter} $R0 "taylos-bootstrap-parent" ""
  ${If} $R0 != ""
    System::Call "Kernel32::OpenProcess(i 1048576, i 0, i R0)i .R1"
    ${If} $R1 != 0
      System::Call "Kernel32::WaitForSingleObject(i R1, i 15000)i .R2"
      System::Call "Kernel32::CloseHandle(i R1)"
      ${If} $R2 != 0
        !insertmacro taylosFailBootstrap
      ${EndIf}
    ${EndIf}
  ${ElseIf} $EXEFILE == "${APP_EXECUTABLE_FILENAME}"
    ${StdUtils.GetAllParameters} $R0 0
    System::Call "Kernel32::GetCurrentProcessId()i .R1"
    StrCpy $R2 "$TEMP\taylos-installer-bootstrap"
    StrCpy $R3 "$R2\Taylos-Setup.exe"

    CreateDirectory "$R2"
    ClearErrors
    Delete "$R3"
    ClearErrors
    CopyFiles /SILENT "$EXEPATH" "$R3"
    ${If} ${Errors}
      !insertmacro taylosFailBootstrap
    ${EndIf}

    ClearErrors
    Exec '"$R3" $R0 --taylos-bootstrap-parent=$R1'
    ${If} ${Errors}
      !insertmacro taylosFailBootstrap
    ${EndIf}

    SetErrorLevel 0
    Quit
  ${EndIf}
!macroend

Var taylosMachineInstallBefore
Var taylosUserInstallBefore

!macro customInit
  Push $R8
  StrCpy $taylosMachineInstallBefore "0"
  StrCpy $taylosUserInstallBefore "0"

  ReadRegStr $R8 HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R8 != ""
    StrCpy $taylosMachineInstallBefore "1"
  ${EndIf}

  ReadRegStr $R8 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R8 != ""
    StrCpy $taylosUserInstallBefore "1"
  ${EndIf}
  Pop $R8
!macroend

!macro taylosFailClosedAfterUninstall
  MessageBox MB_OK|MB_ICONEXCLAMATION "Taylos could not safely prepare the existing installation directory. Restart Windows and run the installer again." /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

!macro taylosWaitForWritableInstallDirectory
  Push $R7
  Push $R8

  # The legacy uninstaller can return before Windows releases every nested
  # file handle. A root-level write probe alone can succeed during that race.
  Sleep 2000
  StrCpy $R8 0
  ${Do}
    CreateDirectory "$INSTDIR"
    ClearErrors
    FileOpen $R7 "$INSTDIR\.taylos-installer-write-probe" w
    ${IfNot} ${Errors}
      FileClose $R7
      Delete "$INSTDIR\.taylos-installer-write-probe"
      ClearErrors
      ${ExitDo}
    ${EndIf}

    IntOp $R8 $R8 + 1
    ${If} $R8 >= 20
      !insertmacro taylosFailClosedAfterUninstall
    ${EndIf}
    Sleep 500
  ${Loop}

  Pop $R8
  Pop $R7
!macroend

!macro taylosAssertInstallDirectoryEmpty
  Push $R4
  Push $R5
  Push $R6

  StrCpy $R4 "1"
  ClearErrors
  FindFirst $R6 $R5 "$INSTDIR\*"
  ${IfNot} ${Errors}
    ${Do}
      ${If} $R5 != "."
      ${AndIf} $R5 != ".."
        StrCpy $R4 "0"
        ${ExitDo}
      ${EndIf}

      ClearErrors
      FindNext $R6 $R5
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
    ${Loop}
    FindClose $R6
  ${EndIf}

  ${If} $R4 != "1"
    !insertmacro taylosFailClosedAfterUninstall
  ${EndIf}

  Pop $R6
  Pop $R5
  Pop $R4
!macroend

!macro taylosHandleUninstallResult HAD_INSTALL
  ${If} ${Errors}
    !insertmacro taylosFailClosedAfterUninstall
  ${EndIf}

  ${If} $R0 != 0
    ${If} ${FileExists} "$appExe"
      !insertmacro taylosFailClosedAfterUninstall
    ${EndIf}

    DetailPrint "The old uninstaller returned $R0 after removing the app; waiting for Windows to release the directory."
    StrCpy $R0 0
    ClearErrors
  ${EndIf}

  ${If} "${HAD_INSTALL}" == "1"
    !insertmacro taylosWaitForWritableInstallDirectory
    !insertmacro taylosAssertInstallDirectoryEmpty
  ${EndIf}
!macroend

!macro customUnInstallCheck
  ${If} $installMode == "all"
    !insertmacro taylosHandleUninstallResult $taylosMachineInstallBefore
  ${Else}
    !insertmacro taylosHandleUninstallResult $taylosUserInstallBefore
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro taylosHandleUninstallResult $taylosUserInstallBefore
!macroend

!macro customInstall
  ${StdUtils.GetParameter} $R0 "taylos-bootstrap-parent" ""
  ${If} $R0 != ""
    # The mapped installer cannot normally delete itself. Ask Windows to
    # remove it at reboot; the launched Taylos app also retries this cleanup
    # after the installer process releases its file handle.
    Delete /REBOOTOK "$EXEPATH"
    RMDir /REBOOTOK "$EXEDIR"
    ClearErrors
  ${EndIf}
!macroend

!endif
