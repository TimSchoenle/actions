import { describe, expect, it } from 'vitest';
import { sortDocumentationItems } from '../sort';

import type { DocumentationItem } from '../../types';

function item(name: string, itemPath: string): DocumentationItem {
  return { name, description: '', category: 'GitHub', path: itemPath };
}

describe('sortDocumentationItems', () => {
  it('should order by name', () => {
    const sorted = sortDocumentationItems([item('c', 'c.json'), item('a', 'a.json'), item('b', 'b.json')]);
    expect(sorted.map((i) => i.name)).toEqual(['a', 'b', 'c']);
  });

  it('should break name ties by path', () => {
    const sorted = sortDocumentationItems([item('same', 'z.json'), item('same', 'a.json')]);
    expect(sorted.map((i) => i.path)).toEqual(['a.json', 'z.json']);
  });

  it('should yield the same order regardless of input order', () => {
    const items = [item('b', 'b.json'), item('a', 'z.json'), item('a', 'a.json'), item('c', 'c.json')];
    const expected = sortDocumentationItems(items).map((i) => i.path);

    expect(sortDocumentationItems(items.toReversed()).map((i) => i.path)).toEqual(expected);
    expect(sortDocumentationItems([items[2], items[0], items[3], items[1]]).map((i) => i.path)).toEqual(expected);
  });

  it('should not mutate the input', () => {
    const items = [item('b', 'b.json'), item('a', 'a.json')];
    sortDocumentationItems(items);
    expect(items.map((i) => i.name)).toEqual(['b', 'a']);
  });
});
