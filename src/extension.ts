import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
// import koffi from 'koffi'; // Remove koffi
import { AppManager } from './AppManager';
import { AppTreeProvider, AppTreeItem } from './AppTreeProvider';

const windowManagerLoad = (() => {
  try {
    const mod = require('node-window-manager');
    return { manager: mod.windowManager as { getWindows?: () => any[] }, error: null as Error | null };
  } catch (error) {
    return { manager: null as { getWindows?: () => any[] } | null, error: error as Error };
  }
})();

const optionalWindowManager = windowManagerLoad.manager;

let appManager: AppManager;
let treeProvider: AppTreeProvider;
let outputChannel: vscode.OutputChannel | null = null;
let autoHotkeyPathCache: string | null | undefined;
let autoHotkeyV2Cache: boolean | undefined;

export function activate(context: vscode.ExtensionContext) {
  contextGlobal = context;
  // 检查平台
  if (process.platform !== 'win32') {
    vscode.window.showWarningMessage('Open App 扩展目前仅支持 Windows 系统');
    return;
  }

  appManager = new AppManager(context);
  treeProvider = new AppTreeProvider(appManager);

  const treeView = vscode.window.createTreeView('appList', {
    treeDataProvider: treeProvider
  });

  outputChannel = vscode.window.createOutputChannel('Open App');
  logWindowManagerStatus();

  context.subscriptions.push(treeView);
  registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext) {
  // 添加应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.addApp', addApp)
  );

  // 删除应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.removeApp', removeApp)
  );

  // 打开应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.openApp', openApp)
  );

  // 刷新列表
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.refreshList', () => {
      treeProvider.refresh();
    })
  );

  // 自动导入应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.importApps', importApps)
  );

  // 编辑应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.editApp', editApp)
  );

  // 清空应用
  context.subscriptions.push(
    vscode.commands.registerCommand('open-app.clearApps', clearApps)
  );
}

async function addApp() {
  const fileUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      '可执行文件': ['exe', 'bat', 'cmd'],
      '所有文件': ['*']
    },
    title: '选择应用程序'
  });

  if (!fileUri || fileUri.length === 0) {
    return;
  }

  const appPath = fileUri[0].fsPath;
  const defaultName = path.basename(appPath, path.extname(appPath));

  const name = await vscode.window.showInputBox({
    prompt: '输入应用名称',
    value: defaultName,
    validateInput: (value) => {
      return value.trim() ? null : '名称不能为空';
    }
  });

  if (!name) {
    return;
  }

  appManager.addApp({
    id: appManager.generateId(),
    name: name.trim(),
    path: appPath
  });

  treeProvider.refresh();
  vscode.window.showInformationMessage(`已添加应用: ${name}`);
}

async function removeApp(item: AppTreeItem) {
  if (!item) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `确定要删除应用 "${item.app.name}" 吗？`,
    '确定',
    '取消'
  );

  if (confirm === '确定') {
    appManager.removeApp(item.app.id);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`已删除应用: ${item.app.name}`);
  }
}

async function openApp(item: AppTreeItem) {
  if (!item) {
    return;
  }

  const appPath = item.app.path;
  const appName = item.app.name;
  const workDir = path.dirname(appPath);

  // 检查文件是否存在
  if (!fs.existsSync(appPath)) {
    vscode.window.showErrorMessage(`文件不存在: ${appPath}`);
    return;
  }

  logInfo(`正在打开应用: ${appName}, 路径: ${appPath}`);

  // 1. 先尝试激活已运行的窗口（通过 WScript.Shell）
  const activated = await tryActivateWithWScript(appPath);
  if (activated) {
    logInfo(`已激活运行中的应用: ${appName}`);
    return;
  }

  // 2. 未运行则启动新进程
  launchWithExplorer(appPath, appName);
}

// Koffi removed
let activatorExePath: string | null = null;
let contextGlobal: vscode.ExtensionContext | null = null;

