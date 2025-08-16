#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { promises as fs } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

// Import our domains
import { GitCollector, GitHubCollector } from './domains/collection/index.js';
import { Normalizer, Redactor } from './domains/normalization/index.js';
import { ClaudeGenerator, ToneManager } from './domains/generation/index.js';
import { ChangelogWriter, GitHubReleaseUpdater } from './domains/output/index.js';
import { 
  DEFAULT_CONFIG, 
  QyxChangeConfig, 
  CollectionOptions,
  GenerationOptions 
} from './domains/shared/index.js';

const program = new Command();

interface CLIOptions {
  config?: string;
  since?: string;
  to?: string;
  preview?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  tag?: string;
  push?: boolean;
}

program
  .name('qyx-change')
  .description('Generate beautiful, AI-powered release notes and changelogs')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate changelog from commits and pull requests')
  .option('-c, --config <path>', 'Path to configuration file', '.qyx-change.yml')
  .option('-s, --since <ref>', 'Generate changes since this git reference')
  .option('-t, --to <ref>', 'Generate changes up to this git reference')
  .option('-p, --preview', 'Preview mode - open changelog in editor before writing')
  .option('-v, --verbose', 'Verbose output')
  .option('--dry-run', 'Show what would be generated without writing files')
  .action(async (options: CLIOptions) => {
    try {
      await generateChangelog(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('release')
  .description('Create a release with changelog')
  .option('-c, --config <path>', 'Path to configuration file', '.qyx-change.yml')
  .option('-t, --tag <tag>', 'Release tag (required)', '')
  .option('--push', 'Push changes and create GitHub release')
  .option('-v, --verbose', 'Verbose output')
  .option('--dry-run', 'Show what would be created without making changes')
  .action(async (options: CLIOptions) => {
    if (!options.tag) {
      console.error(chalk.red('Error: --tag is required for release command'));
      process.exit(1);
    }
    
    try {
      await createRelease(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

async function generateChangelog(options: CLIOptions): Promise<void> {
  const spinner = ora('Loading configuration...').start();
  
  try {
    // Load configuration
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    // Collect changes
    spinner.start('Collecting changes from repository...');
    const collectionOptions: CollectionOptions = {
      since: options.since,
      to: options.to,
      includePrs: true,
      includeIssues: false,
    };

    const gitCollector = new GitCollector();
    const changes = await gitCollector.collectCommits(collectionOptions);
    
    // Enrich with GitHub data if available
    if (process.env.GITHUB_TOKEN || process.env.GITHUB_REPOSITORY) {
      try {
        const githubCollector = new GitHubCollector();
        const prChanges = await githubCollector.collectPullRequests(collectionOptions);
        changes.push(...prChanges);
      } catch (error) {
        if (options.verbose) {
          console.warn(chalk.yellow('Warning: Could not fetch GitHub data:'), error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }

    spinner.succeed(`Collected ${changes.length} changes`);

    if (changes.length === 0) {
      console.log(chalk.yellow('No changes found to generate changelog from.'));
      return;
    }

    // Normalize and process changes
    spinner.start('Processing and normalizing changes...');
    const normalizer = new Normalizer(config.format);
    const normalized = normalizer.normalize(changes);

    // Apply redaction for privacy
    const redactor = new Redactor(config.redaction);
    const redactionResult = redactor.redactChanges(normalized.changes);
    
    spinner.succeed('Changes processed and privacy-filtered');

    if (options.verbose && redactionResult.redactionReport.redactedCount > 0) {
      console.log(chalk.yellow(`Privacy note: ${redactionResult.redactionReport.redactedCount} changes were redacted for security`));
    }

    // Generate release notes using Claude
    spinner.start('Generating release notes with AI...');
    const generationOptions: GenerationOptions = {
      tonePreset: config.generation.tonePreset,
      toneFile: config.generation.toneFile,
      locale: config.generation.locale,
      includeDeveloperNotes: config.generation.includeDeveloperNotes,
      sendDiffSnippets: config.generation.sendDiffSnippets,
    };

    const generator = new ClaudeGenerator(generationOptions, config.format);
    const generationResult = await generator.generateReleaseNotes(redactionResult.redactedChanges);
    
    spinner.succeed('Release notes generated');

    if (options.verbose) {
      console.log(chalk.blue('Generation metadata:'));
      console.log(`- Processing time: ${generationResult.generationMetadata.processingTime}ms`);
      console.log(`- Fallback used: ${generationResult.generationMetadata.fallbackUsed}`);
      console.log(`- Validated: ${generationResult.generationMetadata.wasValidated}`);
    }

    // Preview or write changelog
    if (options.preview) {
      await previewChangelog(generationResult.releaseData, config);
    } else if (options.dryRun) {
      const writer = new ChangelogWriter(config.format);
      const preview = await writer.previewChangelog(generationResult.releaseData);
      console.log(chalk.blue('\n--- Changelog Preview ---\n'));
      console.log(preview);
      console.log(chalk.blue('\n--- End Preview ---\n'));
    } else {
      spinner.start('Writing changelog...');
      const writer = new ChangelogWriter(config.format);
      const writeResult = await writer.writeChangelog(generationResult.releaseData);
      
      spinner.succeed(`Changelog ${writeResult.wasUpdated ? 'updated' : 'created'}: ${writeResult.changelogPath}`);
    }

  } catch (error) {
    spinner.fail('Failed to generate changelog');
    throw error;
  }
}

async function createRelease(options: CLIOptions): Promise<void> {
  const spinner = ora('Creating release...').start();
  
  try {
    // First generate the changelog
    await generateChangelog({ ...options, preview: false });
    
    if (options.push && !options.dryRun) {
      spinner.start('Creating GitHub release...');
      
      // Parse repository info
      const repoEnv = process.env.GITHUB_REPOSITORY;
      if (!repoEnv) {
        throw new Error('GITHUB_REPOSITORY environment variable is required for GitHub release');
      }
      
      const [owner, repo] = repoEnv.split('/');
      if (!owner || !repo) {
        throw new Error('Invalid GITHUB_REPOSITORY format');
      }

      // Load config to get the generated release data
      const config = await loadConfig(options.config);
      
      // TODO: We need to store the release data from generation to use here
      // For now, create a simple release
      const releaseUpdater = new GitHubReleaseUpdater();
      const releaseResult = await releaseUpdater.createOrUpdateRelease(
        {
          releaseTitle: `${options.tag} Release`,
          sections: [],
          developerNotes: [],
          summary: 'Release created via qyx-change',
        },
        {
          owner,
          repo,
          tagName: options.tag!,
          name: `Release ${options.tag}`,
        }
      );

      spinner.succeed(`GitHub release ${releaseResult.wasCreated ? 'created' : 'updated'}: ${releaseResult.htmlUrl}`);
    } else {
      spinner.succeed('Release prepared (use --push to publish to GitHub)');
    }

  } catch (error) {
    spinner.fail('Failed to create release');
    throw error;
  }
}

async function loadConfig(configPath?: string): Promise<QyxChangeConfig> {
  const configFile = configPath || '.qyx-change.yml';
  
  try {
    const configContent = await fs.readFile(configFile, 'utf-8');
    const userConfig = YAML.parse(configContent) as Partial<QyxChangeConfig>;
    
    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      format: { ...DEFAULT_CONFIG.format, ...userConfig.format },
      generation: { ...DEFAULT_CONFIG.generation, ...userConfig.generation },
      redaction: { ...DEFAULT_CONFIG.redaction, ...userConfig.redaction },
      cache: { ...DEFAULT_CONFIG.cache, ...userConfig.cache },
      auth: { ...DEFAULT_CONFIG.auth, ...userConfig.auth },
      actions: { ...DEFAULT_CONFIG.actions, ...userConfig.actions },
    };
  } catch (error) {
    // Only throw error if a specific config path was provided
    if (configPath && configPath !== '.qyx-change.yml') {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    
    // Use defaults if default config file doesn't exist
    return DEFAULT_CONFIG;
  }
}

async function previewChangelog(releaseData: any, config: QyxChangeConfig): Promise<void> {
  const writer = new ChangelogWriter(config.format);
  const preview = await writer.previewChangelog(releaseData);
  
  console.log(chalk.blue('\n--- Changelog Preview ---\n'));
  console.log(preview);
  console.log(chalk.blue('\n--- End Preview ---\n'));
  
  // TODO: Open in editor for interactive editing
  console.log(chalk.yellow('Interactive editing not yet implemented. Use --dry-run to see output.'));
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled Rejection:'), reason);
  process.exit(1);
});

program.parse();