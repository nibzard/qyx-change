import { Change, ChangeType, FormatConfig } from '../shared/index.js';
import { NormalizationError } from '../shared/errors.js';

export interface NormalizedData {
  changes: Change[];
  sections: Record<string, Change[]>;
  unmatched: Change[];
}

export class Normalizer {
  constructor(private config: FormatConfig) {}

  normalize(changes: Change[]): NormalizedData {
    try {
      // Remove duplicates and enrich data
      const deduplicatedChanges = this.removeDuplicates(changes);
      const enrichedChanges = this.enrichChanges(deduplicatedChanges);
      
      // Categorize into sections
      const sections = this.categorizeChanges(enrichedChanges);
      const unmatched = this.findUnmatchedChanges(enrichedChanges, sections);
      
      return {
        changes: enrichedChanges,
        sections,
        unmatched,
      };
    } catch (error) {
      throw new NormalizationError(
        `Failed to normalize changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private removeDuplicates(changes: Change[]): Change[] {
    const changeMap = new Map<string, Change>();
    
    for (const change of changes) {
      const key = this.getChangeKey(change);
      const existing = changeMap.get(key);
      
      if (!existing) {
        changeMap.set(key, change);
      } else {
        // Merge changes, preferring PR data over commit data
        const merged = this.mergeChanges(existing, change);
        changeMap.set(key, merged);
      }
    }
    
    return Array.from(changeMap.values());
  }

  private getChangeKey(change: Change): string {
    // If we have a PR number, use that as the primary key
    if (change.prNumber) {
      return `pr-${change.prNumber}`;
    }
    
    // Otherwise use the commit SHA or change ID
    return change.commitSha || change.id;
  }

  private mergeChanges(existing: Change, incoming: Change): Change {
    // Prefer PR data over commit data
    const preferPR = existing.prNumber || incoming.prNumber;
    
    return {
      ...existing,
      ...incoming,
      // Merge arrays
      labels: this.mergeArrays(existing.labels, incoming.labels),
      linkedIssues: this.mergeArrays(existing.linkedIssues, incoming.linkedIssues),
      // Prefer non-empty values
      title: incoming.title || existing.title,
      body: incoming.body || existing.body,
      author: incoming.author || existing.author,
      // Keep the most complete data
      prNumber: incoming.prNumber || existing.prNumber,
      prUrl: incoming.prUrl || existing.prUrl,
      commitSha: incoming.commitSha || existing.commitSha,
      filesChangedCount: incoming.filesChangedCount || existing.filesChangedCount,
    };
  }

  private mergeArrays<T>(arr1?: T[], arr2?: T[]): T[] | undefined {
    if (!arr1 && !arr2) return undefined;
    if (!arr1) return arr2;
    if (!arr2) return arr1;
    
    return [...new Set([...arr1, ...arr2])];
  }

  private enrichChanges(changes: Change[]): Change[] {
    return changes.map(change => ({
      ...change,
      type: this.refineChangeType(change),
      scope: this.extractScope(change),
      title: this.cleanTitle(change.title),
      body: this.truncateBody(change.body),
    }));
  }

  private refineChangeType(change: Change): ChangeType {
    // Use label-based type detection if available
    if (change.labels && change.labels.length > 0) {
      for (const section of this.config.sections) {
        const matchingLabels = section.labels.filter(label => 
          change.labels?.some(changeLabel => 
            changeLabel.toLowerCase().includes(label.toLowerCase())
          )
        );
        
        if (matchingLabels.length > 0) {
          return this.sectionToChangeType(section.name);
        }
      }
    }
    
    // Fall back to existing type
    return change.type;
  }

  private sectionToChangeType(sectionName: string): ChangeType {
    const name = sectionName.toLowerCase();
    if (name.includes('feature') || name.includes('🚀')) return 'feat';
    if (name.includes('fix') || name.includes('🛠')) return 'fix';
    if (name.includes('performance') || name.includes('⚡')) return 'perf';
    if (name.includes('security') || name.includes('🔒')) return 'security';
    if (name.includes('doc') || name.includes('📚')) return 'docs';
    if (name.includes('chore') || name.includes('📦')) return 'chore';
    return 'other';
  }

  private extractScope(change: Change): string | undefined {
    // Try to extract scope from conventional commit format in title
    const conventionalMatch = change.title.match(/^(\w+)(?:\(([^)]+)\))?:/);
    if (conventionalMatch && conventionalMatch[2]) {
      return conventionalMatch[2];
    }
    
    // Try to infer scope from file changes or labels
    if (change.labels && change.labels.length > 0) {
      const scopeLabels = change.labels.filter(label => 
        label.includes('area:') || label.includes('scope:')
      );
      if (scopeLabels.length > 0) {
        const scopeLabel = scopeLabels[0];
        if (scopeLabel) {
          return scopeLabel.split(':')[1]?.trim();
        }
      }
    }
    
    return change.scope;
  }

  private cleanTitle(title: string): string {
    // Remove conventional commit prefix if present
    const cleaned = title.replace(/^(\w+)(?:\([^)]+\))?:\s*/, '');
    
    // Capitalize first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private truncateBody(body?: string): string | undefined {
    if (!body) return undefined;
    
    // Remove git trailers (Signed-off-by, Co-authored-by, etc.)
    const withoutTrailers = body.replace(/^[\w-]+:\s+.*$/gm, '').trim();
    
    if (withoutTrailers.length <= 300) {
      return withoutTrailers;
    }
    
    return withoutTrailers.substring(0, 297) + '...';
  }

  private categorizeChanges(changes: Change[]): Record<string, Change[]> {
    const sections: Record<string, Change[]> = {};
    
    // Initialize sections
    for (const section of this.config.sections) {
      sections[section.name] = [];
    }
    
    for (const change of changes) {
      let categorized = false;
      
      // Try to match by labels first
      if (change.labels && change.labels.length > 0) {
        for (const section of this.config.sections) {
          const hasMatchingLabel = section.labels.some(sectionLabel =>
            change.labels?.some(changeLabel =>
              changeLabel && changeLabel.toLowerCase().includes(sectionLabel.toLowerCase())
            )
          );
          
          if (hasMatchingLabel) {
            sections[section.name]?.push(change);
            categorized = true;
            break;
          }
        }
      }
      
      // Fall back to type-based categorization
      if (!categorized) {
        for (const section of this.config.sections) {
          const sectionType = this.sectionToChangeType(section.name);
          if (change.type === sectionType) {
            sections[section.name]?.push(change);
            categorized = true;
            break;
          }
        }
      }
    }
    
    // Apply max items limit
    if (this.config.maxItemsPerSection) {
      for (const sectionName in sections) {
        const sectionChanges = sections[sectionName];
        if (sectionChanges && sectionChanges.length > this.config.maxItemsPerSection) {
          sections[sectionName] = sectionChanges.slice(0, this.config.maxItemsPerSection);
        }
      }
    }
    
    return sections;
  }

  private findUnmatchedChanges(changes: Change[], sections: Record<string, Change[]>): Change[] {
    const categorizedIds = new Set<string>();
    
    for (const sectionChanges of Object.values(sections)) {
      for (const change of sectionChanges) {
        categorizedIds.add(change.id);
      }
    }
    
    return changes.filter(change => !categorizedIds.has(change.id));
  }

  getSectionSummary(sections: Record<string, Change[]>): Record<string, number> {
    const summary: Record<string, number> = {};
    
    for (const [sectionName, changes] of Object.entries(sections)) {
      summary[sectionName] = changes.length;
    }
    
    return summary;
  }

  validateNormalizedData(data: NormalizedData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for empty sections if no changes were found
    if (data.changes.length === 0) {
      errors.push('No changes found to normalize');
    }
    
    // Check for excessive unmatched changes
    const unmatchedRatio = data.unmatched.length / data.changes.length;
    if (unmatchedRatio > 0.5) {
      errors.push(`High ratio of unmatched changes: ${Math.round(unmatchedRatio * 100)}%`);
    }
    
    // Validate change data integrity
    for (const change of data.changes) {
      if (!change.id || !change.title) {
        errors.push(`Invalid change data: missing id or title`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}