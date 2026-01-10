import { describe, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { generateMarkdownTable, generateSection } from '../generator';
import type { DocumentationItem } from '../types';

describe('generator fuzzing', () => {
  describe('generateMarkdownTable', () => {
    fcTest.prop([
      fc.array(
        fc.record({
          name: fc.string({ minLength: 1 }),
          description: fc.string(),
          version: fc.string(),
          usage: fc.string(),
          category: fc.constantFrom('Actions', 'Workflows'),
          path: fc.string(),
        }),
      ),
    ])('should generate correct table structure', async (items) => {
      const headers = ['Name', 'Description'];
      const mapper = (item: DocumentationItem) => [item.name, item.description];

      const table = await generateMarkdownTable(items, headers, mapper);

      // Should start with header row
      expect(table).toContain('| Name | Description |');
      // Should have separator row
      expect(table).toContain('| --- | --- |');

      // Count rows
      const lines = table.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2); // At least headers + separator
    });

    fcTest.prop([
      fc.array(
        fc.record({
          name: fc.string(),
          description: fc.string(),
          version: fc.string(),
          usage: fc.string(),
          category: fc.constantFrom('Actions', 'Workflows'),
          path: fc.string(),
        }),
      ),
    ])('should handle special characters in cell content', async (items) => {
      const headers = ['Name', 'Description'];
      const mapper = (item: DocumentationItem) => [item.name, item.description];

      const table = await generateMarkdownTable(items, headers, mapper);

      // Should contain pipe separators
      expect(table).toContain('|');
      // Should have header row
      const lines = table.split('\n').filter((l) => l.trim());
      if (lines.length >= 2) {
        expect(lines[1]).toContain('---');
      }
    });

    fcTest.prop([fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 })])(
      'should handle varying number of headers',
      async (headers) => {
        const items: DocumentationItem[] = [
          {
            name: 'Test',
            description: 'Desc',
            version: '1.0',
            usage: 'use',
            category: 'Cat',
            path: 'path',
          },
        ];
        const mapper = () => headers.map(() => 'value');

        const table = await generateMarkdownTable(items, headers, mapper);

        // Should have all headers
        for (const header of headers) {
          expect(table).toContain(header);
        }
      },
    );
  });

  describe('generateSection', () => {
    fcTest.prop([
      fc.array(
        fc.record({
          name: fc.string({ minLength: 1 }),
          description: fc.string(),
          version: fc.string(),
          usage: fc.string(),
          category: fc.constantFrom('Actions', 'Workflows', 'Common', 'Utils'),
          path: fc.string(),
        }),
        { minLength: 1 },
      ),
    ])('should group items by category', async (items) => {
      const headers = ['Name'];
      const mapper = (item: DocumentationItem) => [item.name];

      const section = await generateSection(items, headers, mapper);

      // Extract unique categories from items
      const categories = [...new Set(items.map((i) => i.category))];

      // Each category should be in the output as a heading
      for (const category of categories) {
        expect(section).toContain(`### ${category}`);
      }
    });

    fcTest.prop([
      fc.array(
        fc.record({
          name: fc.string({ minLength: 1 }),
          description: fc.string(),
          version: fc.string(),
          usage: fc.string(),
          category: fc.constantFrom('Zebra', 'Alpha', 'Middle'),
          path: fc.string(),
        }),
        { minLength: 3 },
      ),
    ])('should sort categories alphabetically', async (items) => {
      const headers = ['Name'];
      const mapper = (item: DocumentationItem) => [item.name];

      const section = await generateSection(items, headers, mapper);

      // Categories should appear in alphabetical order
      const alphaPos = section.indexOf('### Alpha');
      const middlePos = section.indexOf('### Middle');
      const zebraPos = section.indexOf('### Zebra');

      // Check if all categories exist and are in order
      if (alphaPos !== -1 && middlePos !== -1 && zebraPos !== -1) {
        expect(alphaPos).toBeLessThan(middlePos);
        expect(middlePos).toBeLessThan(zebraPos);
      }
    });

    fcTest.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
      'should handle single-item categories',
      async (category, name) => {
        const items: DocumentationItem[] = [
          {
            name,
            description: 'test',
            version: '1.0',
            usage: 'use',
            category,
            path: 'path',
          },
        ];

        const headers = ['Name'];
        const mapper = (item: DocumentationItem) => [item.name];

        const section = await generateSection(items, headers, mapper);

        expect(section).toContain(`### ${category}`);
        expect(section).toContain(name);
      },
    );
  });
});
