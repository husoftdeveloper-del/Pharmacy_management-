; Custom NSIS steps for the License Generator setup wizard.
;
; The installer itself is a classic Windows wizard (nsis.oneClick = false):
; Welcome -> Installation location (Program Files by default) -> Install ->
; Finish with "Run Top In Tech License Generator". The Finish page launches the
; app through runAfterFinish, so nothing is started from an elevated context.
;
; What is added here is only the shortcut work. A per-machine install runs
; elevated, and Windows then resolves $DESKTOP/$SMPROGRAMS to the administrator's
; profile. "SetShellVarContext current" switches them back to the account that
; started setup, so the desktop icon appears for the person who installed it.
; The shortcut is also copied into the profile and OneDrive desktops when those
; folders exist, because OneDrive redirects the desktop on many laptops.

!macro customInstall
  SetShellVarContext current

  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; 1. The desktop Windows gives this user.
  CreateShortcut "$DESKTOP\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 2. The profile desktop, when it exists.
  IfFileExists "$PROFILE\Desktop\*.*" 0 +2
    CreateShortcut "$PROFILE\Desktop\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 3. The OneDrive desktop, when OneDrive redirected it.
  IfFileExists "$PROFILE\OneDrive\Desktop\*.*" 0 +2
    CreateShortcut "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 4. Start menu entry for this user (the all-users entry is made by the wizard).
  CreateDirectory "$SMPROGRAMS\Top In Tech License Generator"
  CreateShortcut "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk" "$0" "" "$0" 0
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$PROFILE\Desktop\Top In Tech License Generator.lnk"
  Delete "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend
