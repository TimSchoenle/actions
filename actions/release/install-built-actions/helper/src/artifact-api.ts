import { createOctokit } from 'actions-util/client';

import type { ArtifactRecord } from 'action-graph';
import type { RepositoryCoordinates } from 'actions-util';

/** Reads one artifact record. Injected so tests need no GitHub. */
export type ArtifactLookup = (repository: RepositoryCoordinates, artifactId: number) => Promise<ArtifactRecord>;

/** Binds {@link ArtifactLookup} to `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}`. */
export function createArtifactLookup(token: string): ArtifactLookup {
  const octokit = createOctokit(token);

  return async (repository, artifactId) => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', {
      artifact_id: artifactId,
      owner: repository.owner,
      repo: repository.repo,
    });

    return {
      id: data.id,
      expired: data.expired,
      digest: data.digest,
      workflow_run: data.workflow_run === null ? null : { id: data.workflow_run?.id },
    };
  };
}
