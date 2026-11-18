; Custom NSIS steps for the Pharmacy Management setup wizard.
;
; This file adds one page and nothing else:
;
;   Welcome -> Software Activation -> Installation Location -> Install -> Finish
;
; The activation page asks for the install key ("Enter your serial key") that the
; owner generates in Top In Tech License Generator. A key is 16 characters in
; four groups, WXYZ-1234-5678-9ABC: twelve data characters plus four check
; characters. The data characters come from the license serial, so every
; customer gets their own key.
;
; The check is arithmetic, not cryptography, because NSIS ships no crypto
; library. TopInTech-LicenseGenerator/lib/setupkey.js runs exactly the same
; lines, and the two files must stay identical:
;
;     a = (a * 33 + alphabet[data[i]] + alphabet[SALT[i]] + i * 7) mod 100003
;     b = (a * 37 + 11) mod 100003
;     check = alphabet[a mod 32] alphabet[(a / 32) mod 32]
;             alphabet[b mod 32] alphabet[(b / 32) mod 32]
;
; A wrong, mistyped, invented or empty key keeps the customer on the page with a
; red message and the install never starts. An accepted key is remembered in the
; registry and in marker files, so a reinstall or an update on the same machine
; never asks again, and a machine that already has the app installed counts as
; activated.
;
; The application itself is untouched: this file only changes the installer.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; Crockford base32: no I, L, O or U, so a key survives being typed by hand.
!define SETUP_ALPHABET "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
; Must equal SALT in TopInTech-LicenseGenerator/lib/setupkey.js.
!define SETUP_SALT "7Q2M9K4X1B8T"
!define SETUP_MODULUS 100003
!define SETUP_APP_NAME "Pharmacy Management"
!define SETUP_REG_KEY "Software\Top In Tech\Pharmacy Management"
!define SETUP_REG_VALUE "Activated"
!define SETUP_MARKER "activated.txt"
!define SETUP_APP_EXE "Pharmacy Management.exe"

; ---------------------------------------------------------------------------
; Validates the text in ${KEY} and sets ${VALID} to "1" or "0".
; ${KEY} and ${VALID} must be general registers ($0, $1, ...): the macro works
; only in $R0-$R9 internally, and it changes them. It is a macro, not a function, so the uninstaller
; pass (which has no installer pages) compiles without an unused function and
; electron-builder's -WX stays clean.
; ---------------------------------------------------------------------------
!macro SetupKeyValidate KEY VALID
  StrCpy ${VALID} "0"

  ; First drop the separators, so WXYZ-1234-5678-9ABC, WXYZ 1234 5678 9ABC and
  ; WXYZ123456789ABC are all the same key. Written as a loop instead of StrRep
  ; because that macro lives in an optional include.
  StrCpy $R0 ""
  StrCpy $R1 ${KEY}
  StrLen $R3 $R1
  StrCpy $R9 "0"
  ${Do}
    ${If} $R9 >= $R3
      ${ExitDo}
    ${EndIf}
    StrCpy $R4 $R1 1 $R9
    ${If} $R4 != "-"
    ${AndIf} $R4 != " "
      StrCpy $R0 "$R0$R4"
    ${EndIf}
    IntOp $R9 $R9 + 1
  ${Loop}

  StrCpy $R1 "1"     ; every character so far is in the alphabet
  StrLen $R3 $R0
  ${If} $R3 == 16
    StrCpy $R2 "0"   ; a
    StrCpy $R3 "0"   ; i
    ${Do}
      ${If} $R3 >= 12
        ${ExitDo}
      ${EndIf}
      StrCpy $R4 $R0 1 $R3          ; the data character
      ; Its alphabet index -> $R5 (32 means "not in the alphabet").
      StrCpy $R5 "32"
      StrCpy $R6 "0"
      ${Do}
        ${If} $R6 >= 32
          ${ExitDo}
        ${EndIf}
        StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
        ${If} $R7 == $R4
          StrCpy $R5 $R6
          ${ExitDo}
        ${EndIf}
        IntOp $R6 $R6 + 1
      ${Loop}
      ${If} $R5 == 32
        StrCpy $R1 "0"
        ${ExitDo}
      ${EndIf}
      ; The salt character at the same position -> $R8.
      StrCpy $R7 "${SETUP_SALT}" 1 $R3
      StrCpy $R8 "32"
      StrCpy $R6 "0"
      ${Do}
        ${If} $R6 >= 32
          ${ExitDo}
        ${EndIf}
        StrCpy $R4 "${SETUP_ALPHABET}" 1 $R6
        ${If} $R4 == $R7
          StrCpy $R8 $R6
          ${ExitDo}
        ${EndIf}
        IntOp $R6 $R6 + 1
      ${Loop}
      ; a = (a * 33 + index + salt + i * 7) mod 100003
      IntOp $R2 $R2 * 33
      IntOp $R2 $R2 + $R5
      IntOp $R2 $R2 + $R8
      IntOp $R4 $R3 * 7
      IntOp $R2 $R2 + $R4
      IntOp $R2 $R2 % ${SETUP_MODULUS}
      IntOp $R3 $R3 + 1
    ${Loop}
    ${If} $R1 == 1
      ; b = (a * 37 + 11) mod 100003
      IntOp $R4 $R2 * 37
      IntOp $R4 $R4 + 11
      IntOp $R4 $R4 % ${SETUP_MODULUS}
      ; The four characters the key must end with.
      IntOp $R6 $R2 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R8 "$R7"
      IntOp $R6 $R2 / 32
      IntOp $R6 $R6 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R8 "$R8$R7"
      IntOp $R6 $R4 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R8 "$R8$R7"
      IntOp $R6 $R4 / 32
      IntOp $R6 $R6 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R8 "$R8$R7"
      StrCpy $R5 $R0 4 12          ; the check characters the customer typed
      ${If} $R8 == $R5
        StrCpy ${VALID} "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; Was this machine already activated? Sets $0 to "1".
