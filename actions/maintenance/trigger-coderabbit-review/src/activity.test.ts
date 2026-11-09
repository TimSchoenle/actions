import { describe, expect, it } from 'vitest';

import { commandBody, duplicateReason, markedHead, outdatedComments } from './activity.js';

import type { ActivityComment, ActivityReview, ReviewActivity } from './activity.js';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const ACTOR = 'owner-user';

let nextId = 0;

function comment(overrides: Partial<ActivityComment> = {}): ActivityComment {
  nextId += 1;

  return {
    authorIsBot: false,
    authorLogin: ACTOR,
    body: 'hello',
    createdAt: '2026-11-09T10:00:00Z',
    isMinimized: false,
    nodeId: `IC_${nextId}`,
    ...overrides,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? '2026-11-09T10:00:00Z',
  };
}

function request(head: string, createdAt: string, overrides: Partial<ActivityComment> = {}): ActivityComment {
  return comment({ body: commandBody('review', head), createdAt, ...overrides });
}

function reply(summary: string, createdAt: string, overrides: Partial<ActivityComment> = {}): ActivityComment {
  return comment({
    authorIsBot: true,
    authorLogin: 'coderabbitai',
    body: `<!-- This is an auto-generated reply by CodeRabbit -->\n<!-- CodeRabbit review command invocation: v2:abc -->\n<details>\n<summary>${summary}</summary>\n</details>`,
    createdAt,
    ...overrides,
  });
}

function review(overrides: Partial<ActivityReview> = {}): ActivityReview {
  return {
    authorIsBot: true,
    authorLogin: 'coderabbitai',
    body: '**Actionable comments posted: 1**',
    commitSha: HEAD,
    ...overrides,
  };
}

function activity(comments: ActivityComment[] = [], reviews: ActivityReview[] = []): ReviewActivity {
  return { comments, reviews };
}

describe('commandBody', () => {
  it('puts the command on the first line and the marker last', () => {
    expect(commandBody('full review', HEAD)).toBe(
      `@coderabbitai full review\n\n<!-- trigger-coderabbit-review head=${HEAD} -->`,
    );
  });

  it('accepts a SHA-256 commit id', () => {
    expect(markedHead(commandBody('review', 'c'.repeat(64)))).toBe('c'.repeat(64));
  });

  it.each(['', 'abc', 'A'.repeat(40), `${HEAD} -->\n@coderabbitai pause`])('refuses the head %j', (head) => {
    expect(() => commandBody('review', head)).toThrow(/not a full commit id/);
  });
});

describe('markedHead', () => {
  it('reads the head from a marked command', () => {
    expect(markedHead(commandBody('review', HEAD))).toBe(HEAD);
  });

  it.each([
    '@coderabbitai review',
    `<!-- trigger-coderabbit-review head=${HEAD} --> and more text`,
    `<!-- trigger-coderabbit-review head=${HEAD.slice(1)} -->`,
  ])('ignores %j', (body) => {
    expect(markedHead(body)).toBeUndefined();
  });
});

