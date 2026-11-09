# Download Release Asset

Downloads one asset of a GitHub release and verifies its SHA-256 before handing over its path.

The release download URL (`github.com/<owner>/<repo>/releases/download/<tag>/<asset>`) is tried first, three
times. When it still fails with a 5xx, a timeout or a connection error, the action looks the release up through
the REST API, picks the one asset with that exact name, and downloads it from the asset endpoint by its numeric
ID. A 404 is not retried that way: the asset does not exist. Both routes feed the same verification.

## Usage

Pin the asset itself:

```yaml
- id: download
  uses: TimSchoenle/actions/actions/common/download-release-asset@<sha> # tag=actions-common-download-release-asset-v<version>
  with:
    repository: jdx/jactionlint
    tag: v2.5.0
    asset: jactionlint_2.5.0_checksums.txt
    sha256: 5cbf573f7d3828a6e679c35520f1bd00c512ec7bde31a281e40808ba68c8225c
```

Or pin the release's checksums file, so one digest covers the asset on every platform:

```yaml
- id: download
  uses: TimSchoenle/actions/actions/common/download-release-asset@<sha> # tag=actions-common-download-release-asset-v<version>
  with:
    repository: jdx/jactionlint
    tag: v2.5.0
    asset: jactionlint_2.5.0_linux_amd64.tar.gz
    checksums-asset: jactionlint_2.5.0_checksums.txt
    checksums-sha256: 5cbf573f7d3828a6e679c35520f1bd00c512ec7bde31a281e40808ba68c8225c
- run: tar -xzf "$ARCHIVE" -C "$RUNNER_TEMP" jactionlint
  env:
    ARCHIVE: ${{ steps.download.outputs.path }}
```

The checksums file is downloaded and checked against `checksums-sha256` first, so a wrong pin fails before the
asset is downloaded. It must be in `sha256sum` format and list the asset exactly once.

## Inputs

| Input              | Required | Default               | Description                                                               |
| ------------------ | -------- | --------------------- | ------------------------------------------------------------------------- |
| `repository`       | yes      |                       | `owner/repo` of the release.                                              |
| `tag`              | yes      |                       | Tag of the release.                                                       |
| `asset`            | yes      |                       | File name of the asset.                                                   |
| `token`            | no       | `${{ github.token }}` | Token for the REST API fallback. See [Token](#token).                     |
| `sha256`           | no       |                       | SHA-256 of the asset. Set this, or the two below.                         |
| `checksums-asset`  | no       |                       | File name of a checksums file in the same release that lists the asset.  |
| `checksums-sha256` | no       |                       | SHA-256 of the checksums file.                                            |

## Outputs

| Output | Description                                                                                  |
| ------ | -------------------------------------------------------------------------------------------- |
| `path` | Absolute path of the verified asset, in a new directory under `RUNNER_TEMP`. Named `asset`. |

When verification fails, the step fails and `path` stays unset. The action deletes the downloaded files; if that
fails it logs a warning, and the files may remain under `RUNNER_TEMP`.

## Token

The token goes only to `api.github.com`, only for the fallback, and only when `GITHUB_SERVER_URL` is
`https://github.com`: a GitHub Enterprise Server token is not a github.com credential. The release download itself
is anonymous. The asset URL is built from the numeric ID rather than read from the API response, and the
`Authorization` header is dropped when the asset endpoint redirects to the storage host.

The token keeps the fallback clear of the anonymous rate limit of 60 requests an hour per IP address. Any token
works. Only public releases are supported: the anonymous release download answers 404 for a private asset, and a
404 ends the download instead of starting the fallback.

## Proxies

Requests go through `@actions/http-client`, which honours `HTTPS_PROXY` and `NO_PROXY` on self-hosted runners.
