import { Octokit } from '@octokit/rest';
import { Change, ChangeType, CollectionOptions } from '../shared/index.js';
import { CollectionError } from '../shared/errors.js';

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  author: string;
  mergedAt: string | null;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  htmlUrl: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  author: string;
  closedAt: string | null;
  htmlUrl: string;
}

export class GitHubCollector {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN,
    });
    
    const repoInfo = this.parseRepositoryInfo();
    this.owner = repoInfo.owner;
    this.repo = repoInfo.repo;
  }

  private parseRepositoryInfo(): { owner: string; repo: string } {
    // Try to get from environment first (GitHub Actions)
    const repoEnv = process.env.GITHUB_REPOSITORY;
    if (repoEnv) {
      const parts = repoEnv.split('/');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { owner: parts[0], repo: parts[1] };
      }
    }

    // TODO: Add git remote parsing for local usage
    throw new CollectionError('Repository information not available. Set GITHUB_REPOSITORY or run in a GitHub repository.');
  }

  async collectPullRequests(options: CollectionOptions = {}): Promise<Change[]> {
    try {
      const prs = await this.fetchMergedPullRequests(options);
      return prs.map(pr => this.prToChange(pr));
    } catch (error) {
      throw new CollectionError(
        `Failed to collect pull requests: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async collectIssues(options: CollectionOptions = {}): Promise<Change[]> {
    try {
      const issues = await this.fetchClosedIssues(options);
      return issues.map(issue => this.issueToChange(issue));
    } catch (error) {
      throw new CollectionError(
        `Failed to collect issues: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async enrichCommitWithPRData(commitSha: string): Promise<Partial<Change> | null> {
    try {
      // Find PRs that contain this commit
      const { data: prs } = await this.octokit.repos.listPullRequestsAssociatedWithCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: commitSha,
      });

      if (prs.length === 0) {
        return null;
      }

      // Use the first (most relevant) PR
      const pr = prs[0];
      if (!pr) {
        return null;
      }
      
      return {
        prNumber: pr.number,
        prUrl: pr.html_url,
        labels: pr.labels.map((label: any) => typeof label === 'string' ? label : label.name || ''),
        title: pr.title,
        body: pr.body || undefined,
      };
    } catch (error) {
      // Non-critical error, return null
      return null;
    }
  }

  private async fetchMergedPullRequests(options: CollectionOptions): Promise<GitHubPullRequest[]> {
    const pulls: GitHubPullRequest[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data: prs } = await this.octokit.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
      });

      if (prs.length === 0) break;

      for (const pr of prs) {
        if (!pr.merged_at) continue;

        const mergedAt = new Date(pr.merged_at);
        
        // Apply time filtering if specified
        if (options.since && mergedAt < new Date(options.since)) continue;
        if (options.to && mergedAt > new Date(options.to)) continue;

        pulls.push({
          number: pr.number,
          title: pr.title,
          body: pr.body,
          labels: pr.labels.map((label: any) => typeof label === 'string' ? label : label.name || ''),
          author: pr.user?.login || 'unknown',
          mergedAt: pr.merged_at,
          commits: (pr as any).commits || 0,
          additions: (pr as any).additions || 0,
          deletions: (pr as any).deletions || 0,
          changedFiles: (pr as any).changed_files || 0,
          htmlUrl: pr.html_url,
        });
      }

      page++;
      if (prs.length < perPage) break;
    }

    return pulls;
  }

  private async fetchClosedIssues(options: CollectionOptions): Promise<GitHubIssue[]> {
    const issues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data: issueList } = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
      });

      if (issueList.length === 0) break;

      for (const issue of issueList) {
        // Skip pull requests (they appear in issues endpoint)
        if (issue.pull_request) continue;
        if (!issue.closed_at) continue;

        const closedAt = new Date(issue.closed_at);
        
        // Apply time filtering if specified
        if (options.since && closedAt < new Date(options.since)) continue;
        if (options.to && closedAt > new Date(options.to)) continue;

        issues.push({
          number: issue.number,
          title: issue.title,
          body: issue.body || null,
          labels: issue.labels.map((label: any) => typeof label === 'string' ? label : label.name || ''),
          author: issue.user?.login || 'unknown',
          closedAt: issue.closed_at || null,
          htmlUrl: issue.html_url,
        });
      }

      page++;
      if (issueList.length < perPage) break;
    }

    return issues;
  }

  private prToChange(pr: GitHubPullRequest): Change {
    const type = this.inferChangeType(pr.title, pr.labels);
    
    return {
      id: `#${pr.number}`,
      type,
      title: pr.title,
      body: pr.body || undefined,
      labels: pr.labels,
      author: pr.author,
      filesChangedCount: pr.changedFiles,
      prNumber: pr.number,
      prUrl: pr.htmlUrl,
      createdAt: pr.mergedAt ? new Date(pr.mergedAt) : undefined,
      linkedIssues: this.extractIssueNumbers(pr.body || ''),
    };
  }

  private issueToChange(issue: GitHubIssue): Change {
    const type = this.inferChangeType(issue.title, issue.labels);
    
    return {
      id: `#${issue.number}`,
      type,
      title: issue.title,
      body: issue.body || undefined,
      labels: issue.labels,
      author: issue.author,
      createdAt: issue.closedAt ? new Date(issue.closedAt) : undefined,
    };
  }

  private inferChangeType(title: string, labels: string[]): ChangeType {
    const titleLower = title.toLowerCase();
    
    // Check labels first (more reliable)
    for (const label of labels) {
      const labelLower = label.toLowerCase();
      if (['feature', 'feat', 'enhancement'].includes(labelLower)) return 'feat';
      if (['bug', 'fix', 'bugfix'].includes(labelLower)) return 'fix';
      if (['performance', 'perf'].includes(labelLower)) return 'perf';
      if (['documentation', 'docs', 'doc'].includes(labelLower)) return 'docs';
      if (['security', 'sec'].includes(labelLower)) return 'security';
      if (['chore', 'maintenance'].includes(labelLower)) return 'chore';
    }
    
    // Fallback to title analysis
    if (titleLower.includes('feat') || titleLower.includes('add') || titleLower.includes('implement')) {
      return 'feat';
    }
    if (titleLower.includes('fix') || titleLower.includes('bug') || titleLower.includes('resolve')) {
      return 'fix';
    }
    if (titleLower.includes('perf') || titleLower.includes('performance') || titleLower.includes('optimize')) {
      return 'perf';
    }
    if (titleLower.includes('doc') || titleLower.includes('readme')) {
      return 'docs';
    }
    if (titleLower.includes('security') || titleLower.includes('vulnerable')) {
      return 'security';
    }
    
    return 'other';
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
}