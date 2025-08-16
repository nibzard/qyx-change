import { query } from '@anthropic-ai/claude-code';
import { 
  Change, 
  ReleaseData, 
  GenerationOptions, 
  FormatConfig,
  ReleaseSection,
  ReleaseItem 
} from '../shared/index.js';
import { GenerationError } from '../shared/errors.js';

export interface GenerationResult {
  releaseData: ReleaseData;
  generationMetadata: {
    processingTime: number;
    tokensUsed?: number;
    wasValidated: boolean;
    fallbackUsed: boolean;
  };
}

export class ClaudeGenerator {
  constructor(
    private options: GenerationOptions,
    private formatConfig: FormatConfig
  ) {}

  async generateReleaseNotes(
    changes: Change[],
    version?: string
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    
    try {
      // Build the prompt
      const prompt = this.buildPrompt(changes, version);
      
      // Call Claude Code SDK
      const result = await this.callClaude(prompt);
      
      // Parse and validate the result
      const releaseData = this.parseClaudeResponse(result);
      const validationResult = this.validateReleaseData(releaseData);
      
      if (!validationResult.isValid) {
        // Try once more with a simplified prompt
        const fallbackResult = await this.callClaudeWithFallback(changes, version);
        const fallbackData = this.parseClaudeResponse(fallbackResult);
        
        return {
          releaseData: fallbackData,
          generationMetadata: {
            processingTime: Date.now() - startTime,
            wasValidated: false,
            fallbackUsed: true,
          },
        };
      }
      
      return {
        releaseData,
        generationMetadata: {
          processingTime: Date.now() - startTime,
          wasValidated: true,
          fallbackUsed: false,
        },
      };
    } catch (error) {
      // Fall back to deterministic generation
      const deterministicData = this.generateDeterministicReleaseNotes(changes, version);
      
      return {
        releaseData: deterministicData,
        generationMetadata: {
          processingTime: Date.now() - startTime,
          wasValidated: false,
          fallbackUsed: true,
        },
      };
    }
  }

  private buildPrompt(changes: Change[], version?: string): string {
    const changesJson = JSON.stringify(changes, null, 2);
    const sections = this.formatConfig.sections.map(s => `- ${s.name}: ${s.labels.join(', ')}`).join('\n');
    const versionHeader = version ? `## ${version} — ${new Date().toISOString().split('T')[0]}` : '## [Unreleased]';
    
    return `Generate professional release notes for the following changes:

**Version**: ${version || 'Next Release'}
**Changes**: ${changes.length} items
**Available Sections**: 
${sections}

**Changes Data**:
${changesJson}

Please respond in this EXACT format:

${versionHeader}

### 🚀 Features
- [Feature description with commit/PR reference]

### 🛠 Fixes
- [Fix description with commit/PR reference]

### ⚡ Performance
- [Performance improvement with commit/PR reference]

### 📦 Chores
- [Chore description with commit/PR reference]

### 🔒 Security
- [Security fix with commit/PR reference]

**Summary:** [1-2 sentence summary of this release]

**Requirements**:
1. Categorize each change into the appropriate section based on type/labels
2. Include commit hash or PR number in parentheses: (abc1234) or (#123)
3. Write clear, technical descriptions for developers
4. Skip empty sections
5. Focus on user impact and technical changes
6. Use the exact section names and emojis shown above`;
  }

  private getSystemPrompt(): string {
    const toneInstructions = this.getToneInstructions();
    
    return `You are an expert technical writer specializing in release notes and changelogs for software projects. Your task is to transform raw commit and pull request data into clear, professional release notes that are valuable for both developers and end users.

${toneInstructions}

Core principles:
- Accuracy: Never invent features or changes not present in the data
- Clarity: Write for your target audience using appropriate technical depth
- Consistency: Follow the established format and section structure
- Completeness: Cover all significant changes while prioritizing by impact
- Privacy: Never include sensitive information like API keys, secrets, or personal data

When analyzing changes:
- Prioritize pull requests over individual commits for richer context
- Group related changes logically within sections
- Identify breaking changes and provide migration guidance
- Focus on user impact rather than implementation details (unless technical audience)`;
  }

  private getToneInstructions(): string {
    switch (this.options.tonePreset) {
      case 'concise':
        return `Tone: Concise and technical
- Target audience: Experienced developers
- Style: Direct, no-fluff technical descriptions
- Example: "Fix memory leak in WebSocket connections (#123)"`;
        
      case 'friendly':
        return `Tone: Friendly and approachable  
- Target audience: Mixed technical and non-technical users
- Style: Conversational but professional, explain impact
- Example: "Fixed a tricky memory leak that was causing WebSocket connections to pile up over time (#123)"`;
        
      case 'formal':
        return `Tone: Professional and formal
- Target audience: Enterprise users and decision makers
- Style: Business-appropriate, emphasize stability and compliance
- Example: "Resolved memory management issue affecting WebSocket connection stability (#123)"`;
        
      case 'detailed':
        return `Tone: Comprehensive and educational
- Target audience: Technical users who want full context
- Style: Detailed explanations with background and implications
- Example: "Fixed memory leak in WebSocket connection handler that occurred when connections were not properly cleaned up during reconnection scenarios, improving long-running application stability (#123)"`;
        
      default:
        return 'Use a balanced, professional tone suitable for a technical audience.';
    }
  }

