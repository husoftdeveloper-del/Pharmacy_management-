; Custom NSIS steps for the Pharmacy Management setup wizard.
;
; This file adds one page and nothing else:
;
;   Welcome -> Software Activation -> Installation Location -> Install -> Finish
;
; The page asks for two things:
;
;   1. "Enter your Pharmacy Name"  - the customer's own pharmacy name, written
;      into the licence so the application opens with it already filled in.
;   2. "Enter your serial key"     - the key the owner generates in Top In Tech
;      License Generator.
;
; The key is SIX characters, letters and digits mixed: 7M2K4X. Two characters
; come from the license serial (which license), three hold the last valid day
; and one is a check character that proves the rest was typed correctly. Every
; customer therefore gets their own key, and the key says when the licence ends.
; A licence shorter than a day (the 10 Minutes plan) cannot hold a moment in six
; characters, so it keeps the older twelve-character shape, ABC-123-456-789:
; five data, three day, three minute, one check. The older nine-character
; ABC-123-456 and sixteen-character WXYZ-1234-5678-9ABC keys are still accepted.
;
; After the key is accepted the setup writes the licence next to the application
; and in the user's application-data folder, so the application itself can stop
; the sign-in screen once that day has passed. The application is not modified
; in any other way.
;
; The check is arithmetic, not cryptography, because NSIS ships no crypto
; library. TopInTech-LicenseGenerator/lib/setupkey.js runs exactly the same
; lines, and the two files must stay identical:
;
;     a = (a * 33 + alphabet[data[i]] + alphabet[SALT[i]] + i * 7) mod 100003
;     check = alphabet[a mod 32]
;
; The expiry day is three base32 characters counting days from 2025-01-01 (UTC);
; 000 means a lifetime licence.
;
; The page is shown on EVERY run of Setup.exe: first installation, reinstall,
; repair, upgrade, and an install after an uninstall. Nothing about an earlier
; installation on the same computer is remembered or trusted, so a previous
; install can never let a later setup through without a key.
;
; A wrong, mistyped, invented or empty key keeps the customer on the page with
; the message "Invalid Serial Key! / Application Not Installed." and the install
; never starts. Cancel closes the wizard without installing anything.
;
; The key is typed once, here. The application never asks for it again: it only
; reads the licence this page writes, and after the last valid day it refuses to
; sign anyone in until the owner issues a new key.
;
; The application's own code is untouched: this file only changes the installer.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; Crockford base32: no I, L, O or U, so a key survives being typed by hand.
!define SETUP_ALPHABET "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
; Must equal SALT in TopInTech-LicenseGenerator/lib/setupkey.js.
!define SETUP_SALT "7Q2M9K4X1B8T"
!define SETUP_MODULUS 100003
; The key handed out today: six characters, 7M2K4X. Two characters of data,
; three of expiry (the last valid day) and one of check.
!define SETUP_SHORT_DATA_LENGTH 2
!define SETUP_SHORT_KEY_LENGTH 6
; The five characters its check character covers. Written as a literal because
; SetupKeyFold counts in $R3: passing a register there would be overwritten.
!define SETUP_SHORT_FOLD_LENGTH 5
; The nine-character key of versions 2.3.6 - 2.3.8: five of data, three of
; expiry and one of check, shown as ABC-123-456. Still accepted.
!define SETUP_DATA_LENGTH 5
!define SETUP_EXPIRY_LENGTH 3
!define SETUP_KEY_LENGTH 9
!define SETUP_FOLD_LENGTH 8
; The key generator 2.3.2 printed: twelve of data and four of check, in groups of
; four (WXYZ-1234-5678-9ABC). Still accepted; it carries no expiry.
!define SETUP_LEGACY_DATA_LENGTH 12
!define SETUP_LEGACY_KEY_LENGTH 16
; A licence shorter than a day (the generator's 10 Minutes plan) ends at a time,
; so its key adds the minute of that day: ABC-123-456-789, five data characters,
; three for the day, three for the minute and one check character.
!define SETUP_MINUTE_LENGTH 3
!define SETUP_MINUTE_KEY_LENGTH 12
!define SETUP_MINUTE_FOLD_LENGTH 11
; Where the licence is remembered, so the application can read it back.
!define SETUP_LICENSE_FILE "license.json"
!define SETUP_LICENSE_DIR "Pharmacy Management"
; The one message a refused key shows, word for word.
!define SETUP_REFUSED "Invalid Serial Key!$\r$\nApplication Not Installed."
; Shown when the customer pastes the long serial instead of the short key.
!define SETUP_REFUSED_SERIAL "Invalid Serial Key!$\r$\nApplication Not Installed.$\r$\n$\r$\nThat looks like the serial key. The setup needs the short install key, for example 7M2K4X, shown in the key generator."

; ---------------------------------------------------------------------------
; Folds the first ${LENGTH} characters of $R0 into $R2 and remembers in $R1
; whether every character was in the alphabet.
;     a = (a * 33 + alphabet[data[i]] + alphabet[SALT[i]] + i * 7) mod 100003
; ---------------------------------------------------------------------------
!macro SetupKeyFold LENGTH
  StrCpy $R1 "1"     ; every character so far is in the alphabet
  StrCpy $R2 "0"     ; a
  StrCpy $R3 "0"     ; i
  ${Do}
    ${If} $R3 >= ${LENGTH}
      ${ExitDo}
    ${EndIf}
    StrCpy $R4 $R0 1 $R3            ; the character
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
    IntOp $R2 $R2 * 33
    IntOp $R2 $R2 + $R5
    IntOp $R2 $R2 + $R8
    IntOp $R4 $R3 * 7
    IntOp $R2 $R2 + $R4
    IntOp $R2 $R2 % ${SETUP_MODULUS}
    IntOp $R3 $R3 + 1
  ${Loop}
!macroend

; ---------------------------------------------------------------------------
; Validates the text in ${KEY}. ${VALID} becomes "1" or "0", and ${DAYS} becomes
; the last valid day counted from 2025-01-01 (0 = never expires, which is also
; what the two older key shapes mean).
;
; ${KEY}, ${VALID} and ${DAYS} must be general registers ($0, $1, ...): the macro
; works only in $R0-$R9 internally and it changes them. It is a macro, not a
; function, so the uninstaller pass (which has no installer pages) compiles
; without an unused function and electron-builder's -WX stays clean.
; ---------------------------------------------------------------------------
!macro SetupKeyValidate KEY VALID DAYS
  StrCpy ${VALID} "0"
  StrCpy ${DAYS} "0"

  ; First drop the separators, so ABC-123-456, ABC 123 456 and ABC123456 are the
  ; same key. Written as a loop instead of StrRep because that macro lives in an
  ; optional include.
  StrCpy $R0 ""
  StrCpy $R9 ${KEY}
  StrLen $R3 $R9
  StrCpy $R4 "0"
  ${Do}
    ${If} $R4 >= $R3
      ${ExitDo}
    ${EndIf}
    StrCpy $R5 $R9 1 $R4
    ${If} $R5 != "-"
    ${AndIf} $R5 != " "
      StrCpy $R0 "$R0$R5"
    ${EndIf}
    IntOp $R4 $R4 + 1
  ${Loop}

  StrLen $R3 $R0
  ${If} $R3 == ${SETUP_KEY_LENGTH}
    ; ABC-123-456: eight characters covered by one check character. $R0 keeps
    ; the key, the fold sets $R1 (all characters known) and $R2 (the fold), and
    ; $R9 remembers where the check character is.
    StrCpy $R9 $R3
    !insertmacro SetupKeyFold ${SETUP_FOLD_LENGTH}
    ${If} $R1 == 1
      IntOp $R9 $R9 - 1                    ; position of the check character
      IntOp $R6 $R2 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R5 $R0 1 $R9                 ; the check character the customer typed
      ${If} $R7 == $R5
        StrCpy ${VALID} "1"
        ; The last valid day: ${SETUP_EXPIRY_LENGTH} base32 characters.
        StrCpy $R6 "0"                     ; days
        StrCpy $R5 "0"                     ; position inside the expiry part
        ${Do}
          ${If} $R5 >= ${SETUP_EXPIRY_LENGTH}
            ${ExitDo}
          ${EndIf}
          IntOp $R7 $R5 + ${SETUP_DATA_LENGTH}
          StrCpy $R4 $R0 1 $R7
          ; Its alphabet index -> $R8.
          StrCpy $R8 "0"
          ${Do}
            ${If} $R8 >= 32
              ${ExitDo}
            ${EndIf}
            StrCpy $R9 "${SETUP_ALPHABET}" 1 $R8
            ${If} $R9 == $R4
              ${ExitDo}
            ${EndIf}
            IntOp $R8 $R8 + 1
          ${Loop}
          IntOp $R6 $R6 * 32
          IntOp $R6 $R6 + $R8
          IntOp $R5 $R5 + 1
        ${Loop}
        StrCpy ${DAYS} $R6
      ${EndIf}
    ${EndIf}
  ${ElseIf} $R3 == ${SETUP_MINUTE_KEY_LENGTH}
    ; ABC-123-456-789: the same as the nine-character key plus the minute of the
    ; day it ends. The setup only has to accept it; the application reads the
    ; day and the minute back out of the key itself.
    !insertmacro SetupKeyFold ${SETUP_MINUTE_FOLD_LENGTH}
    ${If} $R1 == 1
      IntOp $R6 $R2 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R5 $R0 1 ${SETUP_MINUTE_FOLD_LENGTH}  ; the check character typed
      ${If} $R7 == $R5
        StrCpy ${VALID} "1"
        ; The last valid day still goes into the licence file for readability.
        StrCpy $R6 "0"
        StrCpy $R5 "0"
        ${Do}
          ${If} $R5 >= ${SETUP_EXPIRY_LENGTH}
            ${ExitDo}
          ${EndIf}
          IntOp $R7 $R5 + ${SETUP_DATA_LENGTH}
          StrCpy $R4 $R0 1 $R7
          StrCpy $R8 "0"
          ${Do}
            ${If} $R8 >= 32
              ${ExitDo}
            ${EndIf}
            StrCpy $R9 "${SETUP_ALPHABET}" 1 $R8
            ${If} $R9 == $R4
              ${ExitDo}
            ${EndIf}
            IntOp $R8 $R8 + 1
          ${Loop}
          IntOp $R6 $R6 * 32
          IntOp $R6 $R6 + $R8
          IntOp $R5 $R5 + 1
        ${Loop}
        StrCpy ${DAYS} $R6
      ${EndIf}
    ${EndIf}
  ${ElseIf} $R3 == ${SETUP_LEGACY_KEY_LENGTH}
    ; WXYZ-1234-5678-9ABC, the key generator 2.3.2 printed: twelve data
    ; characters and four check characters. These keys carry no expiry.
    !insertmacro SetupKeyFold ${SETUP_LEGACY_DATA_LENGTH}
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
      StrCpy $R5 $R0 4 ${SETUP_LEGACY_DATA_LENGTH}  ; the check characters typed
      ${If} $R8 == $R5
        StrCpy ${VALID} "1"
      ${EndIf}
    ${EndIf}
  ${ElseIf} $R3 == ${SETUP_SHORT_KEY_LENGTH}
    ; 7M2K4X, the six-character key handed out today: two data characters, the
    ; three of the last valid day and one check character.
    !insertmacro SetupKeyFold ${SETUP_SHORT_FOLD_LENGTH}
    ${If} $R1 == 1
      IntOp $R6 $R2 % 32
      StrCpy $R7 "${SETUP_ALPHABET}" 1 $R6
      StrCpy $R5 $R0 1 ${SETUP_SHORT_FOLD_LENGTH}  ; the check character typed
      ${If} $R7 == $R5
        StrCpy ${VALID} "1"
        ; The last valid day sits right after the two data characters.
        StrCpy $R6 "0"
        StrCpy $R5 "0"
        ${Do}
          ${If} $R5 >= ${SETUP_EXPIRY_LENGTH}
            ${ExitDo}
          ${EndIf}
          IntOp $R7 $R5 + ${SETUP_SHORT_DATA_LENGTH}
          StrCpy $R4 $R0 1 $R7
          StrCpy $R8 "0"
          ${Do}
            ${If} $R8 >= 32
              ${ExitDo}
            ${EndIf}
            StrCpy $R9 "${SETUP_ALPHABET}" 1 $R8
            ${If} $R9 == $R4
              ${ExitDo}
            ${EndIf}
            IntOp $R8 $R8 + 1
          ${Loop}
          IntOp $R6 $R6 * 32
          IntOp $R6 $R6 + $R8
          IntOp $R5 $R5 + 1
        ${Loop}
        StrCpy ${DAYS} $R6
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; electron-builder compiles this script twice. The first pass has
; BUILD_UNINSTALLER defined and contains no pages, so the page, its variables and
; its callbacks must not be compiled there.
!ifndef BUILD_UNINSTALLER

Var ActivationDialog
Var ActivationField
Var ActivationNameField
Var ActivationError
Var ActivationHeading
; The name and key the customer typed, handed from the page to the install step.
Var LicenceKey
Var LicenceDays
Var LicenceName

; A name the licence writer cannot carry: a double quote or a backslash would
; break the JSON, and a dollar sign would be read as a variable name. Those
; three characters are dropped; every other byte (Pashto, Dari, English) stays.
!macro SetupNameClean SOURCE
  StrCpy $R0 ""
  StrCpy $R9 ${SOURCE}
  StrLen $R3 $R9
  StrCpy $R4 "0"
  ${Do}
    ${If} $R4 >= $R3
      ${ExitDo}
    ${EndIf}
    StrCpy $R5 $R9 1 $R4
    ${If} $R5 != '"'
    ${AndIf} $R5 != '\'
    ${AndIf} $R5 != '$$'
      StrCpy $R0 "$R0$R5"
    ${EndIf}
    IntOp $R4 $R4 + 1
  ${Loop}
!macroend

; This file is parsed before MUI2, so MUI macros must not be used here: the page
; draws its own title, like the screen the owner asked for.
Function ActivationPageShow
  ; The page has no precondition. It is drawn on every run - first install,
  ; reinstall, repair, upgrade, and an install after an uninstall - because
  ; nothing from an earlier installation is allowed to skip it.
  nsDialogs::Create 1018
  Pop $ActivationDialog
  ${If} $ActivationDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "Pharmacy Management Activation"
  Pop $ActivationHeading
  SetCtlColors $ActivationHeading 0x1F2A44 transparent

  ; First the customer's own pharmacy name: the application opens with it, so
  ; nobody types it twice.
  ${NSD_CreateLabel} 0 30u 100% 12u "Enter your Pharmacy Name"
  Pop $0

  ${NSD_CreateText} 0 43u 100% 14u ""
  Pop $ActivationNameField
  ${NSD_SetFocus} $ActivationNameField

  ${NSD_CreateLabel} 0 64u 100% 12u "Enter your serial key"
  Pop $0

  ${NSD_CreateText} 0 77u 100% 14u ""
  Pop $ActivationField

  ${NSD_CreateLabel} 0 96u 100% 12u "Example: 7M2K4X (six characters, letters and digits)"
  Pop $0
  SetCtlColors $0 0x5A6B80 transparent

  ${NSD_CreateLabel} 0 112u 100% 40u ""
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
  ; The pharmacy name: required, because the application shows it on every
  ; receipt and report. The three characters the licence file cannot carry are
  ; dropped before it is written.
  ${NSD_GetText} $ActivationNameField $1
  !insertmacro SetupNameClean $1
  StrCpy $LicenceName $R0
  StrLen $4 $LicenceName
  ${If} $4 < 2
    ${NSD_SetText} $ActivationError "Enter your pharmacy name.$$
Application Not Installed."
    Abort
  ${EndIf}

  ${NSD_GetText} $ActivationField $0

  ; $4 = "1" when the key is good, $2 = its last valid day. Both are filled in
  ; by the macro; an empty field simply leaves them at "0".
  StrCpy $4 "0"
  StrCpy $2 "0"
  StrCpy $3 $0
  ${If} $3 != ""
    !insertmacro SetupKeyValidate $0 $4 $2
  ${EndIf}

  ${If} $4 != "1"
    ; A pasted serial (TIT1..., about 170 characters) is the commonest mistake:
    ; say so instead of only "invalid", so the customer knows to use the short
    ; key the seller sent.
    StrCpy $5 $0
    StrCpy $6 $5 4
    StrLen $7 $5
    ${If} $6 == "TIT1"
    ${OrIf} $7 > 20
      ${NSD_SetText} $ActivationError "${SETUP_REFUSED_SERIAL}"
    ${Else}
      ${NSD_SetText} $ActivationError "${SETUP_REFUSED}"
    ${EndIf}
    Abort
  ${EndIf}

  ; Keep the accepted key and its last valid day: the install step writes them
  ; to disk so the application knows when the licence ends.
  StrCpy $LicenceKey $0
  StrCpy $LicenceDays $2
FunctionEnd

!macro customWelcomePage
  ; Welcome -> Software Activation -> Installation Location -> Install -> Finish.
  !insertmacro MUI_PAGE_WELCOME
  Page custom ActivationPageShow ActivationPageLeave
!macroend

!endif ; !ifndef BUILD_UNINSTALLER

; ------------------------------------------------------------- unattended guard
; A silent install (/S) never draws the page, so it must prove the key through
; the environment instead: PHARMACY_SETUP_KEY. There is no exemption for a
; machine that already has the application, so an unattended reinstall or
; upgrade needs the key exactly like a first install.
!macro customInit
  ${If} ${Silent}
    ReadEnvStr $0 "PHARMACY_SETUP_KEY"
    !insertmacro SetupKeyValidate $0 $1 $2
    ${If} $1 != "1"
      ; Nothing is installed and nothing is written: the setup stops here.
      SetErrorLevel 2
      Quit
    ${EndIf}
    StrCpy $LicenceKey $0
    StrCpy $LicenceDays $2
    ; The name is optional for an unattended run: an empty one simply means the
    ; first-run screen asks for it.
    ReadEnvStr $3 "PHARMACY_SETUP_NAME"
    !insertmacro SetupNameClean $3
    StrCpy $LicenceName $R0
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; Writes the licence the application reads at sign-in: next to the program and
; in the user's application-data folder (where the database lives). `days` is
; the last valid day counted from 2025-01-01, or 0 for a lifetime licence.
; Nothing here can be read back by a later setup, so every install still asks
; for the key.
; ---------------------------------------------------------------------------
!macro SetupWriteLicence
  ${If} $LicenceKey != ""
    FileOpen $9 "$INSTDIR\${SETUP_LICENSE_FILE}" w
    ${If} $9 != ""
      FileWrite $9 '{"version":1,"key":"$LicenceKey","days":$LicenceDays,"pharmacy":"$LicenceName"}'
      FileClose $9
    ${EndIf}
    ClearErrors
    CreateDirectory "$APPDATA\${SETUP_LICENSE_DIR}"
    FileOpen $9 "$APPDATA\${SETUP_LICENSE_DIR}\${SETUP_LICENSE_FILE}" w
    ${If} $9 != ""
      FileWrite $9 '{"version":1,"key":"$LicenceKey","days":$LicenceDays,"pharmacy":"$LicenceName"}'
      FileClose $9
    ${EndIf}
  ${EndIf}
!macroend

; -------------------------------------------------------------------- install
; The wizard already creates the Desktop shortcut and the Start-menu entry
; itself. Anything extra here once put two identical icons on the Desktop, and a
; saved activation flag here would let the next setup skip the key page.
!macro customInstall
  !insertmacro SetupWriteLicence
!macroend
