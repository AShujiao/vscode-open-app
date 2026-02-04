import * as vscode from 'vscode';
import { AppItem } from './types';
import { AppManager } from './AppManager';

export class AppTreeItem extends vscode.TreeItem {
  constructor(
    public readonly app: AppItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(app.name, collapsibleState);
    this.tooltip = app.path;
    this.description = app.path;
    this.contextValue = 'appItem';
    this.command = {
      command: 'open-app.openApp',
      title: '打开应用',
      arguments: [this]
    };
  }
}

export class AppTreeProvider implements vscode.TreeDataProvider<AppTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AppTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private appManager: AppManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AppTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<AppTreeItem[]> {
    const apps = this.appManager.getApps();
    return Promise.resolve(
      apps.map(app => new AppTreeItem(app, vscode.TreeItemCollapsibleState.None))
    );
  }
}
