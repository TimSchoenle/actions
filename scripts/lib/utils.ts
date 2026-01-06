import path from 'node:path';
import { Sys } from './sys';

export { Sys };

const ROOT_DIR = path.resolve(import.meta.dir, '..', '..');
export { ROOT_DIR };
export const ACTIONS_DIR = path.join(ROOT_DIR, 'actions');
export const START_VERSION = '1.0.0';

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function getRepoName(): Promise<string> {
  const origin = await Sys.exec('git remote get-url origin');
  // Handle git@github.com:User/repo.git or https://github.com/User/repo.git
  const match = new RegExp(/[:/]([^/]+\/[^/.]+)(\.git)?$/).exec(origin.trim());
  if (!match) {
    throw new Error(`Could not parse repo name from origin: ${origin}`);
  }
  return match[1];
}

export async function createFromTemplate(
  templateName: string,
  destPath: string,
  replacements: Record<string, string>,
) {
  const templatePath = path.join(import.meta.dir, '..', 'templates', templateName);
  const templateFile = Sys.file(templatePath);
  let content = await templateFile.text();

  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(new RegExp(`{{${key}}}`, 'g'), value);
  }

  await Sys.write(destPath, content);
}