describe('duplicateReason', () => {
  it('finds nothing on a pull request without activity', () => {
    expect(duplicateReason(activity(), HEAD, ACTOR)).toBeUndefined();
  });

  it('reports a CodeRabbit review on the head commit', () => {
    expect(duplicateReason(activity([], [review()]), HEAD, ACTOR)).toBe('already-reviewed');
  });

  it.each([
    { description: 'on an older commit', overrides: { commitSha: OLD_HEAD } },
    { description: 'with an empty body, which is a thread reply', overrides: { body: '  ' } },
    { description: 'by a user with the same login', overrides: { authorIsBot: false } },
    { description: 'by another bot', overrides: { authorLogin: 'codecov' } },
  ])('ignores a review $description', ({ overrides }) => {
    expect(duplicateReason(activity([], [review(overrides)]), HEAD, ACTOR)).toBeUndefined();
  });

  it('reports a pending request for the head commit', () => {
    expect(duplicateReason(activity([request(HEAD, '2026-11-09T10:00:00Z')]), HEAD, ACTOR)).toBe('already-requested');
  });

  it('compares the actor case-insensitively', () => {
    expect(duplicateReason(activity([request(HEAD, '2026-11-09T10:00:00Z')]), HEAD, 'Owner-User')).toBe(
      'already-requested',
    );
  });

  it('reports a request CodeRabbit carried out', () => {
    const comments = [request(HEAD, '2026-11-09T10:00:00Z'), reply('Action performed', '2026-11-09T10:00:10Z')];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBe('already-requested');
  });

  it('asks again after CodeRabbit did not complete the request', () => {
    const comments = [request(HEAD, '2026-11-09T10:00:00Z'), reply('Action not completed', '2026-11-09T10:00:10Z')];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBeUndefined();
  });

  it('asks again after a failure reply in the same second as the request', () => {
    const comments = [request(HEAD, '2026-11-09T10:00:00Z'), reply('Action not completed', '2026-11-09T10:00:00Z')];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBeUndefined();
  });

  it('asks again after CodeRabbit rewrote an older reply to a failure', () => {
    const comments = [
      reply('Action not completed', '2026-11-09T09:00:00Z', { updatedAt: '2026-11-09T10:00:30Z' }),
      request(HEAD, '2026-11-09T10:00:00Z'),
    ];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBeUndefined();
  });

  it('counts only failures after the latest request', () => {
    const comments = [
      request(HEAD, '2026-11-09T10:00:00Z'),
      reply('Action not completed', '2026-11-09T10:00:10Z'),
      request(HEAD, '2026-11-09T11:00:00Z'),
    ];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBe('already-requested');
  });

  it.each([
    { description: 'for an older commit', item: request(OLD_HEAD, '2026-11-09T10:00:00Z') },
    { description: 'by someone else', item: request(HEAD, '2026-11-09T10:00:00Z', { authorLogin: 'mallory' }) },
    { description: 'without a marker', item: comment({ body: '@coderabbitai review' }) },
    {
      description: 'by a bot with the actor login',
      item: request(HEAD, '2026-11-09T10:00:00Z', { authorIsBot: true }),
    },
  ])('ignores a request $description', ({ item }) => {
    expect(duplicateReason(activity([item]), HEAD, ACTOR)).toBeUndefined();
  });

  it('ignores a failure reply that does not come from CodeRabbit', () => {
    const comments = [
      request(HEAD, '2026-11-09T10:00:00Z'),
      reply('Action not completed', '2026-11-09T10:00:10Z', { authorIsBot: false, authorLogin: 'mallory' }),
    ];

    expect(duplicateReason(activity(comments), HEAD, ACTOR)).toBe('already-requested');
  });
});

describe('outdatedComments', () => {
  it('collapses earlier requests of the actor and every CodeRabbit command reply', () => {
    const ownRequest = request(OLD_HEAD, '2026-11-09T10:00:00Z');
    const performed = reply('Action performed', '2026-11-09T10:00:10Z');
    const failed = reply('Action not completed', '2026-11-09T10:00:20Z');

    expect(outdatedComments(activity([ownRequest, performed, failed]), ACTOR)).toEqual([
      ownRequest.nodeId,
      performed.nodeId,
      failed.nodeId,
    ]);
  });

  it.each([
    { description: 'an unmarked comment of the actor', item: comment({ body: '@coderabbitai review' }) },
    {
      description: 'a marked comment by someone else',
      item: request(OLD_HEAD, '2026-11-09T10:00:00Z', { authorLogin: 'mallory' }),
    },
    {
      description: 'a CodeRabbit summary',
      item: comment({ authorIsBot: true, authorLogin: 'coderabbitai', body: 'Walkthrough' }),
    },
    { description: 'a collapsed comment', item: request(OLD_HEAD, '2026-11-09T10:00:00Z', { isMinimized: true }) },
    {
      description: 'a reply-shaped comment by a user',
      item: reply('Action performed', '2026-11-09T10:00:00Z', { authorIsBot: false }),
    },
  ])('keeps $description', ({ item }) => {
    expect(outdatedComments(activity([item]), ACTOR)).toEqual([]);
  });
});