async function prepareActivatorExe(): Promise<string | null> {
  if (activatorExePath && fs.existsSync(activatorExePath)) {
    return activatorExePath;
  }

  const resourceBin = path.join(contextGlobal!.extensionPath, 'resources', 'bin');
  const exePath = path.join(resourceBin, 'WindowActivator.exe');
  
  if (fs.existsSync(exePath)) {
    activatorExePath = exePath;
    return exePath;
  }

  // 尝试编译
  const srcPath = path.join(contextGlobal!.extensionPath, 'src', 'native', 'WindowActivator.cs');
  if (!fs.existsSync(srcPath)) {
    logInfo('WindowActivator.cs not found at ' + srcPath);
    return null;
  }

  if (!fs.existsSync(resourceBin)) {
    fs.mkdirSync(resourceBin, { recursive: true });
  }

  // 1. 尝试使用 dotnet build
  // 这里简化为使用 csc (C# Compiler) 因为它通常预装在 Windows 上
  // 查找 csc.exe
  const cscPath = await findCsc();
  if (!cscPath) {
    logInfo('csc.exe not found. Please ensure .NET Framework is installed.');
    return null;
  }

  logInfo(`Compiling WindowActivator with ${cscPath}...`);
  return new Promise((resolve) => {
    cp.exec(`"${cscPath}" /target:exe /out:"${exePath}" "${srcPath}"`, (err, stdout, stderr) => {
      if (err) {
        logInfo(`Compilation failed: ${stderr || stdout}`);
        resolve(null);
      } else {
        logInfo('Compilation successful.');
        activatorExePath = exePath;
        resolve(exePath);
      }
    });
  });
}

async function findCsc(): Promise<string | null> {
  // 常见路径
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 尝试 where csc
  return new Promise(resolve => {
    cp.exec('where csc', (err, stdout) => {
      if (err || !stdout) resolve(null);
      else resolve(stdout.split('\n')[0].trim());
    });
  });
}

/**
 * 通过 外部C#程序 激活窗口
 */
async function tryActivateWithWScript(appPath: string): Promise<boolean> {
  const pids = await getRunningPids(appPath);
  if (pids.length === 0) {
    return false;
  }

  const exe = await prepareActivatorExe();
  if (!exe) {
    logInfo('Cannot use external activator: exe not ready.');
    return false;
  }

  const processName = path.basename(appPath, path.extname(appPath));
  logInfo(`尝试激活进程名: ${processName}`);

  const success = await new Promise<boolean>(resolve => {
    cp.exec(`"${exe}" "${processName}"`, (err, stdout, stderr) => {
      if (err) {
        logInfo(`Activator error: ${stderr}`);
        resolve(false);
      } else {
        const output = stdout.trim();
        logInfo(`Activator output: ${output}`);
        resolve(output.includes("Done"));
      }
    });
  });

  return success;
}

/**
 * 获取运行中的进程 PID（通过路径或进程名匹配）
 */
async function getRunningPids(appPath: string): Promise<number[]> {
  const exeName = path.basename(appPath);
  
  return new Promise((resolve) => {
    // 使用 wmic 按名称查找（路径匹配在 wmic 中不太可靠）
    const cmd = `wmic process where "name='${exeName}'" get ProcessId /format:csv`;
    
    cp.exec(cmd, { encoding: 'utf8', timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      
      const pids: number[] = [];
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const pid = parseInt(parts[parts.length - 1].trim(), 10);
          if (!isNaN(pid) && pid > 0) {
            pids.push(pid);
          }
        }
      }
      resolve(pids);
    });
  });
}

/**
 * 使用 explorer 启动应用（最可靠的方式）
 */
function launchWithExplorer(appPath: string, appName: string): void {
  // explorer.exe 的退出码不可靠，即使成功启动也可能返回错误
  // 所以不检查 error，直接认为成功
  cp.exec(`explorer.exe "${appPath}"`, { timeout: 10000 }, () => {
    logInfo(`已启动应用: ${appName}`);
  });
}

async function editApp(item: AppTreeItem) {
  if (!item) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: '修改应用名称',
    value: item.app.name,
    validateInput: (value) => {
      return value.trim() ? null : '名称不能为空';
    }
  });

  if (!name) {
    return;
  }

  appManager.updateApp(item.app.id, { name: name.trim() });
  treeProvider.refresh();
  vscode.window.showInformationMessage(`已更新应用: ${name}`);
}

