; Custom NSIS steps for the License Generator.
;
; electron-builder's one-click installer would create the desktop icon from an
; elevated context, and the icon then lands on the desktop of the administrator
; account instead of the person who ran setup. Creating the shortcut here with
; "SetShellVarContext current" pins it to the real user. The installer is
; per-user (allowElevation: false), so nothing here needs a password.
;
; The application is also started from here, so it opens no matter how setup was
; run (interactive or /S). Its single-instance lock means a second launch only
; brings the existing window forward, never a duplicate.

!macro customInstall
  SetShellVarContext current
  CreateShortcut "$DESKTOP\Top In Tech License Generator.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateDirectory "$SMPROGRAMS\Top In Tech License Generator"
  CreateShortcut "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ; Open the application straight away, from the same user context.
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend
