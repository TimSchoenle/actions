import path from 'node:path';

import { ROOT_DIR, Sys } from '../../utils.js';
import { getRepoInfo } from '../git-utils.js';
import { getManifestVersions, getReleaseComponent } from '../utils.js';
import { sortDocumentationItems } from './sort.js';

import type { DocumentationItem, Parser } from '../types.js';

// `de.timscho` is TimSchoenle's account-level custom domain on JitPack (DNS TXT at
// git.timscho.de -> https://github.com/TimSchoenle; see
// https://github.com/jitpack/jitpack.io/blob/main/private/_index.en.md#custom-domain), which
// replaces the `com.github.<owner>` prefix JitPack would otherwise use - it does NOT publish
// under whatever `allprojects { group = ... }` the build itself sets (also `de.timscho`, by
// coincidence; see configs/checkstyle/build.gradle.kts). The repo name still gets folded in for a
// multi-module build the way `com.github.<owner>.<repo>` would (this one publishes two modules -
// checkstyle-application and checkstyle-library), so the working coordinate is
// `de.timscho.<repo>:<artifactId>:<version>`, confirmed by resolving
// de/timscho/actions/checkstyle-library/<tag>/....pom directly - never the bare `de.timscho`
// that 401s, and not `com.github.<owner>.<repo>` either now that the domain claim is live.
const JITPACK_CUSTOM_GROUP_ID = 'de.timscho';

function jitpackGroupId(repoId: string): string {
  const repoName = repoId.split('/')[1];
  return `${JITPACK_CUSTOM_GROUP_ID}.${repoName}`;
}

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
    const jitpackGroup = jitpackGroupId(repoId);
    // Both snippets pull the config out of the jar rather than off disk: Gradle's
    // `resources.text.fromArchiveEntry` reads `checkstyle.xml` out of a resolved configuration's
    // jar, and Maven's checkstyle plugin resolves `configLocation` against its own `<dependencies>`
    // classpath. Both need the artifact on the tool's own classpath too, so the suppression
    // files' `classpath:` URIs (see the doc comment above) resolve at check time.
    //
    // Gradle only: adding the ruleset jar to the `checkstyle` configuration isn't enough by
    // itself. That configuration's `com.puppycrawl.tools:checkstyle` dependency is normally added
    // automatically from `toolVersion` via `Configuration.defaultDependencies`, but that mechanism
    // backs off the moment anything else is added to the configuration explicitly - so without
    // re-adding the tool by hand, checkstyleMain fails with
    // `ClassNotFoundException: CheckstyleAntTask`. Maven doesn't have this problem: the plugin
    // pulls in its own checkstyle dependency regardless of what else is listed alongside it.
    const gradleSnippet = [
      '```kotlin',
      'val checkstyleConfig: Configuration by configurations.creating',
      '',
      'repositories {',
      '    maven { url = uri("https://jitpack.io") }',
      '}',
      '',
      'checkstyle {',
      '    toolVersion = "<your checkstyle version>"',
      '    config = resources.text.fromArchiveEntry(checkstyleConfig, "checkstyle.xml")',
      '}',
      '',
      'dependencies {',
      `    checkstyleConfig("${jitpackGroup}:${artifactId}:${version}")`,
      `    checkstyle("${jitpackGroup}:${artifactId}:${version}")`,
      '    checkstyle("com.puppycrawl.tools:checkstyle:${checkstyle.toolVersion}")',
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
      `          <groupId>${jitpackGroup}</groupId>`,
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
