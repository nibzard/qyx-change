import { simpleGit, SimpleGit, LogResult } from 'simple-git';
import conventionalCommitsParser from 'conventional-commits-parser';
import { Change, ChangeType, CollectionOptions } from '../shared/index.js';
import { CollectionError } from '../shared/errors.js';

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
  refs: string;
  body: string;
}

export class GitCollector {
  private git: SimpleGit;

  constructor(private repoPath: string = process.cwd()) {
    this.git = simpleGit(repoPath);
  }

  async collectCommits(options: CollectionOptions = {}): Promise<Change[]> {
    try {
      const logOptions = await this.buildLogOptions(options);
      const log = await this.git.log(logOptions);
      
      const changes: Change[] = [];
      
      for (const commit of log.all) {
        const change = await this.parseCommit(commit);
        if (change) {
          changes.push(change);
        }
      }
      
      return changes;
    } catch (error) {
      throw new CollectionError(
        `Failed to collect commits: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async buildLogOptions(options: CollectionOptions): Promise<any> {
    const logOptions: any = {
      format: {
        hash: '%H',
        message: '%s',
        author: '%an',
        date: '%ai',
        refs: '%D',
        body: '%b'
      }
    };

    if (options.since && options.to) {
      logOptions.from = options.since;
      logOptions.to = options.to;
    } else if (options.since) {
      logOptions.from = options.since;
    } else if (options.to) {
      logOptions.to = options.to;
    } else {
      // Default: get commits since last tag
      try {
        const latestTag = await this.getLatestTag();
        if (latestTag) {
          logOptions.from = latestTag;
        }
      } catch {
        // If no tags exist, get recent commits
        logOptions.maxCount = 50;
      }
    }

    return logOptions;
  }

  private async getLatestTag(): Promise<string | null> {
    try {
      const tags = await this.git.tags(['--sort=-version:refname']);
      return tags.latest || null;
    } catch {
      return null;
    }
  }

  private async parseCommit(commit: any): Promise<Change | null> {
    try {
      // Parse conventional commit format
      const parsed = conventionalCommitsParser.sync(commit.message);
      
      if (!parsed) {
        return null;
      }

      const type = this.mapCommitType(parsed.type || null);
      
      return {
        id: commit.hash,
        type,
        scope: parsed.scope || undefined,
        title: parsed.subject || commit.message,
        body: commit.body?.trim() || undefined,
        author: commit.author,
        commitSha: commit.hash,
        createdAt: new Date(commit.date),
        linkedIssues: this.extractIssueNumbers(commit.body || ''),
      };
    } catch (error) {
      // If parsing fails, create a basic change entry
      return {
        id: commit.hash,
        type: 'other',
        title: commit.message,
        body: commit.body?.trim() || undefined,
        author: commit.author,
        commitSha: commit.hash,
        createdAt: new Date(commit.date),
      };
    }
  }

  private mapCommitType(type: string | null): ChangeType {
    if (!type) return 'other';
    
    const typeMap: Record<string, ChangeType> = {
      feat: 'feat',
      feature: 'feat',
      fix: 'fix',
      bugfix: 'fix',
      perf: 'perf',
      performance: 'perf',
      docs: 'docs',
      doc: 'docs',
      documentation: 'docs',
      chore: 'chore',
      security: 'security',
      sec: 'security',
    };

    return typeMap[type.toLowerCase()] || 'other';
  }

  private extractIssueNumbers(text: string): string[] {
    const issuePattern = /#(\d+)/g;
    const matches = [];
    let match;
    
    while ((match = issuePattern.exec(text)) !== null) {
      matches.push(`#${match[1]}`);
    }
    
    return matches;
  }

  async getCommitRange(since?: string, to?: string): Promise<{ since: string; to: string }> {
    const toCommit = to || 'HEAD';
    let sinceCommit = since;
    
    if (!sinceCommit) {
      const latestTag = await this.getLatestTag();
      sinceCommit = latestTag || 'HEAD~10'; // Fallback to recent commits
    }
    
    return { since: sinceCommit, to: toCommit };
  }

  async isValidRepository(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }
}