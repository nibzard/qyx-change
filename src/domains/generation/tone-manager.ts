import { promises as fs } from 'fs';
import { join } from 'path';
import { TonePreset } from '../shared/index.js';
import { GenerationError } from '../shared/errors.js';

export interface ToneData {
  name: string;
  personality: string;
  targetAudience: string;
  focus: string;
  guidelines: string[];
  exampleBullets: string[];
  exampleSummary: string;
}

export class ToneManager {
  private static readonly BUILTIN_TONES_DIR = join(process.cwd(), 'tones');
  private toneCache = new Map<string, ToneData>();

  async getToneData(preset: TonePreset, customToneFile?: string): Promise<ToneData> {
    if (preset === 'custom' && customToneFile) {
      return this.loadCustomTone(customToneFile);
    }
    
    return this.loadBuiltinTone(preset);
  }

  async loadBuiltinTone(preset: TonePreset): Promise<ToneData> {
    if (preset === 'custom') {
      throw new GenerationError('Custom tone preset requires a tone file path');
    }

    const cacheKey = `builtin-${preset}`;
    if (this.toneCache.has(cacheKey)) {
      return this.toneCache.get(cacheKey)!;
    }

    try {
      const toneFilePath = join(ToneManager.BUILTIN_TONES_DIR, `${preset}.md`);
      const toneContent = await fs.readFile(toneFilePath, 'utf-8');
      const toneData = this.parseToneFile(toneContent, preset);
      
      this.toneCache.set(cacheKey, toneData);
      return toneData;
    } catch (error) {
      // Fallback to default tone if file not found
      return this.getDefaultTone(preset);
    }
  }

