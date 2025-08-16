import { QyxChangeConfig, AuthMode, TonePreset } from './index.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigValidator {
  static validate(config: QyxChangeConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate generator
    if (!config.generator) {
      errors.push('Generator is required');
    } else if (config.generator !== 'claude-code') {
      warnings.push(`Unknown generator: ${config.generator}. Expected 'claude-code'`);
    }

    // Validate auth configuration
    if (!config.auth) {
      errors.push('Auth configuration is required');
    } else {
      this.validateAuth(config.auth, errors, warnings);
    }

    // Validate format configuration
    if (!config.format) {
      errors.push('Format configuration is required');
    } else {
      this.validateFormat(config.format, errors, warnings);
    }

    // Validate generation configuration
    if (!config.generation) {
      errors.push('Generation configuration is required');
    } else {
      this.validateGeneration(config.generation, errors, warnings);
    }

    // Validate redaction configuration
    if (config.redaction) {
      this.validateRedaction(config.redaction, errors, warnings);
    }

    // Validate cache configuration
    if (config.cache) {
      this.validateCache(config.cache, errors, warnings);
    }

    // Validate actions configuration
    if (config.actions) {
      this.validateActions(config.actions, errors, warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private static validateAuth(auth: any, errors: string[], warnings: string[]): void {
    const validModes: AuthMode[] = ['auto', 'api-key', 'oauth'];
    
    if (!auth.mode) {
      errors.push('Auth mode is required');
    } else if (!validModes.includes(auth.mode)) {
      errors.push(`Invalid auth mode: ${auth.mode}. Must be one of: ${validModes.join(', ')}`);
    }

    if (auth.mode === 'api-key' && !auth.tokenEnvVar) {
      warnings.push('Token environment variable should be specified when using api-key mode');
    }
  }

  private static validateFormat(format: any, errors: string[], _warnings: string[]): void {
    if (!format.changelogPath) {
      errors.push('Changelog path is required');
    } else if (typeof format.changelogPath !== 'string') {
      errors.push('Changelog path must be a string');
    }

    if (!format.sections || !Array.isArray(format.sections)) {
      errors.push('Format sections must be an array');
    } else {
      for (let i = 0; i < format.sections.length; i++) {
        const section = format.sections[i];
        if (!section.name || typeof section.name !== 'string') {
          errors.push(`Section ${i}: name is required and must be a string`);
        }
        if (!section.labels || !Array.isArray(section.labels)) {
          errors.push(`Section ${i}: labels must be an array`);
        }
      }
    }

    if (format.maxItemsPerSection !== undefined) {
      if (typeof format.maxItemsPerSection !== 'number' || format.maxItemsPerSection < 1) {
        errors.push('maxItemsPerSection must be a positive number');
      }
    }

    if (format.includePrLinks !== undefined && typeof format.includePrLinks !== 'boolean') {
      errors.push('includePrLinks must be a boolean');
    }
  }

  private static validateGeneration(generation: any, errors: string[], warnings: string[]): void {
    const validTones: TonePreset[] = ['concise', 'friendly', 'formal', 'detailed', 'custom'];
    
    if (!generation.tonePreset) {
      errors.push('Tone preset is required');
    } else if (!validTones.includes(generation.tonePreset)) {
      errors.push(`Invalid tone preset: ${generation.tonePreset}. Must be one of: ${validTones.join(', ')}`);
    }

    if (generation.tonePreset === 'custom' && !generation.toneFile) {
      errors.push('Tone file is required when using custom tone preset');
    }

    if (generation.locale && typeof generation.locale !== 'string') {
      errors.push('Locale must be a string');
    }

    if (generation.includeDeveloperNotes !== undefined && typeof generation.includeDeveloperNotes !== 'boolean') {
      errors.push('includeDeveloperNotes must be a boolean');
    }

    if (generation.sendDiffSnippets !== undefined && typeof generation.sendDiffSnippets !== 'boolean') {
      errors.push('sendDiffSnippets must be a boolean');
    }

    // Security warning for diff snippets
    if (generation.sendDiffSnippets === true) {
      warnings.push('Sending diff snippets may expose sensitive code. Ensure redaction patterns are configured properly.');
    }
  }

  private static validateRedaction(redaction: any, errors: string[], warnings: string[]): void {
    if (redaction.redactPatterns && !Array.isArray(redaction.redactPatterns)) {
      errors.push('Redaction patterns must be an array');
    }

    if (redaction.emailMask !== undefined && typeof redaction.emailMask !== 'boolean') {
      errors.push('emailMask must be a boolean');
    }

    if (redaction.truncBodyTo !== undefined) {
      if (typeof redaction.truncBodyTo !== 'number' || redaction.truncBodyTo < 0) {
        errors.push('truncBodyTo must be a non-negative number');
      }
    }

    // Check for common redaction patterns
    const patterns = redaction.redactPatterns || [];
    const recommendedPatterns = ['api_?key', 'secret', 'password', 'token'];
    const missingPatterns = recommendedPatterns.filter(pattern => 
      !patterns.some((p: string) => p.toLowerCase().includes(pattern.toLowerCase()))
    );
    
    if (missingPatterns.length > 0) {
      warnings.push(`Consider adding these common redaction patterns: ${missingPatterns.join(', ')}`);
    }
  }

  private static validateCache(cache: any, errors: string[], warnings: string[]): void {
    if (cache.enabled !== undefined && typeof cache.enabled !== 'boolean') {
      errors.push('Cache enabled must be a boolean');
    }

    if (cache.ttlSeconds !== undefined) {
      if (typeof cache.ttlSeconds !== 'number' || cache.ttlSeconds < 0) {
        errors.push('Cache TTL must be a non-negative number');
      } else if (cache.ttlSeconds < 3600) {
        warnings.push('Cache TTL is less than 1 hour. Consider increasing for better performance.');
      }
    }
  }

  private static validateActions(actions: any, errors: string[], warnings: string[]): void {
    if (actions.enabled !== undefined && typeof actions.enabled !== 'boolean') {
      errors.push('Actions enabled must be a boolean');
    }

    if (actions.modules && !Array.isArray(actions.modules)) {
      errors.push('Action modules must be an array');
    } else if (actions.modules) {
      for (let i = 0; i < actions.modules.length; i++) {
        const module = actions.modules[i];
        if (!module.name || typeof module.name !== 'string') {
          errors.push(`Action module ${i}: name is required and must be a string`);
        }
        if (module.enabled !== undefined && typeof module.enabled !== 'boolean') {
          errors.push(`Action module ${i}: enabled must be a boolean`);
        }
        if (!module.config || typeof module.config !== 'object') {
          errors.push(`Action module ${i}: config is required and must be an object`);
        }
      }
    }

    if (actions.enabled && (!actions.modules || actions.modules.length === 0)) {
      warnings.push('Actions are enabled but no modules are configured');
    }
  }

  static validateEnvironment(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for authentication
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasClaudeToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    
    if (!hasAnthropicKey && !hasClaudeToken) {
      errors.push('No authentication found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
    }

    // Check for GitHub integration
    const hasGitHubToken = !!process.env.GITHUB_TOKEN;
    const hasGitHubRepo = !!process.env.GITHUB_REPOSITORY;
    
    if (!hasGitHubToken) {
      warnings.push('GITHUB_TOKEN not set. GitHub integration will be limited.');
    }
    
    if (!hasGitHubRepo) {
      warnings.push('GITHUB_REPOSITORY not set. Automatic repository detection may fail.');
    }

    // Check git repository
    try {
      const fs = require('fs');
      if (!fs.existsSync('.git')) {
        warnings.push('Not in a git repository. Git-based collection may fail.');
      }
    } catch {
      // Ignore file system errors
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}