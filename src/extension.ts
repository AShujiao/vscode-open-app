import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AppManager } from './AppManager';
import { AppTreeProvider, AppTreeItem } from './AppTreeProvider';
import { WindowTreeProvider, WindowTreeItem } from './WindowTreeProvider';

let appManager: AppManager;
let treeProvider: AppTreeProvider;
let windowTreeProvider: WindowTreeProvider;
let outputChannel: vscode.OutputChannel | null = null;
let contextGlobal: vscode.ExtensionContext | null = null;
let activatorExePath: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  contextGlobal = context;
  if (process.platform !== 'win32') {
    vscode.window.showWarningMessage('Open App Extension only supports Windows.');
    return;
  }

  outputChannel = vscode.window.createOutputChannel('Open App');

  // 1. App List (Launcher)
  appManager = new AppManager(context);
  treeProvider = new AppTreeProvider(appManager);
  vscode.window.createTreeView('appList', {
    treeDataProvider: treeProvider
  });

  // 2. Window List (Switcher)
  windowTreeProvider = new WindowTreeProvider(context, prepareActivatorExe);
  vscode.window.createTreeView('windowList', {
    treeDataProvider: windowTreeProvider
  });

  registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('open-app.addApp', addApp));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.removeApp', removeApp));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.openApp', openApp));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.refreshList', () => treeProvider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.importApps', importApps));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.editApp', editApp));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.clearApps', clearApps));
  
  // New commands
  context.subscriptions.push(vscode.commands.registerCommand('open-app.switchWindow', switchWindow));
  context.subscriptions.push(vscode.commands.registerCommand('open-app.refreshWindowList', () => windowTreeProvider.refresh()));
}

async function addApp() {
  const fileUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    filters: { 'Executables': ['exe', 'bat', 'cmd'], 'All Files': ['*'] },
    title: 'Select Application'
  });

  if (!fileUri || fileUri.length === 0) return;

  const appPath = fileUri[0].fsPath;
  const defaultName = path.basename(appPath, path.extname(appPath));

  const name = await vscode.window.showInputBox({
    prompt: 'Enter App Name',
    value: defaultName,
    validateInput: (v) => v.trim() ? null : 'Name cannot be empty'
  });

  if (!name) return;

  appManager.addApp({
    id: appManager.generateId(),
    name: name.trim(),
    path: appPath
  });
  treeProvider.refresh();
}

async function removeApp(item: AppTreeItem) {
  if (!item) return;
  appManager.removeApp(item.app.id);
  treeProvider.refresh();
}

async function editApp(item: AppTreeItem) {
  if (!item) return;
  const name = await vscode.window.showInputBox({
    prompt: 'Rename App',
    value: item.app.name,
    validateInput: (v) => v.trim() ? null : 'Name cannot be empty'
  });
  if (!name) return;

  appManager.updateApp(item.app.id, { name: name.trim() });
  treeProvider.refresh();
}

async function clearApps() {
  const confirm = await vscode.window.showWarningMessage('Delete all apps?', 'Yes', 'No');
  if (confirm === 'Yes') {
    appManager.clearApps();
    treeProvider.refresh();
  }
}

// Simplified Open: Just launch, do not activate.
async function openApp(item: AppTreeItem) {
  if (!item) return;
  const appPath = item.app.path;
  
  if (!fs.existsSync(appPath)) {
    vscode.window.showErrorMessage('File not found: ' + appPath);
    return;
  }

  logInfo('Launching: ' + appPath);
  cp.exec(`explorer.exe "${appPath}"`);
}

async function switchWindow(item: WindowTreeItem) {
  if (!item) return;
  const exe = await prepareActivatorExe();
  if (exe) {
    cp.exec(`"${exe}" activate ${item.window.hwnd}`, (err, stdout, stderr) => {
      if (err) {
        logInfo('Activation failed: ' + stderr);
      }
    });
  }
}

