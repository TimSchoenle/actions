/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** The state of a Git signature. */
export type GitSignatureState =
  /** The signing certificate or its chain could not be verified */
  | 'BAD_CERT'
  /** Invalid email used for signing */
  | 'BAD_EMAIL'
  /** Signing key expired */
  | 'EXPIRED_KEY'
  /** Internal error - the GPG verification service misbehaved */
  | 'GPGVERIFY_ERROR'
  /** Internal error - the GPG verification service is unavailable at the moment */
  | 'GPGVERIFY_UNAVAILABLE'
  /** Invalid signature */
  | 'INVALID'
  /** Malformed signature */
  | 'MALFORMED_SIG'
  /** The usage flags for the key that signed this don't allow signing */
  | 'NOT_SIGNING_KEY'
  /** Email used for signing not known to GitHub */
  | 'NO_USER'
  /** Valid signature, though certificate revocation check failed */
  | 'OCSP_ERROR'
  /** Valid signature, pending certificate revocation checking */
  | 'OCSP_PENDING'
  /** One or more certificates in chain has been revoked */
  | 'OCSP_REVOKED'
  /** Key used for signing not known to GitHub */
  | 'UNKNOWN_KEY'
  /** Unknown signature type */
  | 'UNKNOWN_SIG_TYPE'
  /** Unsigned */
  | 'UNSIGNED'
  /** Email used for signing unverified on GitHub */
  | 'UNVERIFIED_EMAIL'
  /** Valid signature and verified by GitHub */
  | 'VALID';

export type VerifyCommitsQueryVariables = Exact<{
  prUrl: string;
}>;


export type VerifyCommitsQuery = { resource:
    | { __typename: 'Bot' }
    | { __typename: 'CheckRun' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'Gist' }
    | { __typename: 'Issue' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'Milestone' }
    | { __typename: 'Organization' }
    | { __typename: 'PullRequest', commits: { totalCount: number, nodes: Array<{ commit: { oid: string, authors: { totalCount: number, nodes: Array<{ user: { databaseId: number | null } | null } | null> | null }, signature:
              | { isValid: boolean, state: GitSignatureState }
              | { isValid: boolean, state: GitSignatureState }
              | { isValid: boolean, state: GitSignatureState }
              | { isValid: boolean, state: GitSignatureState }
             | null } } | null> | null } }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Release' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'TeamDiscussion' }
    | { __typename: 'TeamDiscussionComment' }
    | { __typename: 'User' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null };


export const VerifyCommitsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VerifyCommits"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prUrl"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"URI"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resource"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"url"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prUrl"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PullRequest"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commits"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"last"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commit"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"oid"}},{"kind":"Field","name":{"kind":"Name","value":"authors"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"20"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"databaseId"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"signature"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isValid"}},{"kind":"Field","name":{"kind":"Name","value":"state"}}]}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<VerifyCommitsQuery, VerifyCommitsQueryVariables>;