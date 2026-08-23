import type { DocumentationItem } from './types.js';

export async function generateMarkdownTable(
  items: DocumentationItem[],
  headers: string[],
  rowMapper: (item: DocumentationItem) => string[],
): Promise<string> {
  let output = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const item of items) {
    const row = rowMapper(item);
    output += `| ${row.join(' | ')} |\n`;
  }
  return output;
}

/**
 * Renders one table per category, under a heading of the depth the caller asks for.
 *
 * `headingLevel` is the caller's because a category heading is never the top of its own section. In
 * README.md the catalogues sit under `## Usage` beneath a kind heading such as `### Actions`; in
 * SECURITY.md they sit under `## Supported Versions` beneath `### Actions` too. A hard-coded `###`
 * put every category at the same level as the heading that introduces it, so `Bun` read as a
 * sibling of `Actions` in the outline GitHub builds from the file rather than as one of its rows.
 */
export async function generateSection(
  items: DocumentationItem[],
  headers: string[],
  rowMapper: (item: DocumentationItem) => string[],
  headingLevel: number,
): Promise<string> {
  // Group items by category
  const byCategory: Record<string, DocumentationItem[]> = Object.create(null);
  for (const item of items) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = [];
    }
    byCategory[item.category].push(item);
  }

  let output = '';
  const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b));
  const heading = '#'.repeat(headingLevel);

  for (const category of categories) {
    output += `${heading} ${category}\n\n`;
    const categoryItems = byCategory[category].toSorted((a, b) => a.name.localeCompare(b.name));
    output += await generateMarkdownTable(categoryItems, headers, rowMapper);
    output += '\n';
  }

  return output;
}
