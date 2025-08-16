import { Octokit } from '@octokit/rest';
import { ReleaseData } from '../shared/index.js';
import { OutputError } from '../shared/errors.js';

export interface GitHubReleaseOptions {
  owner: string;
  repo: string;
  tagName: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface GitHubReleaseResult {
  releaseId: number;
  htmlUrl: string;
  wasCreated: boolean;
}

export class GitHubReleaseUpdater {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN,
    });
  }

  async createOrUpdateRelease(
    releaseData: ReleaseData,
    options: GitHubReleaseOptions
  ): Promise<GitHubReleaseResult> {
    try {
      const body = this.generateReleaseBody(releaseData);
      
      // Check if release already exists
      const existingRelease = await this.findExistingRelease(options.owner, options.repo, options.tagName);
      
      if (existingRelease) {
        // Update existing release
        const { data } = await this.octokit.repos.updateRelease({
          owner: options.owner,
          repo: options.repo,
          release_id: existingRelease.id,
          name: options.name || releaseData.releaseTitle,
          body,
          draft: options.draft,
          prerelease: options.prerelease,
        });

        return {
          releaseId: data.id,
          htmlUrl: data.html_url,
          wasCreated: false,
        };
      } else {
        // Create new release
        const { data } = await this.octokit.repos.createRelease({
          owner: options.owner,
          repo: options.repo,
          tag_name: options.tagName,
          name: options.name || releaseData.releaseTitle,
          body,
          draft: options.draft,
          prerelease: options.prerelease,
        });

        return {
          releaseId: data.id,
          htmlUrl: data.html_url,
          wasCreated: true,
        };
      }
    } catch (error) {
      throw new OutputError(
        `Failed to create/update GitHub release: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async findExistingRelease(owner: string, repo: string, tagName: string) {
    try {
      const { data } = await this.octokit.repos.getReleaseByTag({
        owner,
        repo,
        tag: tagName,
      });
      return data;
    } catch {
      return null;
    }
  }

  private generateReleaseBody(releaseData: ReleaseData): string {
    let body = '';

    // Add sections
    for (const section of releaseData.sections) {
      if (section.items.length === 0) continue;

      body += `## ${section.title}\n\n`;
      
      for (const item of section.items) {
        let bullet = `- ${item.short}`;
        if (item.why) {
          bullet += ` - ${item.why}`;
        }
        body += `${bullet}\n`;
      }
      
      body += '\n';
    }

    // Add developer notes
    if (releaseData.developerNotes.length > 0) {
      body += '## Developer Notes\n\n';
      
      for (const note of releaseData.developerNotes) {
        let noteText = '';
        switch (note.type) {
          case 'breaking':
            noteText += '⚠️ **BREAKING**: ';
            break;
          case 'migration':
            noteText += '📝 **Migration**: ';
            break;
          case 'deprecation':
            noteText += '🗑️ **Deprecated**: ';
            break;
          default:
            noteText += '💡 **Note**: ';
        }
        noteText += note.desc;
        if (note.migration) {
          noteText += `\n  - Migration: ${note.migration}`;
        }
        body += `- ${noteText}\n`;
      }
      body += '\n';
    }

    // Add summary
    if (releaseData.summary) {
      body += `---\n\n${releaseData.summary}`;
    }

    return body.trim();
  }
}