import { config } from 'dotenv';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import YAML from 'yaml';

// Load environment variables from .env files for local testing
config({ path: '.env.local' });
config({ path: '.env' });

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
      const owner = github.context.repo.owner;
      const repo = github.context.repo.repo;
      
      const releaseResult = await releaseUpdater.createOrUpdateRelease(
        generationResult.releaseData,
        {
          owner,
          repo,
          tagName: github.context.ref.replace('refs/tags/', ''),
        }
      );

      core.info(`🎉 GitHub release ${releaseResult.wasCreated ? 'created' : 'updated'}`);
    }

    // Commit changes if configured
    if (commitChanges) {
      core.info('💾 Committing changelog changes...');
      
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Add the changelog file
        await execAsync(`git add "${writeResult.changelogPath}"`);
        
        // Commit with a descriptive message
        const commitMessage = `chore: update changelog for ${github.context.ref?.replace('refs/tags/', '') || 'release'}

Generated with Qyx Change - AI-powered release notes

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;
        
        await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
        core.info('✅ Changelog changes committed');
        
        // Push if on a branch (not a tag)
        if (!github.context.ref?.startsWith('refs/tags/')) {
          await execAsync('git push');
          core.info('📤 Changes pushed to repository');
        }
        
      } catch (error) {
        core.warning(`Failed to commit changes: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Create PR if configured
    if (createPr) {
      core.info('🔄 Creating pull request...');
      
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Create a new branch for the changelog
        const branchName = `qyx-change/release-${github.context.ref?.replace('refs/tags/', '') || Date.now()}`;
        await execAsync(`git checkout -b "${branchName}"`);
        
        // Add and commit changes on the new branch
        await execAsync(`git add "${writeResult.changelogPath}"`);
        
        const commitMessage = `Update changelog for ${github.context.ref?.replace('refs/tags/', '') || 'release'}`;
        await execAsync(`git commit -m "${commitMessage}"`);
        
        // Push the branch
        await execAsync(`git push -u origin "${branchName}"`);
        
        // Create PR using GitHub API
        const octokit = github.getOctokit(process.env.GITHUB_TOKEN || '');
        const prResponse = await octokit.rest.pulls.create({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          title: `📝 Update changelog for ${github.context.ref?.replace('refs/tags/', '') || 'release'}`,
          head: branchName,
          base: 'main', // or 'master' - might need to detect default branch
          body: `## Changelog Update

This PR updates the changelog with AI-generated release notes.

### Summary
${generationResult.releaseData.summary}

### Changes
- Updated \`${writeResult.changelogPath}\` with ${generationResult.releaseData.sections.length} sections
- Processed ${changes.length} changes

---

🤖 **Auto-generated** by [Qyx Change](https://github.com/qyx/change) using Claude Code AI`,
        });
        
        core.info(`✅ Pull request created: ${prResponse.data.html_url}`);
        core.setOutput('pr_url', prResponse.data.html_url);
        core.setOutput('pr_number', prResponse.data.number.toString());
        
      } catch (error) {
        core.warning(`Failed to create pull request: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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