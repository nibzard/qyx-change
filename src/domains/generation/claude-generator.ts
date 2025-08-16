import { query } from '@anthropic-ai/claude-code';
import { 
  Change, 
  ReleaseData, 
  GenerationOptions, 
  FormatConfig,
  DeveloperNote,
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
    const systemPrompt = this.getSystemPrompt();
    const changesJson = JSON.stringify(changes, null, 2);
    const sectionsConfig = JSON.stringify(this.formatConfig.sections, null, 2);
    
    return `${systemPrompt}

## Task Instructions

Generate release notes for ${version || 'the next version'} based on the following changes.

### Configuration
Sections to organize changes into:
${sectionsConfig}

### Input Changes
${changesJson}

### Output Requirements

1. Provide a JSON object matching this exact schema:
\`\`\`json
{
  "releaseTitle": "string",
  "sections": [
    {
      "id": "string",
      "title": "string", 
      "items": [
        {
          "id": "string",
          "short": "string",
          "pr": "string|null",
          "why": "string|null"
        }
      ]
    }
  ],
  "developerNotes": [
    {
      "type": "breaking|migration|deprecation|info",
      "desc": "string",
      "migration": "string|null"
    }
  ],
  "summary": "string",
  "suspectPii": false,
  "suspectJargon": false
}
\`\`\`

2. After the JSON, provide a markdown version suitable for CHANGELOG.md

### Guidelines

- Group changes by the configured sections based on labels and types
- Write customer-facing bullets (1-2 sentences each)
- Keep technical jargon minimal but accurate
- Include PR links when available
- Flag any suspicious content with suspectPii or suspectJargon fields
- Provide a 2-3 sentence summary of the release

Begin with the JSON object:`;
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
    let result = '';
    
    try {
      for await (const message of query({
        prompt,
        options: {
          maxTurns: this.options.maxTurns || 1,
        },
      })) {
        if (message.type === 'result') {
          // Handle different result message formats
          if ('result' in message) {
            result = (message as any).result;
          } else if ('content' in message) {
            result = (message as any).content;
          } else {
            result = JSON.stringify(message);
          }
          break;
        }
      }
      
      if (!result) {
        throw new GenerationError('Claude produced no result');
      }
      
      return result;
    } catch (error) {
      throw new GenerationError(
        `Claude API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate and transform the parsed response
      return {
        releaseTitle: parsed.releaseTitle || 'Release Notes',
        sections: parsed.sections || [],
        developerNotes: parsed.developerNotes || [],
        summary: parsed.summary || 'This release includes various improvements.',
        suspectPii: parsed.suspectPii || false,
        suspectJargon: parsed.suspectJargon || false,
      };
    } catch (error) {
      throw new GenerationError(
        `Failed to parse Claude response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
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