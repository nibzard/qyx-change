import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import YAML from 'yaml';

// Import our domains
import { GitCollector, GitHubCollector } from './domains/collection/index.js';
import { Normalizer, Redactor } from './domains/normalization/index.js';
import { ClaudeGenerator } from './domains/generation/index.js';
import { ChangelogWriter, GitHubReleaseUpdater } from './domains/output/index.js';
import { 
  DEFAULT_CONFIG, 
  QyxChangeConfig, 
  CollectionOptions,
  GenerationOptions 
} from './domains/shared/index.js';

async function run(): Promise<void> {
  try {
    // Get inputs
    const changelogPath = core.getInput('changelog_path') || 'CHANGELOG.md';
    const configPath = core.getInput('config_path') || '.qyx-change.yml';
    const since = core.getInput('since') || undefined;
    const to = core.getInput('to') || undefined;
    const commitChanges = core.getInput('commit_changes') === 'true';
    const createPr = core.getInput('create_pr') === 'true';
    const updateRelease = core.getInput('update_release') === 'true';
    const tonePreset = core.getInput('tone_preset') || 'concise';

    core.info('🚀 Starting Qyx Change action...');

    // Load configuration
    const config = await loadConfig(configPath, tonePreset);
    core.info(`📋 Configuration loaded from ${configPath}`);

    // Collect changes
    core.info('📥 Collecting changes from repository...');
    const collectionOptions: CollectionOptions = {
      since,
      to,
      includePrs: true,
      includeIssues: false,
    };

    const gitCollector = new GitCollector();
    const changes = await gitCollector.collectCommits(collectionOptions);
    
    // Enrich with GitHub data
    const githubCollector = new GitHubCollector(process.env.GITHUB_TOKEN);
    const prChanges = await githubCollector.collectPullRequests(collectionOptions);
    changes.push(...prChanges);

    core.info(`📊 Collected ${changes.length} changes`);
    core.setOutput('changes_count', changes.length.toString());

    if (changes.length === 0) {
      core.warning('No changes found to generate changelog from');
      return;
    }

    // Normalize and process changes
    core.info('🔄 Processing and normalizing changes...');
    const normalizer = new Normalizer(config.format);
    const normalized = normalizer.normalize(changes);

    // Apply redaction for privacy
    const redactor = new Redactor(config.redaction);
    const redactionResult = redactor.redactChanges(normalized.changes);
    
    if (redactionResult.redactionReport.redactedCount > 0) {
      core.warning(`🛡️ ${redactionResult.redactionReport.redactedCount} changes were redacted for security`);
    }

    // Generate release notes using Claude
    core.info('🤖 Generating release notes with AI...');
    const generationOptions: GenerationOptions = {
      tonePreset: config.generation.tonePreset,
      toneFile: config.generation.toneFile,
      locale: config.generation.locale,
      includeDeveloperNotes: config.generation.includeDeveloperNotes,
      sendDiffSnippets: config.generation.sendDiffSnippets,
    };

    const generator = new ClaudeGenerator(generationOptions, config.format);
    const generationResult = await generator.generateReleaseNotes(redactionResult.redactedChanges);
    
    core.info(`✨ Release notes generated (${generationResult.generationMetadata.processingTime}ms)`);
    core.setOutput('sections_count', generationResult.releaseData.sections.length.toString());

    // Write changelog
    core.info('📝 Writing changelog...');
    const writer = new ChangelogWriter(config.format);
    const writeResult = await writer.writeChangelog(
      generationResult.releaseData,
      github.context.ref?.replace('refs/tags/', ''),
      changelogPath
    );
    
    core.info(`📄 Changelog ${writeResult.wasUpdated ? 'updated' : 'created'}: ${writeResult.changelogPath}`);
    core.setOutput('changelog_path', writeResult.changelogPath);
    core.setOutput('release_notes', writeResult.content);

    // Create artifact with release data
    await fs.writeFile('release-preview.md', writeResult.content);
    await fs.writeFile('delta.json', JSON.stringify({
      changes: redactionResult.redactedChanges,
      releaseData: generationResult.releaseData,
      metadata: generationResult.generationMetadata,
    }, null, 2));

    core.info('📦 Created artifacts: release-preview.md, delta.json');

    // Update GitHub release if configured
    if (updateRelease && github.context.eventName === 'release') {
      core.info('🚀 Updating GitHub release...');
      
      const releaseUpdater = new GitHubReleaseUpdater(process.env.GITHUB_TOKEN);
      const [owner, repo] = github.context.repo.owner.split('/');
      
      const releaseResult = await releaseUpdater.createOrUpdateRelease(
        generationResult.releaseData,
        {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          tagName: github.context.ref.replace('refs/tags/', ''),
        }
      );

      core.info(`🎉 GitHub release ${releaseResult.wasCreated ? 'created' : 'updated'}`);
    }

    // TODO: Implement commit changes and PR creation
    if (commitChanges || createPr) {
      core.warning('Commit changes and PR creation not yet implemented');
    }

    core.info('✅ Qyx Change action completed successfully!');

  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function loadConfig(configPath: string, tonePreset?: string): Promise<QyxChangeConfig> {
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = YAML.parse(configContent) as Partial<QyxChangeConfig>;
    
    // Override tone preset from input if provided
    if (tonePreset && userConfig.generation) {
      userConfig.generation.tonePreset = tonePreset as any;
    }
    
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
    core.info(`No config file found at ${configPath}, using defaults`);
    const config = { ...DEFAULT_CONFIG };
    
    if (tonePreset) {
      config.generation.tonePreset = tonePreset as any;
    }
    
    return config;
  }
}

run();