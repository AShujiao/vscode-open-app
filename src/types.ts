export interface AppItem {
  id: string;
  name: string;
  path: string;
  icon?: string;
  args?: string[];
}

export interface AppConfig {
  apps: AppItem[];
}