async function clearApps() {
  const confirm = await vscode.window.showWarningMessage(
    '确定要删除所有应用吗？此操作不可撤销。',
    '确定',
    '取消'
  );

  if (confirm !== '确定') {
    return;
  }

  appManager.clearApps();
  treeProvider.refresh();
  vscode.window.showInformationMessage('已删除所有应用');
}

async function importApps() {
  const shortcuts = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在扫描应用...' },
    () => findShortcuts()
  );

  if (shortcuts.length === 0) {
    vscode.window.showInformationMessage('未找到可导入的应用');
    return;
  }

  // 添加全选选项
  const selectAllItem = {
    label: '$(check-all) 全部选择',
    description: `共 ${shortcuts.length} 个应用`,
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
    placeHolder: '选择要导入的应用 (第一项为全选)'
  });

  if (!selected || selected.length === 0) {
    return;
  }

  // 判断是否选择了全选
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

  const skipped = uniqueSelected.size - toImport.length;
  if (toImport.length === 0) {
    vscode.window.showInformationMessage('已存在相同应用，未新增');
    return;
  }

  const skipNote = skipped > 0 ? `，已跳过 ${skipped} 个重复应用` : '';
  vscode.window.showInformationMessage(`已导入 ${toImport.length} 个应用${skipNote}`);
}

interface ShortcutInfo {
  name: string;
  path: string;
}

async function findShortcuts(): Promise<ShortcutInfo[]> {
  const shortcuts: ShortcutInfo[] = [];
  const searchPaths = getShortcutSearchPaths();

  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      const found = await scanDirectory(searchPath);
      shortcuts.push(...found);
    }
  }

  // 去重
  const unique = new Map<string, ShortcutInfo>();
  for (const s of shortcuts) {
    if (!unique.has(s.path)) {
      unique.set(s.path, s);
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getShortcutSearchPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
  ];
}

function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).toLowerCase();
}

async function scanDirectory(dirPath: string): Promise<ShortcutInfo[]> {
  const results: ShortcutInfo[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const lnkFiles: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.name.endsWith('.lnk')) {
        lnkFiles.push(fullPath);
      } else if (entry.name.endsWith('.exe')) {
        results.push({
          name: path.basename(entry.name, '.exe'),
          path: fullPath
        });
      }
    }

    // 并行解析所有快捷方式
    if (lnkFiles.length > 0) {
      const resolved = await resolveShortcutsBatch(lnkFiles);
      results.push(...resolved);
    }
  } catch (error) {
    // 忽略权限错误
  }

  return results;
}

async function resolveShortcutsBatch(lnkPaths: string[]): Promise<ShortcutInfo[]> {
  if (lnkPaths.length === 0) {
    return [];
  }

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

    cp.exec(
      `powershell -EncodedCommand ${encodedScript}`,
      { encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const results: ShortcutInfo[] = [];
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const [name, target] = line.trim().split('|');
          if (name && target) {
            results.push({ name, path: target });
          }
        }
        resolve(results);
      }
    );
  });
}

async function activateRunningApp(appPath: string, appName: string): Promise<boolean> {
  const pids = await getProcessIdsByPath(appPath);
  if (pids.length === 0) {
    return false;
  }

  const activatedByCscript = await activateRunningAppByCscript(pids);
  if (activatedByCscript) {
    return true;
  }

  const activatedByAutoHotkey = await activateRunningAppByAutoHotkey(pids, appPath);
  if (activatedByAutoHotkey) {
    return true;
  }

  const activatedByTasklist = await activateRunningAppByTasklist(pids, appName, appPath);
  if (activatedByTasklist) {
    return true;
  }

  const activatedByWindowManager = tryActivateWithWindowManager(pids, appName, appPath);
  if (activatedByWindowManager) {
    return true;
  }

  return false;
}