  private async callClaude(prompt: string): Promise<string> {
    // Check authentication first
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasClaudeToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    
    if (!hasAnthropicKey && !hasClaudeToken) {
      throw new GenerationError('No authentication found. Please set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
    }

    // Try Claude CLI first (more reliable)
    try {
      console.log('🤖 Calling Claude Code CLI...');
      console.log('📝 Prompt length:', prompt.length, 'characters');
      
      return await this.callClaudeCLI(prompt);
      
    } catch (cliError) {
      console.log('❌ Claude CLI failed, trying SDK fallback:', cliError instanceof Error ? cliError.message : 'Unknown error');
      
      // Fallback to SDK if CLI fails
      try {
        console.log('🔄 Trying Claude Code SDK...');
        
        for await (const message of query({
          prompt,
          options: {
            maxTurns: this.options.maxTurns || 1,
            appendSystemPrompt: this.getToneInstructions(),
          },
        })) {
          console.log('📨 Received message type:', message.type);
          
          if (message.type === 'result') {
            const result = (message as any).result;
            console.log('✅ Got result from Claude SDK, length:', result?.length || 0);
            return result;
          }
        }
        
        throw new GenerationError('Claude SDK produced no result');
        
      } catch (sdkError) {
        console.log('❌ Both Claude CLI and SDK failed');
        
        // Last resort: deterministic fallback
        console.log('🔄 Using deterministic fallback generation');
        throw new GenerationError(
          `Both Claude CLI and SDK failed. CLI: ${cliError instanceof Error ? cliError.message : 'Unknown'}. SDK: ${sdkError instanceof Error ? sdkError.message : 'Unknown'}`
        );
      }
    }
  }

  private async callClaudeCLI(prompt: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      console.log('🔄 Trying Claude CLI fallback...');
      
      // Create a temporary file for the prompt to avoid command line length limits
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qyx-change-'));
      const promptFile = path.join(tempDir, 'prompt.txt');
      
      await fs.writeFile(promptFile, prompt, 'utf-8');
      
      const toneInstructions = this.getToneInstructions();
      const systemPrompt = toneInstructions ? `--append-system-prompt "${toneInstructions.replace(/"/g, '\\"')}"` : '';
      
      const command = `claude --print ${systemPrompt} < "${promptFile}"`;
      console.log('🚀 Executing:', command);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        env: process.env, // Ensure environment variables are passed
      });
      
      // Clean up temp file
      await fs.rm(tempDir, { recursive: true, force: true });
      
      if (stderr) {
        console.warn('⚠️ Claude CLI stderr:', stderr);
        // Don't fail on stderr alone, some tools output progress to stderr
      }
      
