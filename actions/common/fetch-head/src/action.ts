import { resolveRealWithinWorkspace, runAction, workspaceRoot } from 'actions-util';
import * as core from 'actions-util/core';

import { authorizationHeader, basicCredentials, fetchHead } from './fetch-head.js';
import { getInput, setOutput } from './generated/action-io.js';

/**
 * Reads the inputs, fetches the commit and publishes the commit HEAD points at.
 *
 * The token's encodings are masked before git runs, since the runner masks only the token itself
 * and git can echo a header in a trace.
 */
export async function run(): Promise<void> {
  await runAction(async () => {
    const token = getInput('token');
    if (token !== '') {
      core.setSecret(basicCredentials(token));
      core.setSecret(authorizationHeader(token));
    }

    const directory = await resolveRealWithinWorkspace(getInput('path'), workspaceRoot(), 'path');
    const sha = await fetchHead({
      directory,
      repository: getInput('repository'),
      serverUrl: getInput('server_url'),
      sha: getInput('sha'),
      token,
    });

    core.info(`HEAD points at ${sha}; nothing was checked out.`);
    setOutput('sha', sha);
  });
}
