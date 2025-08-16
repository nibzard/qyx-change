/**
 * Core shared types for the Qyx Change system
 */

export type ChangeType = 
  | 'feat' 
  | 'fix' 
  | 'chore' 
  | 'perf' 
  | 'docs' 
  | 'security' 
  | 'other';

export interface Change {
  id: string;
  type: ChangeType;
  scope?: string | undefined;
  title: string;
  body?: string | undefined;
  labels?: string[] | undefined;
  author?: string | undefined;
  filesChangedCount?: number | undefined;
  linkedIssues?: string[] | undefined;
  prNumber?: number | undefined;
  prUrl?: string | undefined;
  commitSha?: string | undefined;
  createdAt?: Date | undefined;
  shortHash?: string | undefined;
  rawMessage?: string | undefined;
}

export interface ReleaseSection {
  id: string;
  title: string;
  items: ReleaseItem[];
}

export interface ReleaseItem {
  id: string;
  short: string;
  pr?: string | null | undefined;
  why?: string | null | undefined;
}

export interface DeveloperNote {
  type: 'breaking' | 'migration' | 'deprecation' | 'info';
  desc: string;
  migration?: string;
}

export interface ReleaseData {
  releaseTitle: string;
  sections: ReleaseSection[];
  developerNotes: DeveloperNote[];
  summary: string;
  suspectPii?: boolean;
  suspectJargon?: boolean;
}

export interface CollectionOptions {
  since?: string | undefined;
  to?: string | undefined;
  includePrs?: boolean | undefined;
  includeIssues?: boolean | undefined;
}

export interface GenerationOptions {
  tonePreset: TonePreset;
  toneFile?: string | undefined;
  locale: string;
  includeDeveloperNotes: boolean;
  sendDiffSnippets: boolean;
  maxTurns?: number | undefined;
}

export type TonePreset = 'concise' | 'friendly' | 'formal' | 'detailed' | 'custom';

export type AuthMode = 'auto' | 'api-key' | 'oauth';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';