function getWindowProcessId(win: any): number | undefined {
  if (typeof win?.processId === 'number') {
    return win.processId;
  }
  if (typeof win?.getProcessId === 'function') {
    return win.getProcessId();
  }
  return undefined;
}

function tryActivateWindow(win: any): boolean {
  try {
    if (typeof win?.isMinimized === 'function' && win.isMinimized()) {
      win.restore?.();
    }
    win.bringToTop?.();
    win.setForeground?.();
    win.focus?.();
    return true;
  } catch {
    return false;
  }
}

function tryActivateWithWindowManager(pids: number[], appName: string, appPath: string): boolean {
  const windows = optionalWindowManager?.getWindows?.();
  if (!optionalWindowManager) {
    logInfo('node-window-manager 未加载，无法获取窗口列表。');
  } else if (typeof optionalWindowManager.getWindows !== 'function') {
    logInfo('node-window-manager 已加载，但 getWindows 不是函数。');
  } else if (!windows) {
    logInfo('node-window-manager getWindows 返回 undefined。');
  }
  if (!windows || windows.length === 0) {
    return false;
  }

  const tokens = buildMatchTokens(appName, appPath);
  let bestWin: any | null = null;
  let bestScore = 0;

  for (const w of windows) {
    if (!isWindowCandidate(w)) {
      continue;
    }
    const score = scoreWindowMatch(w, pids, tokens);
    if (score > bestScore) {
      bestScore = score;
      bestWin = w;
    }
  }

  if (bestWin && bestScore >= 30) {
    return tryActivateWindow(bestWin);
  }

  return false;
}

function logWindowManagerStatus(): void {
  if (!outputChannel) {
    return;
  }

  if (windowManagerLoad.error) {
    outputChannel.appendLine(`node-window-manager 加载失败: ${windowManagerLoad.error.message}`);
    return;
  }

  if (!optionalWindowManager) {
    outputChannel.appendLine('node-window-manager 加载成功但 windowManager 为空。');
    return;
  }

  const hasGetWindows = typeof optionalWindowManager.getWindows === 'function';
  outputChannel.appendLine(`node-window-manager 已加载，getWindows=${hasGetWindows ? 'OK' : '缺失'}`);
}

function logInfo(message: string): void {
  outputChannel?.appendLine(message);
}

function isWindowCandidate(win: any): boolean {
  try {
    if (typeof win?.isVisible === 'function' && !win.isVisible()) {
      return false;
    }
    const title = getWindowTitle(win).trim();
    if (!title) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function buildMatchTokens(appName: string, appPath: string): string[] {
  const tokens = new Set<string>();
  const exeName = path.basename(appPath, path.extname(appPath));

  [appName, exeName, path.basename(appPath)].forEach((value) => {
    if (!value) {
      return;
    }
    const normalized = normalizeText(value);
    if (normalized) {
      tokens.add(normalized);
    }
    for (const part of normalized.split(/[^a-z0-9]+/)) {
      if (part.length >= 3) {
        tokens.add(part);
      }
    }
  });

  return Array.from(tokens.values());
}

function scoreWindowMatch(win: any, pids: number[], tokens: string[]): number {
  let score = 0;
  const pid = getWindowProcessId(win);
  if (pid !== undefined && pids.includes(pid)) {
    score += 100;
  }

  const title = normalizeText(getWindowTitle(win));
  const className = normalizeText(getWindowClassName(win));

  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (title === token) {
      score += 40;
    } else if (title.includes(token)) {
      score += 15;
    }
    if (className === token) {
      score += 15;
    } else if (className.includes(token)) {
      score += 5;
    }
  }

  return score;
}

function normalizeText(value: string): string {
  return (value || '').trim().toLowerCase();
}

function getWindowTitle(win: any): string {
  if (typeof win?.getTitle === 'function') {
    return win.getTitle() || '';
  }
  if (typeof win?.title === 'string') {
    return win.title;
  }
  return '';
}

function getWindowClassName(win: any): string {
  if (typeof win?.getClassName === 'function') {
    return win.getClassName() || '';
  }
  if (typeof win?.className === 'string') {
    return win.className;
  }
  return '';
}

async function getProcessIdsByPath(appPath: string): Promise<number[]> {
  const ids = await queryProcessIdsByPath(appPath);

  if (ids.length > 0) {
    return ids;
  }

  const exeName = path.basename(appPath, path.extname(appPath));
  return getProcessIdsByName(exeName);
}

async function getProcessIdsByName(exeName: string): Promise<number[]> {
  return queryProcessIdsByName(exeName);
}

async function queryProcessIdsByPath(appPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const wmiPath = appPath.replace(/\\/g, '\\\\').replace(/"/g, '""');
    const command = `wmic process where "ExecutablePath='${wmiPath}'" get ProcessId /value`;

    cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const ids = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const match = line.match(/^ProcessId=(\d+)$/);
          return match ? parseInt(match[1], 10) : NaN;
        })
        .filter(id => !Number.isNaN(id));

      resolve(ids);
    });
  });
}

