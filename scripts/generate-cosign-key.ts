import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { input } from '@inquirer/prompts';

import { generateCosignKeyPair, verifyCosignKeyPair } from './lib/cosign-key.js';

type CliOptions = {
  help: boolean;
  json: boolean;
  nonInteractive: boolean;
  outputDir?: string;
  passwordBytes: number;
};

type CosignKeyMaterial = {
  createdAt: string;
  password: string;
  privateKey: string;
  publicKey: string;
};

const DEFAULT_PASSWORD_BYTES = 64;
const SECTION_DIVIDER = '======================================================================';

function printHelp() {
  console.log(`Generate a cosign signing key pair and password using pure TypeScript.

The private key is an ECDSA P-256 key in cosign's encrypted format, readable by
"cosign sign --key" with COSIGN_PASSWORD set to the generated password.

Usage:
  bun scripts/generate-cosign-key.ts [options]

Options:
  --output-dir <path>       Write cosign.key, cosign.pub and credentials.json to secure files
  --password-bytes <value>  Random bytes for password entropy (default: ${DEFAULT_PASSWORD_BYTES})
  --json                    Output JSON instead of human-readable sections
  --non-interactive         Do not prompt for missing inputs
  -h, --help                Show this help

Examples:
  bun scripts/generate-cosign-key.ts --non-interactive
  bun scripts/generate-cosign-key.ts --output-dir ./secure-cosign-material
`);
}

function parsePasswordBytes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/u.test(value) || parsed < 16 || parsed > 1024) {
    throw new Error('--password-bytes must be an integer between 16 and 1024');
  }
  return parsed;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    json: false,
    nonInteractive: false,
    passwordBytes: DEFAULT_PASSWORD_BYTES,
  };

  const valueHandlers: Record<string, (value: string) => void> = {
    '--output-dir': (value: string) => {
      options.outputDir = value;
    },
    '--password-bytes': (value: string) => {
      options.passwordBytes = parsePasswordBytes(value);
    },
  };

  const flagHandlers: Record<string, () => void> = {
    '--help': () => {
      options.help = true;
    },
    '--json': () => {
      options.json = true;
    },
    '--non-interactive': () => {
      options.nonInteractive = true;
    },
    '-h': () => {
      options.help = true;
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const valueHandler = valueHandlers[arg];
    if (valueHandler) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      valueHandler(value);
      index += 1;
      continue;
    }

    const flagHandler = flagHandlers[arg];
    if (flagHandler) {
      flagHandler();
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function generatePassword(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

async function makeSecureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { mode: 0o700, recursive: true });
  try {
    await fs.chmod(dirPath, 0o700);
  } catch {
    // chmod is best effort on Windows.
  }
}

async function writeSecureFile(filePath: string, content: string): Promise<void> {
  // `wx` refuses to replace an existing file, so an earlier key is never destroyed and the new
  // secret is never written into a file that already has looser permissions.
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing file: ${filePath}`, { cause: error });
    }
    throw error;
  }
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod is best effort on Windows.
  }
}

async function resolveOptions(options: CliOptions): Promise<CliOptions> {
  if (options.nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    return options;
  }

  const outputDir = await input({
    default: options.outputDir ?? '',
    message: 'Output directory for key files (optional):',
  });

  return { ...options, outputDir: outputDir.trim() || undefined };
}

export function generateCosignMaterial(passwordBytes: number): CosignKeyMaterial {
  const password = generatePassword(passwordBytes);
  const keyPair = generateCosignKeyPair(password);
  verifyCosignKeyPair(keyPair, password);

  return {
    createdAt: new Date().toISOString(),
    password,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };
}

export async function saveMaterialToDisk(outputDir: string, material: CosignKeyMaterial): Promise<void> {
  const resolvedOutputDir = path.resolve(outputDir);
  await makeSecureDir(resolvedOutputDir);

  const files: [string, string][] = [
    [path.join(resolvedOutputDir, 'cosign.key'), material.privateKey],
    [path.join(resolvedOutputDir, 'cosign.pub'), material.publicKey],
    [path.join(resolvedOutputDir, 'credentials.json'), `${JSON.stringify(material, undefined, 2)}\n`],
  ];

  // Check every target up front so a clash does not leave a partial set behind.
  for (const [filePath] of files) {
    if (await pathExists(filePath)) {
      throw new Error(`Refusing to overwrite existing file: ${filePath}`);
    }
  }
  for (const [filePath, content] of files) {
    await writeSecureFile(filePath, content);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function renderHumanReadableResult(material: CosignKeyMaterial, outputDir?: string): void {
  const sections = [
    SECTION_DIVIDER,
    'COSIGN SIGNING KEY GENERATED',
    SECTION_DIVIDER,
    'ALGORITHM:   ECDSA P-256',
    `CREATED AT:  ${material.createdAt}`,
    outputDir ? `OUTPUT DIR:  ${path.resolve(outputDir)}` : 'OUTPUT DIR:  (none)',
    SECTION_DIVIDER,
    'COSIGN_PASSWORD:',
    material.password,
    SECTION_DIVIDER,
    'COSIGN_PUBLIC_KEY (cosign.pub):',
    material.publicKey.trimEnd(),
    SECTION_DIVIDER,
    'COSIGN_PRIVATE_KEY (cosign.key):',
    material.privateKey.trimEnd(),
    SECTION_DIVIDER,
    'Store password and private key in a secret manager immediately.',
    'Do not commit these values to source control or CI logs.',
    SECTION_DIVIDER,
  ];

  console.log(sections.join('\n'));
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  try {
    options = await resolveOptions(options);
    const material = generateCosignMaterial(options.passwordBytes);

    if (options.outputDir) {
      await saveMaterialToDisk(options.outputDir, material);
    }

    if (options.json) {
      console.log(JSON.stringify(material, undefined, 2));
      return;
    }

    renderHumanReadableResult(material, options.outputDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
