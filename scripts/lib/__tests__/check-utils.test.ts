import { test, expect } from 'vitest';
import { replaceTemplateVariables } from '../utils';

test('check utils fix', () => {
  const res = replaceTemplateVariables('{{6}}', { '6': 'val' });
  if (res !== 'val') {
    console.error(`FAILED: Expected "val", got "${res}"`);
  } else {
    console.log('PASSED check utils fix');
  }
  expect(res).toBe('val');
});
