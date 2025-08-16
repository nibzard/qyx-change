import { promises as fs } from 'fs';
import { ReleaseData, FormatConfig } from '../shared/index.js';
import { OutputError } from '../shared/errors.js';

export interface ChangelogWriteResult {
  changelogPath: string;
  content: string;
  wasUpdated: boolean;
  previousContent?: string;
}

export class ChangelogWriter {
  constructor(private config: FormatConfig) {}

  async writeChangelog(
    releaseData: ReleaseData,
    version?: string,
    targetPath?: string
  ): Promise<ChangelogWriteResult> {
    const changelogPath = targetPath || this.config.changelogPath;
    
    try {
      // Read existing changelog if it exists
      let existingContent = '';
      let fileExists = false;
      
      try {
        existingContent = await fs.readFile(changelogPath, 'utf-8');
        fileExists = true;
      } catch {
        // File doesn't exist, start fresh
        fileExists = false;
      }

      // Generate new changelog content
      const newReleaseContent = this.generateReleaseSection(releaseData, version);
      
      // Update or create changelog
      let updatedContent: string;
      if (fileExists && existingContent.trim()) {
        updatedContent = this.updateExistingChangelog(existingContent, newReleaseContent, version);
      } else {
        updatedContent = this.createNewChangelog(newReleaseContent);
      }

      // Write the updated content
      await fs.writeFile(changelogPath, updatedContent, 'utf-8');

      return {
        changelogPath,
        content: updatedContent,
        wasUpdated: fileExists,
        previousContent: fileExists ? existingContent : undefined,
      };
    } catch (error) {
      throw new OutputError(
        `Failed to write changelog: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private generateReleaseSection(releaseData: ReleaseData, version?: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const title = version ? `${version} — ${date}` : releaseData.releaseTitle;
    
    let content = `## ${title}\n\n`;

    // Add sections
    for (const section of releaseData.sections) {
      if (section.items.length === 0) continue;

      content += `### ${section.title}\n\n`;
      
      for (const item of section.items) {
        let bullet = `- ${item.short}`;
        
        // Add PR link if available and configured
        if (item.pr && this.config.includePrLinks) {
          // Check if PR link is already in the short description
          if (!item.short.includes(item.pr) && !item.short.includes('#')) {
            const prNumber = this.extractPRNumber(item.pr);
            if (prNumber) {
              bullet += ` (${prNumber})`;
            }
          }
        }
        
        // Add "why" explanation if available
        if (item.why) {
          bullet += ` - ${item.why}`;
        }
        
        content += `${bullet}\n`;
      }
      
      content += '\n';
    }

    // Add developer notes if present
    if (releaseData.developerNotes.length > 0) {
      content += '### Developer Notes\n\n';
      
      for (const note of releaseData.developerNotes) {
        let noteText = '';
        
        switch (note.type) {
          case 'breaking':
            noteText += '⚠️ **BREAKING**: ';
            break;
          case 'migration':
            noteText += '📝 **Migration**: ';
            break;
          case 'deprecation':
            noteText += '🗑️ **Deprecated**: ';
            break;
          default:
            noteText += '💡 **Note**: ';
        }
        
        noteText += note.desc;
        
        if (note.migration) {
          noteText += `\n  - Migration: ${note.migration}`;
        }
        
        content += `- ${noteText}\n`;
      }
      
      content += '\n';
    }

    // Add summary
    if (releaseData.summary) {
      content += `**Summary:** ${releaseData.summary}\n\n`;
    }

    return content;
  }

  private updateExistingChangelog(
    existingContent: string,
    newReleaseContent: string,
    version?: string
  ): string {
    const lines = existingContent.split('\n');
    const headerEndIndex = this.findHeaderEndIndex(lines);
    
    // Check if this version already exists
    if (version) {
      const existingVersionIndex = this.findExistingVersion(lines, version);
      if (existingVersionIndex !== -1) {
        // Replace existing version
        return this.replaceExistingVersion(lines, newReleaseContent, existingVersionIndex);
      }
    }

    // Insert new release at the top of releases
    const insertIndex = headerEndIndex + 1;
    const header = lines.slice(0, insertIndex).join('\n');
    const rest = lines.slice(insertIndex).join('\n');
    
    return `${header}\n${newReleaseContent}${rest}`;
  }

  private createNewChangelog(newReleaseContent: string): string {
    return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${newReleaseContent}`;
  }

  private findHeaderEndIndex(lines: string[]): number {
    // Look for the first ## heading (first release)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.startsWith('## ')) {
        return i - 1;
      }
    }
    
    // If no releases found, look for end of header content
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (line === '' && i > 5) { // Allow for title and description
        return i;
      }
    }
    
    return lines.length - 1;
  }

  private findExistingVersion(lines: string[], version: string): number {
    const versionPattern = new RegExp(`^## .*${this.escapeRegex(version)}`, 'i');
    
    for (let i = 0; i < lines.length; i++) {
      if (versionPattern.test(lines[i] || '')) {
        return i;
      }
    }
    
    return -1;
  }

  private replaceExistingVersion(
    lines: string[],
    newContent: string,
    versionIndex: number
  ): string {
    // Find the end of this version section (next ## or end of file)
    let endIndex = lines.length;
    for (let i = versionIndex + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith('## ')) {
        endIndex = i;
        break;
      }
    }

    // Replace the version section
    const before = lines.slice(0, versionIndex);
    const after = lines.slice(endIndex);
    const newLines = newContent.trim().split('\n');
    
    return [...before, ...newLines, '', ...after].join('\n');
  }

  private extractPRNumber(prUrl: string): string | null {
    const match = prUrl.match(/\/pull\/(\d+)/);
    return match ? `#${match[1]}` : null;
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async previewChangelog(releaseData: ReleaseData, version?: string): Promise<string> {
    return this.generateReleaseSection(releaseData, version);
  }

  async validateChangelogFormat(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const errors: string[] = [];

      // Check for title
      if (!lines[0]?.startsWith('# ')) {
        errors.push('Missing main title (should start with # )');
      }

      // Check for proper release format
      let hasReleases = false;
      for (const line of lines) {
        if (line.startsWith('## ')) {
          hasReleases = true;
          break;
        }
      }

      if (!hasReleases) {
        errors.push('No release sections found (should have ## headings)');
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to read changelog: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async backupChangelog(filePath?: string): Promise<string> {
    const changelogPath = filePath || this.config.changelogPath;
    const backupPath = `${changelogPath}.backup.${Date.now()}`;
    
    try {
      const content = await fs.readFile(changelogPath, 'utf-8');
      await fs.writeFile(backupPath, content, 'utf-8');
      return backupPath;
    } catch (error) {
      throw new OutputError(
        `Failed to backup changelog: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}