  async loadCustomTone(filePath: string): Promise<ToneData> {
    const cacheKey = `custom-${filePath}`;
    if (this.toneCache.has(cacheKey)) {
      return this.toneCache.get(cacheKey)!;
    }

    try {
      const absolutePath = join(process.cwd(), filePath);
      const toneContent = await fs.readFile(absolutePath, 'utf-8');
      const toneData = this.parseToneFile(toneContent, 'custom');
      
      this.toneCache.set(cacheKey, toneData);
      return toneData;
    } catch (error) {
      throw new GenerationError(
        `Failed to load custom tone file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private parseToneFile(content: string, preset: TonePreset): ToneData {
    const lines = content.split('\n');
    let currentSection = '';
    const data: Partial<ToneData> = {
      name: preset,
      guidelines: [],
      exampleBullets: [],
    };

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('# Tone:')) {
        data.name = trimmed.replace('# Tone:', '').trim();
      } else if (trimmed.startsWith('**Personality:**')) {
        data.personality = trimmed.replace('**Personality:**', '').trim();
      } else if (trimmed.startsWith('**Target Audience:**')) {
        data.targetAudience = trimmed.replace('**Target Audience:**', '').trim();
      } else if (trimmed.startsWith('**Focus:**')) {
        data.focus = trimmed.replace('**Focus:**', '').trim();
      } else if (trimmed === '## Guidelines') {
        currentSection = 'guidelines';
      } else if (trimmed === '## Example Bullets') {
        currentSection = 'bullets';
      } else if (trimmed === '## Example Summary') {
        currentSection = 'summary';
      } else if (trimmed.startsWith('- ') && currentSection === 'guidelines') {
        data.guidelines!.push(trimmed.substring(2));
      } else if (trimmed.startsWith('- ') && currentSection === 'bullets') {
        data.exampleBullets!.push(trimmed.substring(2));
      } else if (currentSection === 'summary' && trimmed && !trimmed.startsWith('#')) {
        data.exampleSummary = trimmed;
      }
    }

    return {
      name: data.name || preset,
      personality: data.personality || 'Professional',
      targetAudience: data.targetAudience || 'Developers',
      focus: data.focus || 'Technical accuracy',
      guidelines: data.guidelines || [],
      exampleBullets: data.exampleBullets || [],
      exampleSummary: data.exampleSummary || 'This release includes various improvements.',
    };
  }

  private getDefaultTone(preset: TonePreset): ToneData {
    const defaults: Record<TonePreset, ToneData> = {
      concise: {
        name: 'Concise',
        personality: 'Direct, technical, no fluff',
        targetAudience: 'Experienced developers',
        focus: 'Facts and functionality',
        guidelines: [
          'Use precise technical language',
          'Keep descriptions brief',
          'Focus on what changed, not why',
          'Include technical details when relevant',
        ],
        exampleBullets: [
          'Fix memory leak in parser (#123)',
          'Add OAuth2 support (#124)',
          'Update deps to latest versions (#125)',
        ],
        exampleSummary: 'This release fixes 3 bugs, adds OAuth2 support, and updates dependencies.',
      },
      friendly: {
        name: 'Friendly',
        personality: 'Approachable, conversational, helpful',
        targetAudience: 'Mixed technical and non-technical users',
        focus: 'User impact and benefits',
        guidelines: [
          'Use welcoming, accessible language',
          'Explain the "why" behind changes',
          'Include context for user benefits',
          'Make technical concepts understandable',
        ],
        exampleBullets: [
          '🎉 Added OAuth2 login support - sign in with your favorite services! (#124)',
          '🐛 Fixed a pesky memory leak in WebSocket connections (#123)',
          '⚡ Made the app snappier with database optimizations (#127)',
        ],
        exampleSummary: 'We\'ve been busy making your experience smoother with bug fixes, new features, and performance improvements!',
      },
      formal: {
        name: 'Formal',
        personality: 'Professional, authoritative, enterprise-appropriate',
        targetAudience: 'Business stakeholders and enterprise users',
        focus: 'Stability, compliance, and business value',
        guidelines: [
          'Use professional, business-appropriate language',
          'Emphasize stability and security',
          'Focus on business impact',
          'Include compliance implications',
        ],
        exampleBullets: [
          'Implemented OAuth2 authentication framework to enhance security compliance (#124)',
          'Resolved memory management issue affecting system stability (#123)',
          'Enhanced database performance to improve operational efficiency (#127)',
        ],
        exampleSummary: 'This release strengthens system security, improves operational stability, and maintains compliance standards.',
      },
      detailed: {
        name: 'Detailed',
        personality: 'Comprehensive, educational, thorough',
        targetAudience: 'Technical users who want full context',
        focus: 'Complete understanding and implementation details',
        guidelines: [
          'Provide comprehensive explanations',
          'Include technical implementation details',
          'Explain implications and impacts',
          'Connect changes to broader architecture',
        ],
        exampleBullets: [
          'Implemented OAuth2 authentication support following RFC 6749 standards with proper token refresh handling (#124)',
          'Fixed critical memory leak in WebSocket handler affecting long-running applications with frequent reconnections (#123)',
        ],
        exampleSummary: 'This release addresses critical performance and security concerns while expanding authentication capabilities for enterprise usage.',
      },
      custom: {
        name: 'Custom',
        personality: 'User-defined',
        targetAudience: 'Configurable',
        focus: 'As specified in custom tone file',
        guidelines: [],
        exampleBullets: [],
        exampleSummary: 'Custom tone requires configuration.',
      },
    };

    return defaults[preset];
  }

  generateToneInstructions(toneData: ToneData): string {
    let instructions = `Tone: ${toneData.name}\n`;
    instructions += `Personality: ${toneData.personality}\n`;
    instructions += `Target Audience: ${toneData.targetAudience}\n`;
    instructions += `Focus: ${toneData.focus}\n\n`;

    if (toneData.guidelines.length > 0) {
      instructions += `Guidelines:\n`;
      for (const guideline of toneData.guidelines) {
        instructions += `- ${guideline}\n`;
      }
      instructions += '\n';
    }

    if (toneData.exampleBullets.length > 0) {
      instructions += `Example bullets:\n`;
      for (const bullet of toneData.exampleBullets) {
        instructions += `- ${bullet}\n`;
      }
      instructions += '\n';
    }

    if (toneData.exampleSummary) {
      instructions += `Example summary: ${toneData.exampleSummary}\n`;
    }

    return instructions;
  }

  async validateToneFile(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const toneData = this.parseToneFile(content, 'custom');
      
      const errors: string[] = [];
      
      if (!toneData.personality) {
        errors.push('Missing **Personality:** section');
      }
      
      if (!toneData.targetAudience) {
        errors.push('Missing **Target Audience:** section');
      }
      
      if (!toneData.focus) {
        errors.push('Missing **Focus:** section');
      }
      
      if (toneData.guidelines.length === 0) {
        errors.push('Missing ## Guidelines section with bullet points');
      }
      
      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to read tone file: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  clearCache(): void {
    this.toneCache.clear();
  }
}