      const result = stdout.trim();
      console.log('✅ Got result from Claude CLI, length:', result.length);
      console.log('📄 Claude result preview:', result.substring(0, 200) + '...');
      return result;
      
    } catch (error) {
      console.error('❌ Claude CLI execution failed:');
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        if ('code' in error) {
          console.error('Exit code:', (error as any).code);
        }
        if ('stderr' in error) {
          console.error('Stderr:', (error as any).stderr);
        }
      }
      
      throw new GenerationError(
        `Claude CLI fallback failed: ${error instanceof Error ? error.message : 'Unknown error'}. Check your Claude Code authentication.`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async callClaudeWithFallback(changes: Change[], version?: string): Promise<string> {
    const simplifiedPrompt = `Generate simple release notes for ${version || 'next version'}.

Changes: ${JSON.stringify(changes.slice(0, 10), null, 2)}

Return JSON format:
{
  "releaseTitle": "${version || 'Next Release'}",
  "sections": [{"id": "changes", "title": "Changes", "items": []}],
  "developerNotes": [],
  "summary": "This release includes various improvements and fixes."
}`;

    return this.callClaude(simplifiedPrompt);
  }

  private parseClaudeResponse(response: string): ReleaseData {
    try {
      console.log('🔍 Parsing Claude response...');
      
      // Check if it's JSON format first
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          releaseTitle: parsed.releaseTitle || 'Release Notes',
          sections: parsed.sections || [],
          developerNotes: parsed.developerNotes || [],
          summary: parsed.summary || 'This release includes various improvements.',
          suspectPii: parsed.suspectPii || false,
          suspectJargon: parsed.suspectJargon || false,
        };
      }
      
      // Parse markdown format instead
      console.log('📝 Parsing as markdown format...');
      return this.parseMarkdownResponse(response);
      
    } catch (error) {
      console.log('⚠️ Failed to parse Claude response, using fallback');
      throw new GenerationError(
        `Failed to parse Claude response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private parseMarkdownResponse(response: string): ReleaseData {
    const lines = response.split('\n');
    const sections: ReleaseSection[] = [];
    let currentSection: ReleaseSection | null = null;
    let summary = '';
    
    let releaseTitle = 'Release Notes';
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Extract release title
      if (trimmed.startsWith('## ') && !releaseTitle.includes('Summary')) {
        releaseTitle = trimmed.replace('## ', '');
      }
      
      // Extract section headers
      if (trimmed.startsWith('### ')) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          id: trimmed.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: trimmed.replace('### ', ''),
          items: [],
        };
      }
      
      // Extract items
      if (trimmed.startsWith('- ') && currentSection) {
        const itemText = trimmed.replace('- ', '');
        currentSection.items.push({
          id: `item-${currentSection.items.length}`,
          short: itemText,
          pr: null,
          why: null,
        });
      }
      
      // Extract summary
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && currentSection?.title === 'Summary') {
        summary = trimmed;
      }
    }
    
    // Add the last section
    if (currentSection) {
      sections.push(currentSection);
    }
    
    // If no summary found, look for summary section content
    if (!summary) {
      const summarySection = sections.find(s => s.title.toLowerCase().includes('summary'));
      if (summarySection && summarySection.items.length > 0) {
        summary = summarySection.items[0]?.short || '';
        // Remove summary section from main sections since we extracted it
        const index = sections.indexOf(summarySection);
        if (index >= 0) {
          sections.splice(index, 1);
        }
      }
    }
    
    return {
      releaseTitle,
      sections,
      developerNotes: [],
      summary: summary || 'This release includes various improvements and fixes.',
      suspectPii: false,
      suspectJargon: false,
    };
  }

  private validateReleaseData(data: ReleaseData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data.releaseTitle) {
      errors.push('Missing release title');
    }
    
    if (!data.sections || data.sections.length === 0) {
      errors.push('No sections found');
    }
    
    if (!data.summary) {
      errors.push('Missing summary');
    }
    
    // Validate sections
    for (const section of data.sections || []) {
      if (!section.id || !section.title) {
        errors.push(`Invalid section: missing id or title`);
      }
      
      for (const item of section.items || []) {
        if (!item.id || !item.short) {
          errors.push(`Invalid item in section ${section.id}: missing id or short description`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private generateDeterministicReleaseNotes(changes: Change[], version?: string): ReleaseData {
    const sections: ReleaseSection[] = [];
    
    // Group changes by configured sections
    for (const sectionConfig of this.formatConfig.sections) {
      const sectionChanges = changes.filter(change => 
        this.matchesSection(change, sectionConfig.labels)
      );
      
      if (sectionChanges.length > 0) {
        const items: ReleaseItem[] = sectionChanges.map(change => ({
          id: change.id,
          short: `${change.title} (${change.id})`,
          pr: change.prUrl || null,
          why: null,
        }));
        
        sections.push({
          id: sectionConfig.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: sectionConfig.name,
          items,
        });
      }
    }
    
    // Handle unmatched changes
    const matchedIds = new Set(
      sections.flatMap(s => s.items.map(i => i.id))
    );
    const unmatchedChanges = changes.filter(c => !matchedIds.has(c.id));
    
    if (unmatchedChanges.length > 0) {
      sections.push({
        id: 'other',
        title: 'Other Changes',
        items: unmatchedChanges.map(change => ({
          id: change.id,
          short: `${change.title} (${change.id})`,
          pr: change.prUrl || null,
          why: null,
        })),
      });
    }
    
    const changeCount = changes.length;
    const sectionCount = sections.length;
    
    return {
      releaseTitle: version ? `${version} Release` : 'Release Notes',
      sections,
      developerNotes: [],
      summary: `This release includes ${changeCount} change${changeCount === 1 ? '' : 's'} across ${sectionCount} categor${sectionCount === 1 ? 'y' : 'ies'}.`,
      suspectPii: false,
      suspectJargon: false,
    };
  }

  private matchesSection(change: Change, sectionLabels: string[]): boolean {
    // Check by labels first
    if (change.labels) {
      for (const label of change.labels) {
        for (const sectionLabel of sectionLabels) {
          if (label.toLowerCase().includes(sectionLabel.toLowerCase())) {
            return true;
          }
        }
      }
    }
    
    // Fallback to type matching
    for (const sectionLabel of sectionLabels) {
      if (change.type === sectionLabel) {
        return true;
      }
    }
    
    return false;
  }
}