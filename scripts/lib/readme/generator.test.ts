import { describe, it, expect } from 'vitest';
import { generateMarkdownTable, generateSection } from './generator';
import type { DocumentationItem } from './types';

describe('Generator', () => {
  describe('generateMarkdownTable', () => {
    it('should generate a markdown table with headers and mapped rows', async () => {
      const items: DocumentationItem[] = [
        { name: 'Item1', description: 'Desc1', category: 'Cat1', path: 'path/1' },
        { name: 'Item2', description: 'Desc2', category: 'Cat1', path: 'path/2' },
      ];
      const headers = ['Name', 'Description'];
      const mapper = (item: DocumentationItem) => [item.name, item.description];

      const result = await generateMarkdownTable(items, headers, mapper);

      expect(result).toContain('| Name | Description |');
      expect(result).toContain('| --- | --- |');
      expect(result).toContain('| Item1 | Desc1 |');
      expect(result).toContain('| Item2 | Desc2 |');
    });
  });

  describe('generateSection', () => {
    it('should group by category and generate tables', async () => {
      const items: DocumentationItem[] = [
        { name: 'B_Apple', description: 'DescB', category: 'Fruit', path: 'path/b' },
        { name: 'A_Banana', description: 'DescA', category: 'Fruit', path: 'path/a' },
        { name: 'Carrot', description: 'DescC', category: 'Veggie', path: 'path/c' },
      ];
      const headers = ['Name'];
      const mapper = (item: DocumentationItem) => [item.name];

      const result = await generateSection(items, headers, mapper);

      // Check Categories (alphabetical order of category name)
      // Fruit comes before Veggie
      const fruitIndex = result.indexOf('### Fruit');
      const veggieIndex = result.indexOf('### Veggie');
      expect(fruitIndex).toBeGreaterThan(-1);
      expect(veggieIndex).toBeGreaterThan(fruitIndex);

      // Expect A_Banana before B_Apple
      const bananaIndex = result.indexOf('| A_Banana |');
      const appleIndex = result.indexOf('| B_Apple |');
      expect(bananaIndex).toBeGreaterThan(-1);
      expect(appleIndex).toBeGreaterThan(bananaIndex);
    });
  });
});
