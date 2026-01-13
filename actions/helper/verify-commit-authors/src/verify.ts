import * as core from '@actions/core';
import * as github from '@actions/github';

import type { Repository } from '@octokit/graphql-schema';

export async function run() {
  try {
    const prUrl = core.getInput('pr_url', { required: true });
    const token = core.getInput('github_token', { required: true });
    const userIdsInput = core.getInput('user_ids', { required: true });

    // Parse user IDs
    const acceptedIds = userIdsInput.split(',').map((s) => Number(s.trim()));
    core.info(`Verifying commits for PR: ${prUrl}`);
    core.info(`Accepted User IDs: ${acceptedIds.join(', ')}`);

    const octokit = github.getOctokit(token);

    const query = `
      query($url: URI!) {
        resource(url: $url) {
          ... on PullRequest {
            commits(last: 100) {
              totalCount
              nodes {
                commit {
                  oid
                  authors(first: 20) {
                    nodes {
                      user {
                        databaseId
                      }
                    }
                  }
                  signature {
                    isValid
                    state
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await octokit.graphql<{ resource: Repository['resource'] }>(query, {
      url: prUrl,
    });

    const pr = response.resource;

    if (!pr || !('commits' in pr)) {
      throw new Error('Could not find Pull Request data from URL');
    }

    const { totalCount, nodes } = pr.commits;

    if (totalCount > 100) {
      core.setFailed('PR has more than 100 commits. Verification unsafe.');
      core.setOutput('verified', 'false');
      return;
    }

    const invalidCommits: string[] = [];

    for (const node of nodes) {
      // Node can be null/undefined in generated types, though unlikely in practice with this query
      if (!node || !node.commit) continue;

      const commit = node.commit;
      const oid = commit.oid;

      // Check Authors
      const authors = commit.authors?.nodes;
      // authors nodes can be null/undefined
      const isAuthorValid =
        !!authors &&
        authors.length > 0 &&
        authors.every(
          (author: { user: { databaseId: number } }) => author?.user && acceptedIds.includes(author.user.databaseId),
        );

      // Check Signature
      const isSignatureValid = commit.signature?.isValid === true;

      if (!isAuthorValid || !isSignatureValid) {
        core.error(`Invalid commit: ${oid}. Author Valid: ${isAuthorValid}, Signature Valid: ${isSignatureValid}`);
        invalidCommits.push(oid);
      }
    }

    if (invalidCommits.length > 0) {
      core.setFailed('Found invalid commits (author check or signature check failed)');
      core.setOutput('verified', 'false');
      core.setOutput('invalid_commits', invalidCommits.join('\n'));
    } else {
      core.info('All commits verified.');
      core.setOutput('verified', 'true');
      core.setOutput('invalid_commits', '');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

// execute logic if called directly
if (require.main === module) {
  await run();
}
