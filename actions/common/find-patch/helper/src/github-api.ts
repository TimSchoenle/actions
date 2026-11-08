import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import { RunNotFoundError } from './find.js';

import type { ArtifactApi, ArtifactSummary } from './find.js';
import type { RepositoryCoordinates } from 'actions-util';

/** GitHub's ceiling on `per_page`, so the listing arrives in as few requests as possible. */
const MAX_PAGE_SIZE = 100;

/** GitHub's answer for a run that does not exist, or that the token may not see. */
const NOT_FOUND = 404;

/** GitHub's answer for a request it understood but refused, such as a malformed parameter. */
const UNPROCESSABLE = 422;

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

        return artifacts.map((artifact) => ({
          expired: artifact.expired,
          id: artifact.id,
          name: artifact.name,
          sizeInBytes: artifact.size_in_bytes,
        }));
      } catch (error) {
        if (hasStatus(error, NOT_FOUND)) {
          throw new RunNotFoundError(repository, runId, { cause: error });
        }
        if (hasStatus(error, UNPROCESSABLE)) {
          throw new Error(
            `GitHub refused to list the artifacts named ${JSON.stringify(name)} of workflow run ${runId} of ` +
              `${repository.owner}/${repository.repo} (422): ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        // Rate limits are retried inside the shared client; anything left is surfaced unchanged.
        throw error;
      }
    },
  };
}
