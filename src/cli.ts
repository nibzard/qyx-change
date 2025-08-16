#!/usr/bin/env node

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { promises as fs } from 'fs';
import YAML from 'yaml';

// Load environment variables from .env files
config({ path: '.env.local', override: true });  // Override shell vars with .env.local
config({ path: '.env', override: true });

// Import our domains
import { GitCollector, GitHubCollector } from './domains/collection/index.js';
import { Normalizer, Redactor } from './domains/normalization/index.js';
import { ClaudeGenerator } from './domains/generation/index.js';
import { ChangelogWriter, GitHubReleaseUpdater } from './domains/output/index.js';
import { 
  DEFAULT_CONFIG, 
  QyxChangeConfig, 
  CollectionOptions,
  GenerationOptions,
  ConfigValidator 
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
    
    // Validate configuration
    const configValidation = ConfigValidator.validate(config);
    const envValidation = ConfigValidator.validateEnvironment();
    
    if (!configValidation.isValid || !envValidation.isValid) {
      spinner.fail('Configuration validation failed');
      
      [...configValidation.errors, ...envValidation.errors].forEach(error => {
        console.error(chalk.red('  ❌'), error);
      });
      
      if (options.verbose) {
        [...configValidation.warnings, ...envValidation.warnings].forEach(warning => {
          console.warn(chalk.yellow('  ⚠️'), warning);
        });
      }
      
      throw new Error('Invalid configuration. Please fix the errors above.');
    }
    
    if (options.verbose && (configValidation.warnings.length > 0 || envValidation.warnings.length > 0)) {
      [...configValidation.warnings, ...envValidation.warnings].forEach(warning => {
        console.warn(chalk.yellow('⚠️'), warning);
      });
    }
    
    spinner.succeed('Configuration loaded and validated');

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
    // Load configuration
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    // Collect and generate release data
    spinner.start('Generating release data...');
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

    // Normalize and process changes
    const normalizer = new Normalizer(config.format);
    const normalized = normalizer.normalize(changes);

    // Apply redaction for privacy
    const redactor = new Redactor(config.redaction);
    const redactionResult = redactor.redactChanges(normalized.changes);

    // Generate release notes using Claude
    const generationOptions: GenerationOptions = {
      tonePreset: config.generation.tonePreset,
      toneFile: config.generation.toneFile,
      locale: config.generation.locale,
      includeDeveloperNotes: config.generation.includeDeveloperNotes,
      sendDiffSnippets: config.generation.sendDiffSnippets,
    };

    const generator = new ClaudeGenerator(generationOptions, config.format);
    const generationResult = await generator.generateReleaseNotes(redactionResult.redactedChanges, options.tag);
    
    spinner.succeed('Release data generated');

    // Write changelog
    if (!options.dryRun) {
      spinner.start('Writing changelog...');
      const writer = new ChangelogWriter(config.format);
      const writeResult = await writer.writeChangelog(generationResult.releaseData, options.tag);
      spinner.succeed(`Changelog ${writeResult.wasUpdated ? 'updated' : 'created'}: ${writeResult.changelogPath}`);
    }
    
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

      // Create GitHub release with the generated data
      const releaseUpdater = new GitHubReleaseUpdater();
      const releaseResult = await releaseUpdater.createOrUpdateRelease(
        generationResult.releaseData,
        {
          owner,
          repo,
          tagName: options.tag!,
          name: `Release ${options.tag}`,
        }
      );

      spinner.succeed(`GitHub release ${releaseResult.wasCreated ? 'created' : 'updated'}: ${releaseResult.htmlUrl}`);
    } else if (options.dryRun) {
      // Show preview
      const writer = new ChangelogWriter(config.format);
      const preview = await writer.previewChangelog(generationResult.releaseData, options.tag);
      console.log(chalk.blue('\n--- Release Preview ---\n'));
      console.log(preview);
      console.log(chalk.blue('\n--- End Preview ---\n'));
      spinner.succeed('Release prepared (dry run)');
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
  
  // Interactive preview with options
  const { prompt } = await import('enquirer');
  
  try {
    const response = await prompt<{ action: string }>({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'accept', message: 'Accept and save changelog' },
        { name: 'edit', message: 'Open in editor for manual editing' },
        { name: 'regenerate', message: 'Regenerate with different tone' },
        { name: 'cancel', message: 'Cancel without saving' }
      ]
    });

    switch (response.action) {
      case 'accept':
        await writer.writeChangelog(releaseData);
        console.log(chalk.green('✅ Changelog saved!'));
        break;
        
      case 'edit':
        await openInEditor(preview, config);
        break;
        
      case 'regenerate':
        console.log(chalk.yellow('🔄 Regeneration not yet implemented. Use different tone presets in config.'));
        break;
        
      case 'cancel':
        console.log(chalk.gray('Cancelled.'));
        break;
    }
  } catch (error) {
    // User cancelled or error occurred
    console.log(chalk.gray('\nCancelled.'));
  }
}

async function openInEditor(content: string, config: QyxChangeConfig): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  
  const execAsync = promisify(exec);
  
  try {
    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qyx-change-'));
    const tempFile = path.join(tempDir, 'changelog-preview.md');
    
    await fs.writeFile(tempFile, content, 'utf-8');
    
    // Determine editor
    const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
    
    console.log(chalk.blue(`Opening in ${editor}...`));
    console.log(chalk.gray('Save and exit the editor to continue.'));
    
    // Open in editor (we need to use spawn for TTY handling, but for simplicity, use exec)
    await execAsync(`${editor} "${tempFile}"`);
    
    // Read the edited content
    const editedContent = await fs.readFile(tempFile, 'utf-8');
    
    // Ask if user wants to save the edited version
    const { prompt } = await import('enquirer');
    const response = await prompt<{ save: boolean }>({
      type: 'confirm',
      name: 'save',
      message: 'Save the edited changelog?',
      initial: true
    });
    
    if (response.save) {
      // Write the edited content to the actual changelog
      await fs.writeFile(config.format.changelogPath, editedContent, 'utf-8');
      console.log(chalk.green(`✅ Saved to ${config.format.changelogPath}`));
    } else {
      console.log(chalk.gray('Changes discarded.'));
    }
    
    // Clean up temp file
    await fs.rm(tempDir, { recursive: true, force: true });
    
  } catch (error) {
    console.error(chalk.red('Failed to open editor:'), error instanceof Error ? error.message : 'Unknown error');
    console.log(chalk.yellow('💡 Tip: Set the EDITOR environment variable to your preferred editor.'));
  }
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