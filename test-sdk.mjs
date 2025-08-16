import { query } from '@anthropic-ai/claude-code';

try {
  console.log('Testing Claude Code SDK...');
  for await (const message of query({
    prompt: 'Say hello briefly'
  })) {
    console.log('Message type:', message.type);
    if (message.type === 'result') {
      console.log('Success! Result:', message.result);
      break;
    }
  }
} catch (error) {
  console.error('Error details:', error);
}
