import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import { RunNotFoundError } from './find.js';

import type { ArtifactApi, ArtifactSummary } from './find.js';
import type { RepositoryCoordinates } from 'actions-util';

/** GitHub's ceiling on `per_page`, so the listing arrives in as few requests as possible. */
const MAX_PAGE_SIZE = 100;

/** GitHub's answer for a run that does not exist, or that the token may not see. */
const NOT_FOUND = 404;

/**
 * Binds the {@link ArtifactApi} to the REST endpoint that lists a run's artifacts.
 *
 * Every page is read: the `name` filter normally leaves one artifact, but the caller compares names
 * itself and must see every candidate to tell one from several.
 */
export function createArtifactApi(token: string): ArtifactApi {
  const octokit = createOctokit(token);

  return {
    async listArtifacts(repository: RepositoryCoordinates, runId: number, name: string): Promise<ArtifactSummary[]> {
      try {
        const artifacts = await octokit.paginate(octokit.rest.actions.listWorkflowRunArtifacts, {
          name,
          owner: repository.owner,
          per_page: MAX_PAGE_SIZE,
          repo: repository.repo,
          run_id: runId,
        });

        return artifacts.map((artifact) => ({ expired: artifact.expired, id: artifact.id, name: artifact.name }));
      } catch (error) {
        if (hasStatus(error, NOT_FOUND)) {
          throw new RunNotFoundError(repository, runId, { cause: error });
        }
        throw error;
      }
    },
  };
}
