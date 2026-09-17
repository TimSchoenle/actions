import path from 'node:path';

import { ROOT_DIR, Sys } from '../../utils.js';
import { getRepoInfo } from '../git-utils.js';
import { getManifestVersions, getReleaseComponent } from '../utils.js';
import { sortDocumentationItems } from './sort.js';

import type { DocumentationItem, Parser } from '../types.js';

// Must match the `allprojects { group = ... }` override in configs/checkstyle/build.gradle.kts -
// JitPack publishes under that group verbatim, not its `com.github.<user>` default.
const JITPACK_GROUP_ID = 'de.timscho';

/**
 * `config_loc` is a convention property every build tool sets to a local directory of its own
 * choosing (Gradle's `configDirectory`, Maven's `propertyExpansion`) - it is never derived from a
 * remote `configLocation` URL. So a vendored ruleset's suppression files, and its `../_shared/`
 * sibling, only resolve once a consumer has copied them onto disk together; a bare raw-GitHub-URL
 * `configLocation` would silently fail to find them. The JitPack jar sidesteps this entirely: its
 * checkstyle.xml is a build-time rewritten copy whose suppression-file properties are `classpath:`
 * URIs instead (see configs/checkstyle/application/build.gradle.kts), so it needs no config
 * directory at all.
 */
export function parseCheckstyleMeta(
  content: string,
  dirPath: string,
  version: string | null,
  repoId: string,
): DocumentationItem | null {
  let meta: { name?: string; description?: string };
  try {
    meta = JSON.parse(content);
  } catch {
    return null;
  }

  const normalizedDir = dirPath.replaceAll('\\', '/');
  const basename = path.basename(normalizedDir);
  const rulesetPath = `${normalizedDir}/checkstyle.xml`;
  const artifactId = `checkstyle-${basename}`;

  const vendorUsage = `Vendor \`${normalizedDir}/\` and \`configs/checkstyle/_shared/\` into your project, then point your build tool's config directory (Gradle \`configDirectory\`, Maven \`config_loc\`) at your copy of \`${normalizedDir}/\`.`;

  let usage = vendorUsage;
  let versionLink: string | undefined;
  if (version) {
    // Both snippets pull the config out of the jar rather than off disk: Gradle's
    // `resources.text.fromArchiveEntry` reads `checkstyle.xml` out of a resolved configuration's
    // jar, and Maven's checkstyle plugin resolves `configLocation` against its own `<dependencies>`
    // classpath. Both need the artifact on the tool's own classpath too, so the suppression
    // files' `classpath:` URIs (see the doc comment above) resolve at check time.
    const gradleSnippet = [
      '```kotlin',
      'val checkstyleConfig: Configuration by configurations.creating',
      '',
      'repositories {',
      '    maven { url = uri("https://jitpack.io") }',
      '}',
      '',
      'dependencies {',
      `    checkstyleConfig("${JITPACK_GROUP_ID}:${artifactId}:${version}")`,
      `    checkstyle("${JITPACK_GROUP_ID}:${artifactId}:${version}")`,
      '}',
      '',
      'checkstyle {',
      '    config = resources.text.fromArchiveEntry(checkstyleConfig, "checkstyle.xml")',
      '}',
      '```',
    ].join('\n');

    const mavenSnippet = [
      '```xml',
      '<repositories>',
      '  <repository>',
      '    <id>jitpack.io</id>',
      '    <url>https://jitpack.io</url>',
      '  </repository>',
      '</repositories>',
      '',
      '<build>',
      '  <plugins>',
      '    <plugin>',
      '      <groupId>org.apache.maven.plugins</groupId>',
      '      <artifactId>maven-checkstyle-plugin</artifactId>',
      '      <configuration>',
      '        <configLocation>checkstyle.xml</configLocation>',
      '      </configuration>',
      '      <dependencies>',
      '        <dependency>',
      `          <groupId>${JITPACK_GROUP_ID}</groupId>`,
      `          <artifactId>${artifactId}</artifactId>`,
      `          <version>${version}</version>`,
      '        </dependency>',
      '      </dependencies>',
      '    </plugin>',
      '  </plugins>',
      '</build>',
      '```',
    ].join('\n');

    usage = `${vendorUsage} Or depend on it directly via [JitPack](https://jitpack.io), no vendoring or config directory required:\n\n**Gradle (Kotlin DSL)**\n\n${gradleSnippet}\n\n**Maven**\n\n${mavenSnippet}`;
    versionLink = `[${version}](https://github.com/${repoId}/releases/tag/${version})`;
  }

  return {
    name: meta.name || basename,
    description: meta.description || 'No description provided.',
    usage,
    category: 'Checkstyle',
    path: rulesetPath,
    version: versionLink,
  };
}

export class CheckstyleParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const glob = Sys.glob('configs/checkstyle/*/meta.json');
    const manifestShortVersions = await getManifestVersions();
    const repoId = await getRepoInfo();

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const dir = path.dirname(file);
      const normalizedDir = dir.replaceAll('\\', '/');

      const component = await getReleaseComponent(normalizedDir);
      const shortVersion = component ? manifestShortVersions[normalizedDir] : undefined;
      const version = component && shortVersion ? `${component}-v${shortVersion}` : null;
      if (!version) {
        console.log(`⚠️ ${file} has no release yet, publishing vendor-only usage`);
      }

      const content = await Sys.file(absPath).text();
      const item = parseCheckstyleMeta(content, normalizedDir, version, repoId);
      if (item) {
        items.push(item);
      } else {
        console.warn(`⚠️ Failed to parse ${file}`);
      }
    }
    return sortDocumentationItems(items);
  }
}
