import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export interface WindowItem {
    hwnd: string;
    pid: string;
    title: string;
    processName: string;
    processPath: string;
}

export class WindowTreeProvider implements vscode.TreeDataProvider<WindowTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WindowTreeItem | undefined | null | void> = new vscode.EventEmitter<WindowTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WindowTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private activatorPath: string | null = null;

    constructor(private context: vscode.ExtensionContext, private getActivatorPath: () => Promise<string | null>) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WindowTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: WindowTreeItem): Thenable<WindowTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        return this.getWindows();
    }

    private async getWindows(): Promise<WindowTreeItem[]> {
        const exe = await this.getActivatorPath();
        if (!exe) {
            return [new WindowTreeItem({ title: '无法获取 WindowActivator.exe', hwnd: '', pid: '', processName: '', processPath: '' }, vscode.TreeItemCollapsibleState.None)];
        }

        return new Promise((resolve) => {
            cp.exec(`"${exe}" list`, { encoding: 'utf8' }, (err, stdout) => {
                if (err) {
                    resolve([]);
                    return;
                }

                const items: WindowTreeItem[] = [];
                const lines = stdout.trim().split('\n');
                
                for (const line of lines) {
                    // HWND|PID|Title|ProcessName|ProcessPath
                    const parts = line.split('|');
                    if (parts.length >= 4) {
                        const win: WindowItem = {
                            hwnd: parts[0],
                            pid: parts[1],
                            title: parts[2],
                            processName: parts[3],
                            processPath: parts.length > 4 ? parts[4] : ''
                        };
                        items.push(new WindowTreeItem(win, vscode.TreeItemCollapsibleState.None));
                    }
                }
                
                resolve(items);
            });
        });
    }
}

export class WindowTreeItem extends vscode.TreeItem {
    constructor(
        public readonly window: WindowItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(window.title, collapsibleState);
        this.tooltip = `Process: ${window.processName}\nPID: ${window.pid}\nPath: ${window.processPath}`;
        this.description = window.processName; // show process name on the right
        this.contextValue = 'window';
        this.command = {
            command: 'open-app.switchWindow',
            title: 'Switch To Window',
            arguments: [this]
        };
        
        // Use an icon if available, or a generic window icon
        this.iconPath = new vscode.ThemeIcon('window');
    }
}