async function queryProcessIdsByName(exeName: string): Promise<number[]> {
  return new Promise((resolve) => {
    const safeName = exeName.replace(/"/g, '""');
    const command = `wmic process where "Name='${safeName}.exe'" get ProcessId /value`;

    cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const ids = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const match = line.match(/^ProcessId=(\d+)$/);
          return match ? parseInt(match[1], 10) : NaN;
        })
        .filter(id => !Number.isNaN(id));

      resolve(ids);
    });
  });
}

async function activateRunningAppByCscript(pids: number[]): Promise<boolean> {
  if (pids.length === 0) {
    return false;
  }

  const scriptPath = path.join(os.tmpdir(), 'open-app-activate.js');
  const scriptContent = `
var sh = new ActiveXObject('WScript.Shell');
var pid = parseInt(WScript.Arguments(0), 10);
var ok = sh.AppActivate(pid);
if (ok) {
  sh.SendKeys('%');
  WScript.Echo('OK');
}
`;

  try {
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');
  } catch {
    return false;
  }

  for (const pid of pids) {
    const success = await new Promise<boolean>((resolve) => {
      const command = `cscript //nologo "${scriptPath}" ${pid}`;
      cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.trim() === 'OK');
      });
    });

    if (success) {
      try {
        fs.unlinkSync(scriptPath);
      } catch {}
      return true;
    }
  }

  try {
    fs.unlinkSync(scriptPath);
  } catch {}
  return false;
}

async function activateRunningAppByTasklist(
  pids: number[],
  appName: string,
  appPath: string
): Promise<boolean> {
  const candidates = await queryTasklistWindows();
  if (candidates.length === 0) {
    return false;
  }

  const tokens = buildMatchTokens(appName, appPath);
  let best: { pid: number; title: string } | null = null;
  let bestScore = 0;

  for (const item of candidates) {
    if (pids.length > 0 && !pids.includes(item.pid)) {
      continue;
    }
    const score = scoreTitleTokens(item.title, tokens);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 10) {
    return false;
  }

  return activateByWindowTitle(best.title);
}

function scoreTitleTokens(title: string, tokens: string[]): number {
  const normalized = normalizeText(title);
  let score = 0;
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (normalized === token) {
      score += 30;
    } else if (normalized.includes(token)) {
      score += 10;
    }
  }
  return score;
}

async function queryTasklistWindows(): Promise<Array<{ pid: number; title: string }>> {
  return new Promise((resolve) => {
    const command = 'cmd /c "chcp 65001 > nul & tasklist /v /fo csv"';
    cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const lines = stdout.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length <= 1) {
        resolve([]);
        return;
      }

      const results: Array<{ pid: number; title: string }> = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length < 9) {
          continue;
        }
        const pid = parseInt(cols[1], 10);
        const title = cols[8] || '';
        if (!Number.isNaN(pid) && title && title !== 'N/A') {
          results.push({ pid, title });
        }
      }

      resolve(results);
    });
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

async function activateByWindowTitle(title: string): Promise<boolean> {
  const scriptPath = path.join(os.tmpdir(), 'open-app-activate-title.js');
  const scriptContent = `
var sh = new ActiveXObject('WScript.Shell');
var title = WScript.Arguments(0);
var ok = sh.AppActivate(title);
if (ok) {
  sh.SendKeys('%');
  WScript.Echo('OK');
}
`;

  try {
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');
  } catch {
    return false;
  }

  const success = await new Promise<boolean>((resolve) => {
    const command = `cscript //nologo "${scriptPath}" "${title.replace(/"/g, '""')}"`;
    cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(stdout.trim() === 'OK');
    });
  });

  try {
    fs.unlinkSync(scriptPath);
  } catch {}

  return success;
}

async function activateRunningAppByAutoHotkey(pids: number[], appPath: string): Promise<boolean> {
  if (pids.length === 0) {
    return false;
  }

  const autoHotkeyPath = await findAutoHotkeyPath();
  if (!autoHotkeyPath) {
    logInfo('未检测到 AutoHotkey，跳过 AHK 激活。');
    return false;
  }

  const isV2 = await isAutoHotkeyV2(autoHotkeyPath);
  const exeName = path.basename(appPath);
  const scriptPath = path.join(os.tmpdir(), 'open-app-activate.ahk');
  const scriptContent = isV2
    ? `#SingleInstance Off
pid := A_Args.Length >= 1 ? A_Args[1] : ""
exe := A_Args.Length >= 2 ? A_Args[2] : ""
if (pid != "") {
  WinActivate "ahk_pid " pid
  WinWaitActive "ahk_pid " pid, , 0.6
}
if (!WinActive("ahk_pid " pid) && exe != "") {
  WinActivate "ahk_exe " exe
  WinWaitActive "ahk_exe " exe, , 0.6
}
if (WinActive("ahk_pid " pid) || (exe != "" && WinActive("ahk_exe " exe))) {
  FileAppend("OK", "*")
}
`
    : `#NoTrayIcon
pid = %1%
exe = %2%
if (pid != "") {
  WinActivate, ahk_pid %pid%
  WinWaitActive, ahk_pid %pid%, , 0.6
}
if (!WinActive("ahk_pid " pid) && exe != "") {
  WinActivate, ahk_exe %exe%
  WinWaitActive, ahk_exe %exe%, , 0.6
}
if (WinActive("ahk_pid " pid) || (exe != "" && WinActive("ahk_exe " exe)))
  FileAppend, OK, *
`;

  try {
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');
  } catch {
    return false;
  }

  for (const pid of pids) {
    const success = await new Promise<boolean>((resolve) => {
      const command = `"${autoHotkeyPath}" /ErrorStdOut "${scriptPath}" ${pid} "${exeName.replace(/"/g, '""')}"`;
      cp.exec(command, { encoding: 'utf8' }, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.trim() === 'OK');
      });
    });

    if (success) {
      try {
        fs.unlinkSync(scriptPath);
      } catch {}
      return true;
    }
  }

  try {
    fs.unlinkSync(scriptPath);
  } catch {}
  return false;
}

async function findAutoHotkeyPath(): Promise<string | null> {
  if (autoHotkeyPathCache !== undefined) {
    return autoHotkeyPathCache ?? null;
  }

  const candidates = [
    'C:\\Program Files\\AutoHotkey\\AutoHotkey.exe',
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe',
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey32.exe',
    'C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      autoHotkeyPathCache = candidate;
      return candidate;
    }
  }

  const fromPath = await new Promise<string | null>((resolve) => {
    cp.exec('cmd /c "where AutoHotkey.exe"', { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const line = stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean) || null;
      resolve(line);
    });
  });

  autoHotkeyPathCache = fromPath ?? null;
  return autoHotkeyPathCache;
}

async function isAutoHotkeyV2(exePath: string): Promise<boolean> {
  if (autoHotkeyV2Cache !== undefined) {
    return autoHotkeyV2Cache;
  }

  const isV2 = await new Promise<boolean>((resolve) => {
    cp.exec(`"${exePath}" /?`, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(/AutoHotkey v2/i.test(stdout));
    });
  });

  autoHotkeyV2Cache = isV2;
  return isV2;
}

export function deactivate() {}