// --- Import Logic (Preserved) ---
async function importApps() {
    const shortcuts = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Scanning...' },
      () => findShortcuts()
    );
  
    if (shortcuts.length === 0) {
      vscode.window.showInformationMessage('No apps found to import.');
      return;
    }
  
    const selectAllItem = {
      label: '$(check-all) Select All',
      description: `${shortcuts.length} apps found`,
      picked: false,
      shortcut: null as ShortcutInfo | null
    };
  
    const items = [
      selectAllItem,
      ...shortcuts.map(s => ({
        label: s.name,
        description: s.path,
        picked: false,
        shortcut: s as ShortcutInfo | null
      }))
    ];
  
    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select apps to import'
    });
  
    if (!selected || selected.length === 0) {
      return;
    }
  
    const isSelectAll = selected.some(item => item.shortcut === null);
    const picked = isSelectAll
      ? shortcuts
      : selected.filter(item => item.shortcut !== null).map(item => item.shortcut!);
  
    const existingPaths = new Set(
      appManager.getApps().map(app => normalizePath(app.path))
    );
  
    const uniqueSelected = new Map<string, ShortcutInfo>();
    for (const s of picked) {
      const normalized = normalizePath(s.path);
      if (!uniqueSelected.has(normalized)) {
        uniqueSelected.set(normalized, s);
      }
    }
  
    const toImport = Array.from(uniqueSelected.values()).filter(
      s => !existingPaths.has(normalizePath(s.path))
    );
  
    for (const shortcut of toImport) {
      appManager.addApp({
        id: appManager.generateId(),
        name: shortcut.name,
        path: shortcut.path
      });
    }
  
    treeProvider.refresh();
}

interface ShortcutInfo { name: string; path: string; }

async function findShortcuts(): Promise<ShortcutInfo[]> {
    const shortcuts: ShortcutInfo[] = [];
    const searchPaths = [
        path.join(os.homedir(), 'Desktop'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
    ];
  
    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        const found = await scanDirectory(searchPath);
        shortcuts.push(...found);
      }
    }
  
    const unique = new Map<string, ShortcutInfo>();
    for (const s of shortcuts) {
      if (!unique.has(s.path)) unique.set(s.path, s);
    }
  
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function scanDirectory(dirPath: string): Promise<ShortcutInfo[]> {
    const results: ShortcutInfo[] = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lnkFiles: string[] = [];
        for (const entry of entries) {
            if (entry.isDirectory()) continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.name.endsWith('.lnk')) lnkFiles.push(fullPath);
            else if (entry.name.endsWith('.exe')) {
                results.push({ name: path.basename(entry.name, '.exe'), path: fullPath });
            }
        }
        if (lnkFiles.length > 0) {
            results.push(...await resolveShortcutsBatch(lnkFiles));
        }
    } catch { }
    return results;
}

async function resolveShortcutsBatch(lnkPaths: string[]): Promise<ShortcutInfo[]> {
    if (lnkPaths.length === 0) return [];
    return new Promise((resolve) => {
        const pathsJson = JSON.stringify(lnkPaths);
        const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$paths = '${pathsJson.replace(/'/g, "''")}' | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
foreach ($p in $paths) {
  try {
    $shortcut = $shell.CreateShortcut($p)
    $target = $shortcut.TargetPath
    if ($target -and $target.EndsWith('.exe')) {
      $name = [System.IO.Path]::GetFileNameWithoutExtension($p)
      Write-Output "$name|$target"
    }
  } catch {}
}
`;
        const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
        cp.exec(`powershell -EncodedCommand ${encodedScript}`, { encoding: 'utf8' }, (error, stdout) => {
            if (error) { resolve([]); return; }
            const results: ShortcutInfo[] = [];
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const [name, target] = line.trim().split('|');
                if (name && target) results.push({ name, path: target });
            }
            resolve(results);
        });
    });
}

function normalizePath(inputPath: string): string {
    return path.normalize(inputPath).toLowerCase();
}

// --- Activator Compilation ---
async function prepareActivatorExe(): Promise<string | null> {
    if (activatorExePath && fs.existsSync(activatorExePath)) return activatorExePath;

    const resourceBin = path.join(contextGlobal!.extensionPath, 'resources', 'bin');
    const exePath = path.join(resourceBin, 'WindowActivator.exe');
    
    if (fs.existsSync(exePath)) {
        activatorExePath = exePath;
        return exePath;
    }

    logInfo(`WindowActivator.exe not found at: ${exePath}`);
    vscode.window.showErrorMessage('WindowActivator.exe not found. Please reinstall the extension.');
    return null;
}

function logInfo(message: string): void {
    outputChannel?.appendLine(message);
}

export function deactivate() {}

