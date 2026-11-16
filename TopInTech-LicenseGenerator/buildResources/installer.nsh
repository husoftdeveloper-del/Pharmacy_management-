; Custom NSIS steps for the License Generator.
;
; Goal, exactly as the owner asked: double-click the setup file, it installs,
; the app opens, and an icon stays on the desktop that opens the app again later.
;
; Some Windows machines hide an installer shortcut because the Desktop folder has
; been redirected (OneDrive does this on most laptops). So the shortcut is written
; here into the current user's real desktop *and* into the OneDrive desktops when
; they exist, always with "SetShellVarContext current" so nothing lands on another
; account. The app repeats the same work on every start as a second safety net.
;
; The installer is per-user (allowElevation: false), so no password is ever asked.

!macro customInstall
  SetShellVarContext current

  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; 1. The desktop Windows hands to this user.
  CreateShortcut "$DESKTOP\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 2. The classic profile desktop, when it exists.
  IfFileExists "$PROFILE\Desktop\*.*" 0 +2
    CreateShortcut "$PROFILE\Desktop\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 3. The OneDrive desktop, when OneDrive redirected it.
  IfFileExists "$PROFILE\OneDrive\Desktop\*.*" 0 +2
    CreateShortcut "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 4. Start menu, so the app can always be found.
  CreateDirectory "$SMPROGRAMS\Top In Tech License Generator"
  CreateShortcut "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk" "$0" "" "$0" 0

  ; 5. Open the application straight away.
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$PROFILE\Desktop\Top In Tech License Generator.lnk"
  Delete "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend
