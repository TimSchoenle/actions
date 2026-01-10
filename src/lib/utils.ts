import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sys } from './sys';

export { Sys };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
export { ROOT_DIR };
export const ACTIONS_DIR = path.join(ROOT_DIR, 'actions');
export const START_VERSION = '1.0.0';

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseRepoName(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) {
    throw new Error(`Could not parse repo name from origin: ${origin}`);
  }
  // Handle git@github.com:User/repo.git or https://github.com/User/repo.git
  const match = new RegExp(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/).exec(trimmed);
  if (!match) {
    throw new Error(`Could not parse repo name from origin: ${origin}`);
  }
  return match[1];
}

export async function getRepoName(): Promise<string> {
  const origin = await Sys.exec('git remote get-url origin');
  return parseRepoName(origin);
}

export function replaceTemplateVariables(content: string, replacements: Record<string, string>): string {
  let newContent = content;
  for (const [key, value] of Object.entries(replacements)) {
    // Escape special regex characters in the key
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newContent = newContent.replaceAll(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g'), () => value);
  }
  return newContent;
}

export async function createFromTemplate(templateName: string, destPath: string, replacements: Record<string, string>) {
  const templatePath = path.join(__dirname, '..', 'templates', templateName);
  const templateFile = Sys.file(templatePath);
  const content = await templateFile.text();

  const finalContent = replaceTemplateVariables(content, replacements);

  await Sys.write(destPath, finalContent);
}
