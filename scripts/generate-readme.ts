import { Glob } from 'bun';
import yaml from 'js-yaml';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'templates', 'README.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');

interface ActionConfig {
    name: string;
    description: string;
}

interface ActionInfo {
    name: string;
    description: string;
    version: string;
    sha: string;
    path: string; // Relative path to action dir
}

async function getGitSha(dir: string): Promise<string> {
    const proc = Bun.spawn(['git', 'log', '-n', '1', '--pretty=format:%h', dir], {
        cwd: ROOT_DIR,
        stdout: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    return output.trim();
}

async function getVersion(dir: string): Promise<string> {
    // 1. Try package.json
    const pkgPath = path.join(ROOT_DIR, dir, 'package.json');
    const pkgFile = Bun.file(pkgPath);
    if (await pkgFile.exists()) {
        try {
            const pkg = await pkgFile.json();
            return pkg.version || 'N/A';
        } catch {
            // ignore
        }
    }
    // 2. Try to find a git tag? (Simplified: return N/A if no package.json)
    return 'N/A';
}

const RELEASE_PLEASE_CONFIG = path.join(ROOT_DIR, 'release-please-config.json');

async function getLatestTag(component: string): Promise<string | null> {
    const pattern = `${component}-v*`;
    // Sort by version descending
    const proc = Bun.spawn(['git', 'tag', '--list', pattern, '--sort=-v:refname'], {
        cwd: ROOT_DIR,
        stdout: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    const tags = output.split('\n').filter(Boolean);
    if (tags.length > 0) {
        return tags[0];
    }
    return null;
}

async function getReleaseComponent(dir: string): Promise<string | null> {
    const file = Bun.file(RELEASE_PLEASE_CONFIG);
    if (await file.exists()) {
        try {
            const config = await file.json();
            const normalizedDir = dir.replaceAll('\\', '/');
            if (config.packages && config.packages[normalizedDir]) {
                return config.packages[normalizedDir].component;
            }
        } catch (e) {
            console.warn('⚠️ Failed to read release-please-config:', e);
        }
    }
    return null;
}

async function getRepoInfo(): Promise<string> {
    try {
        const proc = Bun.spawn(['git', 'config', '--get', 'remote.origin.url'], {
            cwd: ROOT_DIR,
            stdout: 'pipe',
        });
        const url = await new Response(proc.stdout).text();
        // Support HTTPS and SSH
        // https://github.com/owner/repo.git
        // git@github.com:owner/repo.git
        const match = url.trim().match(/github\.com[:/]([^/]+)\/([^.]+)/);
        if (match) {
            return `${match[1]}/${match[2]}`;
        }
    } catch (e) {
        console.warn('⚠️ Failed to get git remote url:', e);
    }
    return 'owner/repo'; // Fallback
}

async function main() {
    console.log('🔍 Scanning available actions...');
    const repoId = await getRepoInfo();

    const glob = new Glob('actions/**/action.{yml,yaml}');
    const actions: ActionInfo[] = [];

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
        // file is relative to ROOT_DIR, e.g. actions/custom/action.yml
        const absPath = path.join(ROOT_DIR, file);
        const dir = path.dirname(file);

        // Parse action.yml
        const content = await Bun.file(absPath).text();
        let config: ActionConfig;
        try {
            config = yaml.load(content) as ActionConfig;
        } catch (e) {
            console.warn(`⚠️ Failed to parse ${file}:`, e);
            continue;
        }

        if (!config || !config.name) {
            console.warn(`⚠️ Skiping ${file}: missing name`);
            continue;
        }

        const sha = await getGitSha(dir);
        let version = await getVersion(dir);

        // Try to get released tag
        const component = await getReleaseComponent(dir);
        let tag: string | null = null;
        if (component) {
            tag = await getLatestTag(component);
            if (tag) {
                // Tag is like "component-v1.0.0"
                // Check if we want to strip component? usually usage uses the full tag ref or v1.0.0
                // If the tag is specific to this component, we can use the tag directly.
                version = tag;
            }
        }

        actions.push({
            name: config.name,
            description: config.description || '',
            version: tag || (version !== 'N/A' ? version : 'N/A'),
            sha,
            path: dir,
        });
    }

    // Sort by name
    actions.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`✅ Found ${actions.length} actions.`);

    // Generate Table
    let table = '| Action | Description | Version | Usage |\n|--------|-------------|---------|-------|\n';
    for (const action of actions) {
        // Link the name to the directory (using forward slashes)
        const dirPath = action.path.replaceAll('\\', '/');
        const link = `[${action.name}](./${dirPath})`;
        const desc = action.description.replaceAll('\n', ' ').trim();

        // Construct usage string
        // uses: owner/repo/path@version
        // If we have a tag, use it. If not, use SHA.
        // action.version holds the tag if found.
        let versionRef = action.sha;
        let displayVersion = action.sha;

        if (action.version !== 'N/A') {
            // It's either a tag (component-v1.0.0) or package.json version fallback (1.0.0)
            if (action.version.startsWith('actions/')) {
                // It is a tag
                versionRef = action.version;
                // Actually, let's just show the tag.
                displayVersion = action.version;
            } else {
                // It's a package.json version (1.0.0)
                versionRef = `v${action.version}`;
                displayVersion = `v${action.version}`;
            }
        }

        const usage = `\`uses: ${repoId}/${dirPath}@${versionRef}\``;

        table += `| ${link} | ${desc} | ${displayVersion} | ${usage} |\n`;
    }

    // Read Template
    const templateFile = Bun.file(TEMPLATE_PATH);
    if (!(await templateFile.exists())) {
        console.error(`❌ Template not found at ${TEMPLATE_PATH}`);
        process.exit(1);
    }
    let readmeContent = await templateFile.text();

    // Replace Placeholder
    readmeContent = readmeContent.replace('<!-- ACTIONS_TABLE -->', table);

    // Write README
    await Bun.write(README_PATH, readmeContent);
    console.log(`🎉 Generated README.md at ${README_PATH}`);
}

if (import.meta.main) {
    await main();
}
