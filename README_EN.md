# Open App (Windows)

[中文](./README.md)

Quickly manage and switch Windows desktop applications in the VS Code sidebar.

Designed for Windows developers, this extension aims to reduce the distraction of frequently switching windows during development. It provides an integrated sidebar divided into two functional areas: **App Launcher** and **Window Switcher**.

## ✨ Key Features

### 1. App Launcher
Pin commonly used development tools, external software, or scripts to the VS Code sidebar for one-click launching.

*   **Manual Add**: Supports adding executables like `.exe`, `.bat`, `.cmd`.
*   **Smart Import**: One-click scan of desktop shortcuts and Start Menu to batch import common software.
*   **Easy Management**: Supports renaming, deleting, clearing lists, with automatic configuration persistence.

### 2. Window Switcher
View and switch currently running Windows windows directly inside VS Code, eliminating the need for `Alt+Tab`.

*   **Real-time List**: Retrieves all active application windows on the current desktop.
*   **One-click Switch**: Click a list item to immediately bring the target window to the front and activate it.
*   **Smart Filtering**: Automatically filters background processes and tool windows, showing only meaningful main windows.
*   **Multilingual Support**: Perfectly displays localized window titles.

### 3. Preview
![preview](./resources/readme/01.png)
![preview](./resources/readme/02.png)


## 📋 System Requirements

*   **OS**: Windows 10 / 11 (Windows platform only)
*   **Prerequisites**: .NET Framework 4.5+ (Usually built-in on Windows systems, no extra installation required)

## 🚀 Usage Guide

### Launch & Switch
After installing the extension, click the **Open App** icon in the Activity Bar.

#### 📌 App List (Launcher)
*   **Add**: Click the `+` sign in the title bar and select an executable file.
*   **Import**: Click the cloud download icon to scan system shortcuts.
*   **Launch**: One-click on a list item to start the program.

#### 💻 Running Windows
*   **View**: Expand the "Running Windows" view to see all currently open programs.
*   **Refresh**: Click the refresh button to update the window list.
*   **Switch**: Click any entry to jump to that window immediately.

## ⚙️ FAQ

**Q: Why is the "Running Windows" list empty or showing very few windows?**
A: The extension automatically filters out invisible windows, system tool windows, and windows without titles. If some windows are not shown, try clicking the refresh button.

**Q: Extension says "WindowActivator.exe not found"?**
A: The extension relies on a lightweight Native component to fetch window information with high performance. Usually, the extension will automatically compile this component on the first run. Please ensure your system has not disabled PowerShell or .NET compilation tools.

## ⌨️ Command List

You can also use the following functions via `Ctrl+Shift+P` (Command Palette):

*   `Open App: Append App`
*   `Open App: Import Apps`
*   `Open App: Refresh App List`
*   `Open App: Refresh Window List`
*   `Open App: Switch Window`

## 📄 License

MIT License. See [LICENSE](LICENSE) file for details.
