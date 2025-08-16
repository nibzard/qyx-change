/**
 * Qyx Change - AI-Powered Release Notes Generator
 * 
 * Main entry point for programmatic usage
 */

export * from './domains/shared/index.js';
export * from './domains/collection/index.js';
export * from './domains/normalization/index.js';
export * from './domains/generation/index.js';
export * from './domains/output/index.js';

// Main orchestrator class for easy usage
export class QyxChange {
  // TODO: Implement main orchestrator class that combines all domains
  // This would provide a simple API like:
  // const qyx = new QyxChange(config);
  // const result = await qyx.generateChangelog(options);
}