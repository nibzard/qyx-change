/**
 * Qyx Change - AI-Powered Release Notes Generator
 * 
 * Main entry point for programmatic usage
 */

export * from './domains/shared/index.js';
export * from './domains/collection/index.js';
export * from './domains/normalization/index.js';
export * from './domains/generation/index.js';
export * from './domains/output/index.js';

// Import specific classes for the orchestrator
import { 
  QyxChangeConfig, 
  ReleaseData, 
  CollectionOptions, 
  GenerationOptions 
} from './domains/shared/index.js';
import { GitCollector, GitHubCollector } from './domains/collection/index.js';
import { Normalizer, Redactor } from './domains/normalization/index.js';
import { ClaudeGenerator } from './domains/generation/index.js';
import { ChangelogWriter, ChangelogWriteResult } from './domains/output/index.js';

// Main orchestrator class for easy usage
export class QyxChange {
  constructor(private config: QyxChangeConfig) {}

  async generateChangelog(options: {
    since?: string;
    to?: string;
    version?: string;
    includePrs?: boolean;
    includeIssues?: boolean;
  } = {}): Promise<{
    releaseData: ReleaseData;
    changelogResult?: ChangelogWriteResult;
    metadata: {
      changesCount: number;
      sectionsCount: number;
      processingTime: number;
    };
  }> {
    const startTime = Date.now();

    // Collection phase
    const collectionOptions: CollectionOptions = {
      since: options.since,
      to: options.to,
      includePrs: options.includePrs ?? true,
      includeIssues: options.includeIssues ?? false,
    };

    const gitCollector = new GitCollector();
    const changes = await gitCollector.collectCommits(collectionOptions);
    
    // Enrich with GitHub data if available
    if (process.env.GITHUB_TOKEN || process.env.GITHUB_REPOSITORY) {
      try {
        const githubCollector = new GitHubCollector();
        if (options.includePrs) {
          const prChanges = await githubCollector.collectPullRequests(collectionOptions);
          changes.push(...prChanges);
        }
        if (options.includeIssues) {
          const issueChanges = await githubCollector.collectIssues(collectionOptions);
          changes.push(...issueChanges);
        }
      } catch (error) {
        console.warn('Could not fetch GitHub data:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    // Normalization phase
    const normalizer = new Normalizer(this.config.format);
    const normalized = normalizer.normalize(changes);

    // Apply redaction for privacy
    const redactor = new Redactor(this.config.redaction);
    const redactionResult = redactor.redactChanges(normalized.changes);

    // Generation phase
    const generationOptions: GenerationOptions = {
      tonePreset: this.config.generation.tonePreset,
      toneFile: this.config.generation.toneFile,
      locale: this.config.generation.locale,
      includeDeveloperNotes: this.config.generation.includeDeveloperNotes,
      sendDiffSnippets: this.config.generation.sendDiffSnippets,
    };

    const generator = new ClaudeGenerator(generationOptions, this.config.format);
    const generationResult = await generator.generateReleaseNotes(redactionResult.redactedChanges, options.version);

    return {
      releaseData: generationResult.releaseData,
      metadata: {
        changesCount: changes.length,
        sectionsCount: generationResult.releaseData.sections.length,
        processingTime: Date.now() - startTime,
      },
    };
  }

  async writeChangelog(releaseData: ReleaseData, version?: string, targetPath?: string): Promise<ChangelogWriteResult> {
    const writer = new ChangelogWriter(this.config.format);
    return writer.writeChangelog(releaseData, version, targetPath);
  }

  async generateAndWriteChangelog(options: {
    since?: string;
    to?: string;
    version?: string;
    targetPath?: string;
    includePrs?: boolean;
    includeIssues?: boolean;
  } = {}): Promise<{
    releaseData: ReleaseData;
    changelogResult: ChangelogWriteResult;
    metadata: {
      changesCount: number;
      sectionsCount: number;
      processingTime: number;
    };
  }> {
    const result = await this.generateChangelog(options);
    const changelogResult = await this.writeChangelog(result.releaseData, options.version, options.targetPath);
    
    return {
      ...result,
      changelogResult,
    };
  }
}