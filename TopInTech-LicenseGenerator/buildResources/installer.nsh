; Custom NSIS steps for the License Generator.
;
; electron-builder's one-click installer creates the desktop icon from the
; elevated context when Windows raises a UAC prompt, and the icon then lands on
; the desktop of the administrator account instead of the person who ran setup.
; Creating the shortcut here with "SetShellVarContext current" pins it to the
; current user's real desktop. The installer is per-user (allowElevation: false),
; so this runs without ever asking for a password.

!macro customInstall
  SetShellVarContext current
  CreateShortcut "$DESKTOP\Top In Tech License Generator.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateDirectory "$SMPROGRAMS\Top In Tech License Generator"
  CreateShortcut "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend
