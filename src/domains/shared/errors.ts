export class QyxChangeError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'QyxChangeError';
  }
}

export class CollectionError extends QyxChangeError {
  constructor(message: string, cause?: Error) {
    super(message, 'COLLECTION_ERROR', cause);
    this.name = 'CollectionError';
  }
}

export class NormalizationError extends QyxChangeError {
  constructor(message: string, cause?: Error) {
    super(message, 'NORMALIZATION_ERROR', cause);
    this.name = 'NormalizationError';
  }
}

export class GenerationError extends QyxChangeError {
  constructor(message: string, cause?: Error) {
    super(message, 'GENERATION_ERROR', cause);
    this.name = 'GenerationError';
  }
}

export class OutputError extends QyxChangeError {
  constructor(message: string, cause?: Error) {
    super(message, 'OUTPUT_ERROR', cause);
    this.name = 'OutputError';
  }
}

export class ConfigError extends QyxChangeError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigError';
  }
}