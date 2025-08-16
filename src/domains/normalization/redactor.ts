import { Change, RedactionConfig } from '../shared/index.js';
import { NormalizationError } from '../shared/errors.js';

export interface RedactionResult {
  redactedChanges: Change[];
  redactionReport: {
    totalChanges: number;
    redactedCount: number;
    redactedFields: string[];
    suspiciousPatterns: string[];
  };
}

export class Redactor {
  private redactionPatterns: RegExp[];
  private emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  private hashPattern = /\b[a-f0-9]{32,}\b/gi;
  private phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
  private ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

  constructor(private config: RedactionConfig) {
    this.redactionPatterns = config.redactPatterns.map(pattern => new RegExp(pattern, 'gi'));
  }

  redactChanges(changes: Change[]): RedactionResult {
    try {
      const redactedChanges: Change[] = [];
      const redactedFields = new Set<string>();
      const suspiciousPatterns = new Set<string>();
      let redactedCount = 0;

      for (const change of changes) {
        const { redactedChange, wasRedacted, redactedFieldsInChange, patterns } = this.redactChange(change);
        
        redactedChanges.push(redactedChange);
        
        if (wasRedacted) {
          redactedCount++;
          redactedFieldsInChange.forEach(field => redactedFields.add(field));
          patterns.forEach(pattern => suspiciousPatterns.add(pattern));
        }
      }

      return {
        redactedChanges,
        redactionReport: {
          totalChanges: changes.length,
          redactedCount,
          redactedFields: Array.from(redactedFields),
          suspiciousPatterns: Array.from(suspiciousPatterns),
        },
      };
    } catch (error) {
      throw new NormalizationError(
        `Failed to redact changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private redactChange(change: Change): {
    redactedChange: Change;
    wasRedacted: boolean;
    redactedFieldsInChange: string[];
    patterns: string[];
  } {
    const redactedFieldsInChange: string[] = [];
    const patterns: string[] = [];
    let wasRedacted = false;

    const redactedChange: Change = { ...change };

    // Redact title
    const titleResult = this.redactText(change.title, 'title');
    if (titleResult.wasRedacted) {
      redactedChange.title = titleResult.redactedText;
      redactedFieldsInChange.push('title');
      patterns.push(...titleResult.patterns);
      wasRedacted = true;
    }

    // Redact body
    if (change.body) {
      const bodyResult = this.redactText(change.body, 'body');
      if (bodyResult.wasRedacted) {
        redactedChange.body = bodyResult.redactedText;
        redactedFieldsInChange.push('body');
        patterns.push(...bodyResult.patterns);
        wasRedacted = true;
      }

      // Truncate body if configured
      if (redactedChange.body && redactedChange.body.length > this.config.truncBodyTo) {
        redactedChange.body = redactedChange.body.substring(0, this.config.truncBodyTo - 3) + '...';
        redactedFieldsInChange.push('body (truncated)');
        wasRedacted = true;
      }
    }

    // Redact author email if present
    if (change.author && this.config.emailMask) {
      const authorResult = this.redactText(change.author, 'author');
      if (authorResult.wasRedacted) {
        redactedChange.author = authorResult.redactedText;
        redactedFieldsInChange.push('author');
        patterns.push(...authorResult.patterns);
        wasRedacted = true;
      }
    }

    // Redact labels that might contain sensitive info
    if (change.labels) {
      const redactedLabels: string[] = [];
      let labelsRedacted = false;

      for (const label of change.labels) {
        const labelResult = this.redactText(label, 'label');
        redactedLabels.push(labelResult.redactedText);
        if (labelResult.wasRedacted) {
          labelsRedacted = true;
          patterns.push(...labelResult.patterns);
        }
      }

      if (labelsRedacted) {
        redactedChange.labels = redactedLabels;
        redactedFieldsInChange.push('labels');
        wasRedacted = true;
      }
    }

    return {
      redactedChange,
      wasRedacted,
      redactedFieldsInChange,
      patterns,
    };
  }

  private redactText(text: string, _field: string): {
    redactedText: string;
    wasRedacted: boolean;
    patterns: string[];
  } {
    let redactedText = text;
    let wasRedacted = false;
    const patterns: string[] = [];

    // Apply configured redaction patterns
    for (const pattern of this.redactionPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        redactedText = redactedText.replace(pattern, '[REDACTED]');
        wasRedacted = true;
        patterns.push(pattern.source);
      }
    }

    // Apply email redaction
    if (this.config.emailMask && this.emailPattern.test(text)) {
      redactedText = redactedText.replace(this.emailPattern, '[REDACTED-EMAIL]');
      wasRedacted = true;
      patterns.push('email');
    }

    // Apply hash redaction (likely to be sensitive)
    if (this.hashPattern.test(text)) {
      redactedText = redactedText.replace(this.hashPattern, '[REDACTED-HASH]');
      wasRedacted = true;
      patterns.push('hash');
    }

    // Apply phone number redaction
    if (this.phonePattern.test(text)) {
      redactedText = redactedText.replace(this.phonePattern, '[REDACTED-PHONE]');
      wasRedacted = true;
      patterns.push('phone');
    }

    // Apply IP address redaction
    if (this.ipPattern.test(text)) {
      redactedText = redactedText.replace(this.ipPattern, '[REDACTED-IP]');
      wasRedacted = true;
      patterns.push('ip');
    }

    return {
      redactedText,
      wasRedacted,
      patterns,
    };
  }

  detectSensitiveContent(changes: Change[]): {
    suspiciousChanges: Array<{
      change: Change;
      reasons: string[];
    }>;
    overallRisk: 'low' | 'medium' | 'high';
  } {
    const suspiciousChanges: Array<{ change: Change; reasons: string[] }> = [];

    for (const change of changes) {
      const reasons = this.analyzeSensitiveContent(change);
      if (reasons.length > 0) {
        suspiciousChanges.push({ change, reasons });
      }
    }

    const overallRisk = this.calculateRiskLevel(suspiciousChanges, changes.length);

    return {
      suspiciousChanges,
      overallRisk,
    };
  }

  private analyzeSensitiveContent(change: Change): string[] {
    const reasons: string[] = [];
    const allText = [change.title, change.body, change.author, ...(change.labels || [])].join(' ');

    // Check for potential secrets
    for (const pattern of this.redactionPatterns) {
      if (pattern.test(allText)) {
        reasons.push(`Potential secret detected: ${pattern.source}`);
      }
    }

    // Check for PII
    if (this.emailPattern.test(allText)) {
      reasons.push('Email addresses detected');
    }

    if (this.phonePattern.test(allText)) {
      reasons.push('Phone numbers detected');
    }

    if (this.ipPattern.test(allText)) {
      reasons.push('IP addresses detected');
    }

    // Check for long hex strings (potential tokens/hashes)
    if (this.hashPattern.test(allText)) {
      reasons.push('Long hex strings detected (potential tokens)');
    }

    // Check for common secret keywords
    const secretKeywords = ['password', 'token', 'key', 'secret', 'credential', 'auth'];
    for (const keyword of secretKeywords) {
      if (allText.toLowerCase().includes(keyword)) {
        reasons.push(`Potentially sensitive keyword: ${keyword}`);
      }
    }

    return reasons;
  }

  private calculateRiskLevel(suspiciousChanges: Array<{ change: Change; reasons: string[] }>, totalChanges: number): 'low' | 'medium' | 'high' {
    if (suspiciousChanges.length === 0) {
      return 'low';
    }

    const suspiciousRatio = suspiciousChanges.length / totalChanges;
    const avgReasonsPerChange = suspiciousChanges.reduce((sum, item) => sum + item.reasons.length, 0) / suspiciousChanges.length;

    if (suspiciousRatio > 0.5 || avgReasonsPerChange > 3) {
      return 'high';
    }

    if (suspiciousRatio > 0.2 || avgReasonsPerChange > 1.5) {
      return 'medium';
    }

    return 'low';
  }

  generateRedactionSummary(result: RedactionResult): string {
    const { redactionReport } = result;
    
    if (redactionReport.redactedCount === 0) {
      return 'No sensitive content detected. All changes are safe to process.';
    }

    const lines = [
      `Redaction Summary:`,
      `- ${redactionReport.redactedCount}/${redactionReport.totalChanges} changes required redaction`,
      `- Redacted fields: ${redactionReport.redactedFields.join(', ')}`,
    ];

    if (redactionReport.suspiciousPatterns.length > 0) {
      lines.push(`- Detected patterns: ${redactionReport.suspiciousPatterns.join(', ')}`);
    }

    return lines.join('\n');
  }
}