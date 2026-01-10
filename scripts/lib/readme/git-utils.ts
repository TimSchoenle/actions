import { Sys } from '../utils.js';

export function parseGitUrl(url: string): string {
  const match = new RegExp(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/).exec(url.trim());
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  throw new Error('Could not parse git remote url');
}

export async function getRepoInfo(): Promise<string> {
  try {
    const url = await Sys.exec('git config --get remote.origin.url');
    return parseGitUrl(url);
  } catch (e) {
    throw new Error(`Failed to get git remote url: ${e}`);
  }
}
