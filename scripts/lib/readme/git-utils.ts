import { Sys } from '../utils.js';

export async function getRepoInfo(): Promise<string> {
  try {
    const url = await Sys.exec('git config --get remote.origin.url');
    const match = new RegExp(/github\.com[:/]([^/]+)\/([^.]+)/).exec(url.trim());
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    throw new Error(`Failed to get git remote url: ${e}`);
  }
  throw new Error('Could not parse git remote url');
}
