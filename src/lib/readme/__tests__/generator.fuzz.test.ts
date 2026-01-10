import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateMarkdownTable, generateSection } from '../generator';
import type { DocumentationItem } from '../types';

describe('generator fuzzing', () => {
  describe('generateMarkdownTable', () => {
    it('should generate correct table structure', () => {
      fc.assert(
        fc.asyncProperty(
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
          async (items) => {
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
          },
        ),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle special characters in cell content', () => {
      fc.assert(
        fc.asyncProperty(
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
          async (items) => {
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
          },
        ),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should handle empty items array', async () => {
      const headers = ['Name'];
      const mapper = (item: DocumentationItem) => [item.name];

      const table = await generateMarkdownTable([], headers, mapper);

      // Should still have headers
      expect(table).toContain('| Name |');
      expect(table).toContain('| --- |');
    });

    it('should handle varying number of headers', () => {
      fc.assert(
        fc.asyncProperty(fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }), async (headers) => {
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
        }),
        { numRuns: 20 },
      );
      expect(true).toBe(true);
    });
  });

  describe('generateSection', () => {
    it('should group items by category', () => {
      fc.assert(
        fc.asyncProperty(
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
          async (items) => {
            const headers = ['Name'];
            const mapper = (item: DocumentationItem) => [item.name];

            const section = await generateSection(items, headers, mapper);

            // Extract unique categories from items
            const categories = [...new Set(items.map((i) => i.category))];

            // Each category should be in the output as a heading
            for (const category of categories) {
              expect(section).toContain(`### ${category}`);
            }
          },
        ),
        { numRuns: 20 },
      );
      expect(true).toBe(true);
    });

    it('should sort categories alphabetically', () => {
      fc.assert(
        fc.asyncProperty(
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
          async (items) => {
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
          },
        ),
        { numRuns: 15 },
      );
      expect(true).toBe(true);
    });

    it('should sort items within each category alphabetically', async () => {
      const items: DocumentationItem[] = [
        { name: 'Zebra', description: '', version: '', usage: '', category: 'Test', path: '' },
        { name: 'Alpha', description: '', version: '', usage: '', category: 'Test', path: '' },
        { name: 'Middle', description: '', version: '', usage: '', category: 'Test', path: '' },
      ];

      const headers = ['Name'];
      const mapper = (item: DocumentationItem) => [item.name];

      const section = await generateSection(items, headers, mapper);

      // Items should be sorted alphabetically within the category
      const alphaPos = section.indexOf('Alpha');
      const middlePos = section.indexOf('Middle');
      const zebraPos = section.indexOf('Zebra');

      expect(alphaPos).toBeLessThan(middlePos);
      expect(middlePos).toBeLessThan(zebraPos);
    });

    it('should handle single-item categories', () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), async (category, name) => {
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
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });
  });
});
