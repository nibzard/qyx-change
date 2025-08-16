import { AuthMode, TonePreset } from './types.js';

export interface FormatSection {
  name: string;
  labels: string[];
}

export interface FormatConfig {
  changelogPath: string;
  sections: FormatSection[];
  maxItemsPerSection?: number;
  includePrLinks?: boolean;
}

export interface GenerationConfig {
  tonePreset: TonePreset;
  toneFile?: string;
  locale: string;
  includeDeveloperNotes: boolean;
  developerNotesTemplate?: string;
  sendDiffSnippets: boolean;
}

export interface RedactionConfig {
  redactPatterns: string[];
  emailMask: boolean;
  truncBodyTo: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
}

export interface AuthConfig {
  mode: AuthMode;
  tokenEnvVar?: string;
}

export interface ActionModule {
  name: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface ActionsConfig {
  enabled: boolean;
  modules: ActionModule[];
}

export interface QyxChangeConfig {
  generator: string;
  auth: AuthConfig;
  format: FormatConfig;
  generation: GenerationConfig;
  redaction: RedactionConfig;
  cache: CacheConfig;
  actions: ActionsConfig;
}

export const DEFAULT_CONFIG: QyxChangeConfig = {
  generator: 'claude-code',
  auth: {
    mode: 'auto',
  },
  format: {
    changelogPath: 'CHANGELOG.md',
    sections: [
      { name: '🚀 Features', labels: ['feature', 'feat'] },
      { name: '🛠 Fixes', labels: ['bug', 'fix'] },
      { name: '⚡ Performance', labels: ['perf'] },
      { name: '📦 Chores', labels: ['chore'] },
      { name: '🔒 Security', labels: ['security'] },
    ],
    maxItemsPerSection: 20,
    includePrLinks: true,
  },
  generation: {
    tonePreset: 'concise',
    locale: 'en-US',
    includeDeveloperNotes: true,
    sendDiffSnippets: false,
  },
  redaction: {
    redactPatterns: [
      'api_?key',
      'secret',
      'password',
      'token',
      'ssh-rsa',
      '-----BEGIN PRIVATE KEY-----',
    ],
    emailMask: true,
    truncBodyTo: 300,
  },
  cache: {
    enabled: true,
    ttlSeconds: 259200, // 3 days
  },
  actions: {
    enabled: false,
    modules: [],
  },
};