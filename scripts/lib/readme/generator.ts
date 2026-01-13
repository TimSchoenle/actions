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

export async function generateSection(
  items: DocumentationItem[],
  headers: string[],
  rowMapper: (item: DocumentationItem) => string[],
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

  for (const category of categories) {
    output += `### ${category}\n\n`;
    const categoryItems = byCategory[category].toSorted((a, b) => a.name.localeCompare(b.name));
    output += await generateMarkdownTable(categoryItems, headers, rowMapper);
    output += '\n';
  }

  return output;
}
