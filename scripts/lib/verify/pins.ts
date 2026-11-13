/**
 * The pinned action refs of the generated Verify workflows.
 *
 * Kept in one object because Renovate has to find them here. This file is TypeScript, so no built-in
 * Renovate manager sees it. Three `customManagers` in `renovate.json` do, and they only work on refs
 * written in exactly this shape: a single-quoted literal starting with the owner, a 40-character
 * digest, then ` # ` and either a `vX.Y.Z` tag or `tag=<component>-vX.Y.Z` for an internal one.
 * `renovate-managers.test.ts` fails any entry the managers would silently skip, which otherwise looks
 * like nothing at all: an action quietly frozen at the version it was added.
 *
 * Renovate updates every occurrence of the same dependency at the same version in one branch, so a
 * bump lands here and in the generated workflows together and the drift check stays satisfied.
 *
 * @packageDocumentation
 */

export const PINNED = {
  hardenRunner: 'step-security/harden-runner@1d88384fd173af6ecb012dfd0264a306b711241a # v2.22.4',
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  createAppToken: 'actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0',
  setupBun:
    'TimSchoenle/actions/actions/bun/setup-cached@7c1147cf1e275c068a8484fa9a2dcb38a8b1f92f # tag=actions-bun-setup-cached-v3.1.0',
  // Used only by the jobs that must not install anything. Kept at the same version `setup-cached`
  // pins internally, because the two halves have to agree on the cache format.
  setupBunOnly: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0',
  setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  cache: 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
  cacheRestore: 'actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
  // The build and install steps run released versions, not this checkout's: the code that decides
  // which bundles a verdict runs must not come from the change under test.
  buildActions:
    'TimSchoenle/actions/actions/release/build-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-build-actions-v1.1.1',
  installBuiltActions:
    'TimSchoenle/actions/actions/release/install-built-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-install-built-actions-v1.1.1',
} as const;

/** A key of {@link PINNED}. */
export type PinKey = keyof typeof PINNED;

/**
 * Refs a source may reach, keyed as {@link PINNED} names them.
 *
 * A `Map` rather than an index into `PINNED`, so a key read out of a file on disk cannot address
 * anything but a pin.
 */
const PIN_BY_KEY: ReadonlyMap<string, string> = new Map(Object.entries(PINNED));

/**
 * The only form a Verify source may use to reach an action this file pins: `uses: pinned:<key>`.
 *
 * A source is copied into its generated workflow, so a `uses:` written out in full there would be a
 * second pin for an action `PINNED` already carries, and one no manager in `renovate.json` can see.
 * Renovate would then bump the generated copy on its own, the drift check would fail, and the
 * regenerate job would revert the bump, so the update could never land. Naming a key instead keeps
 * one pin per action, in the one place Renovate looks.
 */
const PIN_PLACEHOLDER = /^([ \t]*-?[ \t]*uses:[ \t]*)pinned:(\w+)[ \t]*$/gm;

/**
 * Substitutes the `pinned:<key>` placeholders of a rendered workflow with the refs from {@link PINNED}.
 *
 * Throws rather than passing an unresolved placeholder through: `uses: pinned:foo` is not a valid
 * action reference, and a workflow carrying one fails only once a runner has reached that job.
 */
export function resolvePins(text: string): string {
  return text.replaceAll(PIN_PLACEHOLDER, (_match, prefix: string, key: string) => {
    const pin = PIN_BY_KEY.get(key);

    if (pin === undefined) {
      throw new Error(
        `Unknown pin 'pinned:${key}'. Add the action to PINNED in scripts/lib/verify/pins.ts, or name one ` +
          `of: ${[...PIN_BY_KEY.keys()].join(', ')}.`,
      );
    }

    return `${prefix}${pin}`;
  });
}
