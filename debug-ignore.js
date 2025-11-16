import { createIgnoreInstance } from './src/utils/parsing/ignorePatterns.js';
import { requestContextService } from './src/utils/index.js';

const context = requestContextService.createRequestContext({ operation: 'test' });

createIgnoreInstance({
  projectPath: '.',
  temporaryIgnore: [],
  context
}).then(ig => {
  const testFiles = [
    'tests/unit/utils/contextBuilder.test.ts',
    'src/index.ts',
    'README.md'
  ];
  
  console.log('Ignore patterns test:');
  testFiles.forEach(file => {
    console.log(`${file}: ignored = ${ig.ignores(file)}`);
  });
}).catch(console.error);