; The registry is read through both views and both hives (a 32-bit setup writes
; under WOW6432Node); the marker files cover a run that could not write the
; registry; an installed application counts too. The machine-wide folder comes
; from the ProgramData environment variable, because the bundled NSIS has no
; constant for it and switching the shell context here would move the desktop
; shortcut the wizard later creates.
; ---------------------------------------------------------------------------
!macro SetupKnownCheck
  StrCpy $0 "0"
  SetRegView 64
  ReadRegStr $1 HKLM "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}"
  ${If} $1 == "1"
    StrCpy $0 "1"
  ${EndIf}
  ${If} $0 != "1"
    ReadRegStr $1 HKCU "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}"
    ${If} $1 == "1"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
  SetRegView 32
  ${If} $0 != "1"
    ReadRegStr $1 HKLM "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}"
    ${If} $1 == "1"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
  ${If} $0 != "1"
    ReadRegStr $1 HKCU "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}"
    ${If} $1 == "1"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
  SetRegView lastused

  ReadEnvStr $1 "ProgramData"
  ${If} $0 != "1"
    ${If} $1 != ""
      ${If} ${FileExists} "$1\Top In Tech\Pharmacy Management\${SETUP_MARKER}"
        StrCpy $0 "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $0 != "1"
    ${If} ${FileExists} "$LOCALAPPDATA\Top In Tech\Pharmacy Management\${SETUP_MARKER}"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
  ${If} $0 != "1"
    ${If} ${FileExists} "$APPDATA\Top In Tech\Pharmacy Management\${SETUP_MARKER}"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
  ${If} $0 != "1"
    ${If} ${FileExists} "$PROGRAMFILES64\${SETUP_APP_NAME}\${SETUP_APP_EXE}"
      StrCpy $0 "1"
    ${ElseIf} ${FileExists} "$PROGRAMFILES\${SETUP_APP_NAME}\${SETUP_APP_EXE}"
      StrCpy $0 "1"
    ${ElseIf} ${FileExists} "$LOCALAPPDATA\Programs\${SETUP_APP_NAME}\${SETUP_APP_EXE}"
      StrCpy $0 "1"
    ${EndIf}
  ${EndIf}
!macroend

