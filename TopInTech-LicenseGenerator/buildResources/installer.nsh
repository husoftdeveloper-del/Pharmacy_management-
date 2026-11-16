; Custom NSIS steps for the Top In Tech License Generator setup wizard.
;
; Two things live here, and nothing else:
;
; 1. The activation page: "Software Activation" with an "Enter Your Key" field
;    and Continue / Cancel buttons, shown after Welcome and before the
;    installation location. The key is compared case-sensitively (StrCmpS).
;    A wrong or empty key keeps the user on the page with an error and blocks
;    the install. The key is never written into a label, header, log or error
;    string - it exists only in its own !define and in the comparison. Once a
;    machine is activated the flag is stored in the registry, so setup never
;    asks again (repair, reinstall or update).
;
; 2. The shortcuts. A per-machine install runs elevated, and Windows then
;    resolves $DESKTOP/$SMPROGRAMS to the administrator profile, so
;    "SetShellVarContext current" switches them back to the account that
;    started setup. The shortcut is also copied into the profile and OneDrive
;    desktops when those folders exist, because OneDrive redirects the desktop
;    on many laptops.
;
; The application itself is untouched: this file only changes the installer.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; The one accepted activation key. It is compiled into setup.exe and is only
; ever read by the comparisons below; no page, header, button or message shows
; it.
!define ACTIVATION_KEY "mynewpharmacy1221"
!define ACTIVATION_REG_KEY "Software\Top In Tech\License Generator"
!define ACTIVATION_REG_VALUE "Activated"

; electron-builder compiles the script twice. The first pass has
; BUILD_UNINSTALLER defined and contains no pages at all, so the page and its
; callbacks must not be compiled there: an install function that nothing
; references raises "warning 6010", and the build uses -WX (warnings as errors).
!ifndef BUILD_UNINSTALLER

Var ActivationDialog
Var ActivationField
Var ActivationError
Var ActivationHeading

; ---------------------------------------------------------------- activation
; This file is parsed before MUI2, so MUI macros (MUI_HEADER_TEXT and the MUI
; page defines) must not be used here. The page draws its own title.
Function ActivationPageShow
  ; An activated machine never sees this page again: Abort in a custom page's
  ; create function removes the page from the wizard.
  ReadRegStr $0 HKLM "${ACTIVATION_REG_KEY}" "${ACTIVATION_REG_VALUE}"
  ${If} $0 == "1"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $ActivationDialog
  ${If} $ActivationDialog == error
    Abort
  ${EndIf}

  ; Heading.
  ${NSD_CreateLabel} 0 0 100% 22u "Software Activation"
  Pop $ActivationHeading
  SetCtlColors $ActivationHeading 0x1F2A44 transparent

  ${NSD_CreateLabel} 0 30u 100% 14u "Enter Your Key"
  Pop $0

  ${NSD_CreateText} 0 46u 100% 14u ""
  Pop $ActivationField
  ${NSD_SetFocus} $ActivationField

  ${NSD_CreateLabel} 0 66u 100% 28u ""
  Pop $ActivationError
  SetCtlColors $ActivationError 0xB00020 transparent

  ; The wizard's Next / Cancel buttons are this form's Continue / Cancel.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Continue"
  GetDlgItem $0 $HWNDPARENT 2
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Cancel"

  nsDialogs::Show
FunctionEnd

; Runs when Continue is pressed. Leaving the page is what lets the install
; start, so refusing to leave is exactly how an invalid key is blocked.
Function ActivationPageLeave
  ${NSD_GetText} $ActivationField $0

  ${If} $0 == ""
    ${NSD_SetText} $ActivationError "Please enter your license key to continue."
    Abort
  ${EndIf}

  ; Case-sensitive on purpose: an upper-case copy of the key is not accepted.
  StrCmpS $0 "${ACTIVATION_KEY}" ActivationAccepted
    ${NSD_SetText} $ActivationError "The key you entered is not valid. Check it and try again."
    Abort

ActivationAccepted:
FunctionEnd

!macro customWelcomePage
  ; Welcome -> Software Activation -> Installation Location -> Install -> Finish.
  !insertmacro MUI_PAGE_WELCOME

  Page custom ActivationPageShow ActivationPageLeave
!macroend

!endif ; !ifndef BUILD_UNINSTALLER

; ------------------------------------------------------------- unattended guard
; A silent install (/S) never draws the page, so it could otherwise skip the key
; check. Silent runs must therefore prove the key through the environment and
; are refused outright when they cannot.
!macro customInit
  ${If} ${Silent}
    ReadEnvStr $R0 "TIT_SETUP_KEY"
    StrCmpS $R0 "${ACTIVATION_KEY}" ActivationSilentAccepted
      SetErrorLevel 2
      Quit

ActivationSilentAccepted:
    SetShellVarContext all
    WriteRegStr HKLM "${ACTIVATION_REG_KEY}" "${ACTIVATION_REG_VALUE}" "1"
  ${EndIf}
!macroend

; -------------------------------------------------------------------- install
; The wizard itself already creates the Desktop shortcut (in the all-users
; Desktop, so every account sees it) and the Start-menu entry. Creating another
; one here is what put TWO identical icons on the Desktop in 2.0.0/2.1.0, so
; this macro only cleans up the duplicates those versions left behind for the
; account that runs setup, then records the activation.
!macro customInstall
  ; The key was accepted by this run, so this machine is activated from now on.
  SetShellVarContext all
  WriteRegStr HKLM "${ACTIVATION_REG_KEY}" "${ACTIVATION_REG_VALUE}" "1"

  ; Switch to the account that started setup and drop its private copies: the
  ; all-users Desktop / Start-menu entries made by the wizard stay untouched.
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$PROFILE\Desktop\Top In Tech License Generator.lnk"
  Delete "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend

!macro customUnInstall
  ; The wizard removes its own all-users shortcuts; these are the per-user
  ; copies older versions created.
  SetShellVarContext current
  Delete "$DESKTOP\Top In Tech License Generator.lnk"
  Delete "$PROFILE\Desktop\Top In Tech License Generator.lnk"
  Delete "$PROFILE\OneDrive\Desktop\Top In Tech License Generator.lnk"
  Delete "$SMPROGRAMS\Top In Tech License Generator\Top In Tech License Generator.lnk"
  RMDir "$SMPROGRAMS\Top In Tech License Generator"
!macroend
