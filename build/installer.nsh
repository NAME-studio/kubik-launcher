!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Установка Kubik Launcher"
  !define MUI_WELCOMEPAGE_TEXT "Лаунчер установится для текущего пользователя — права администратора не нужны.$\r$\n$\r$\nПапка с данными (%APPDATA%\.KubikLauncher) не изменяется: сборки, модпаки, миры и скины останутся на месте. После запуска лаунчер проверит файлы и докачает только недостающие библиотеки.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  !ifndef MUI_ICON
    !define MUI_ICON "${BUILD_RESOURCES_DIR}\icon.ico"
  !endif
!macroend

!macro customInstall
  DetailPrint "Kubik Launcher: данные пользователя не затрагиваются"
!macroend