; Records the activation everywhere SetupKnownCheck looks.
!macro SetupRemember
  SetRegView 64
  WriteRegStr HKLM "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}" "1"
  WriteRegStr HKCU "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}" "1"
  SetRegView 32
  WriteRegStr HKLM "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}" "1"
  WriteRegStr HKCU "${SETUP_REG_KEY}" "${SETUP_REG_VALUE}" "1"
  SetRegView lastused

  ReadEnvStr $1 "ProgramData"
  ${If} $1 != ""
    CreateDirectory "$1\Top In Tech\Pharmacy Management"
    FileOpen $9 "$1\Top In Tech\Pharmacy Management\${SETUP_MARKER}" w
    ${If} $9 != ""
      FileWrite $9 "activated$\r$\n"
      FileClose $9
    ${EndIf}
  ${EndIf}
  CreateDirectory "$LOCALAPPDATA\Top In Tech\Pharmacy Management"
  FileOpen $9 "$LOCALAPPDATA\Top In Tech\Pharmacy Management\${SETUP_MARKER}" w
  ${If} $9 != ""
    FileWrite $9 "activated$\r$\n"
    FileClose $9
  ${EndIf}
  CreateDirectory "$APPDATA\Top In Tech\Pharmacy Management"
  FileOpen $9 "$APPDATA\Top In Tech\Pharmacy Management\${SETUP_MARKER}" w
  ${If} $9 != ""
    FileWrite $9 "activated$\r$\n"
    FileClose $9
  ${EndIf}
!macroend

; electron-builder compiles this script twice. The first pass has
; BUILD_UNINSTALLER defined and contains no pages, so the page, its variables and
; its callbacks must not be compiled there.
!ifndef BUILD_UNINSTALLER

Var ActivationDialog
Var ActivationField
Var ActivationError
Var ActivationHeading

; This file is parsed before MUI2, so MUI macros must not be used here: the page
; draws its own title, like the screen the owner asked for.
Function ActivationPageShow
  ; An activated machine never sees this page: Abort in a custom page's create
  ; function removes the page from the wizard.
  !insertmacro SetupKnownCheck
  ${If} $0 == "1"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $ActivationDialog
  ${If} $ActivationDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "Pharmacy Management Activation"
  Pop $ActivationHeading
  SetCtlColors $ActivationHeading 0x1F2A44 transparent

  ${NSD_CreateLabel} 0 30u 100% 14u "Enter your serial key"
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

; Runs when Continue is pressed. Leaving the page is what lets the install start,
; so refusing to leave is exactly how a wrong key is blocked.
Function ActivationPageLeave
  ${NSD_GetText} $ActivationField $0

  ${If} $0 == ""
    ${NSD_SetText} $ActivationError "Please enter your serial key to continue."
    Abort
  ${EndIf}

  !insertmacro SetupKeyValidate $0 $1
  ${If} $1 != "1"
    ${NSD_SetText} $ActivationError "The key you entered is not valid. Check it and try again."
    Abort
  ${EndIf}
FunctionEnd

!macro customWelcomePage
  ; Welcome -> Software Activation -> Installation Location -> Install -> Finish.
  !insertmacro MUI_PAGE_WELCOME
  Page custom ActivationPageShow ActivationPageLeave
!macroend

!endif ; !ifndef BUILD_UNINSTALLER

; ------------------------------------------------------------- unattended guard
; A silent install (/S) never draws the page, so it must prove the key through
; the environment instead: PHARMACY_SETUP_KEY. A machine that is already
; activated is allowed through, so an unattended update never fails.
!macro customInit
  ${If} ${Silent}
    !insertmacro SetupKnownCheck
    ${If} $0 != "1"
      ReadEnvStr $0 "PHARMACY_SETUP_KEY"
      !insertmacro SetupKeyValidate $0 $1
      ${If} $1 != "1"
        ; Nothing is installed and nothing is written: the setup stops here.
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; -------------------------------------------------------------------- install
; The wizard already creates the Desktop shortcut and the Start-menu entry, so
; nothing here touches shortcuts (a second CreateShortcut is what once put two
; identical icons on the Desktop). It only records the activation.
!macro customInstall
  !insertmacro SetupRemember
!macroend
