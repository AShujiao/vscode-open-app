import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AppItem, AppConfig } from './types';

export class AppManager {
  private configPath: string;
  private config: AppConfig;

  constructor(context: vscode.ExtensionContext) {
    this.configPath = path.join(context.globalStorageUri.fsPath, 'apps.json');
    this.config = { apps: [] };
    this.ensureConfigDir(context.globalStorageUri.fsPath);
    this.loadConfig();
  }

  private ensureConfigDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      this.config = { apps: [] };
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  getApps(): AppItem[] {
    return this.config.apps;
  }

  addApp(app: AppItem): void {
    this.config.apps.push(app);
    this.saveConfig();
  }

  removeApp(id: string): void {
    this.config.apps = this.config.apps.filter(app => app.id !== id);
    this.saveConfig();
  }

  updateApp(id: string, updates: Partial<AppItem>): void {
    const index = this.config.apps.findIndex(app => app.id === id);
    if (index !== -1) {
      this.config.apps[index] = { ...this.config.apps[index], ...updates };
      this.saveConfig();
    }
  }

  clearApps(): void {
    this.config.apps = [];
    this.saveConfig();
  }

  generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
