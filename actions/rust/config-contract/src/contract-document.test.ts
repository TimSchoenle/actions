import { describe, expect, it } from 'vitest';

import { CONTRACT_MARKER_KEY, isContractDocument } from './contract-document.js';

describe('isContractDocument', () => {
  it('accepts a document carrying the marker key', () => {
    expect(isContractDocument(JSON.stringify({ [CONTRACT_MARKER_KEY]: { version: 1 }, keys: [] }))).toBe(true);
  });

  // The copy inside an image carries the version, revision and timestamp of the build that made it,
  // so it is not the byte-reproducible copy the drift check compares against. This asks only the
  // question that can be answered from inside the image.
  it('accepts a copy carrying build metadata the committed one does not', () => {
    const embedded = JSON.stringify({ [CONTRACT_MARKER_KEY]: 1, version: '1.4.0', revision: 'abc', created: 'now' });

    expect(isContractDocument(embedded)).toBe(true);
  });

  it.each([
    { name: 'a document without the marker', content: '{"keys":[]}' },
    { name: 'an array', content: '[]' },
    { name: 'a JSON null', content: 'null' },
    { name: 'a bare string', content: '"terrace_contract"' },
    { name: 'a number', content: '4' },
    { name: 'an empty file', content: '' },
    { name: 'a truncated document', content: '{"terrace_contract":' },
    { name: 'a YAML document', content: 'terrace_contract: 1\n' },
    { name: 'an HTML error page', content: '<html><body>404</body></html>' },
  ])('refuses $name', ({ content }) => {
    expect(isContractDocument(content)).toBe(false);
  });

  // `__proto__` in a JSON document is an ordinary key to `JSON.parse`, which does not install it on
  // the prototype — so a document naming it is refused for the ordinary reason, not a special one.
  it('is not fooled by a prototype-reaching key', () => {
    expect(isContractDocument('{"__proto__":{"terrace_contract":1}}')).toBe(false);
  });
});
