import { describe, it, expect } from 'vitest';
import { Normalizer } from '../src/domains/normalization/normalizer.js';
import { DEFAULT_CONFIG } from '../src/domains/shared/config.js';
import { Change } from '../src/domains/shared/types.js';

describe('Normalizer', () => {
  it('should normalize changes correctly', () => {
    const normalizer = new Normalizer(DEFAULT_CONFIG.format);
    
    const changes: Change[] = [
      {
        id: 'commit1',
        type: 'feat',
        title: 'Add new feature',
        body: 'This adds a new feature',
        labels: ['feature'],
      },
      {
        id: 'commit2', 
        type: 'fix',
        title: 'Fix bug',
        body: 'This fixes a bug',
        labels: ['bug'],
      },
    ];

    const result = normalizer.normalize(changes);
    
    expect(result.changes).toHaveLength(2);
    expect(result.sections).toBeDefined();
    expect(Object.keys(result.sections)).toContain('🚀 Features');
    expect(Object.keys(result.sections)).toContain('🛠 Fixes');
  });
});