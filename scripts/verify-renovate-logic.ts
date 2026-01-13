/**
 * Test script for verify-commit-authors Logic (List Support)
 */

interface CommitAuthor {
  user: { databaseId: number } | null;
}

interface CommitNode {
  commit: {
    oid: string;
    authors: { nodes: CommitAuthor[] };
    signature: { isValid: boolean } | null;
  };
}

interface MockData {
  data: {
    resource: {
      commits: {
        totalCount: number;
        nodes: CommitNode[];
      };
    };
  };
}

// Mock Data
const mockData: MockData = {
  data: {
    resource: {
      commits: {
        totalCount: 4,
        nodes: [
          // Valid (ID 1)
          {
            commit: { oid: 'sha-1', authors: { nodes: [{ user: { databaseId: 111 } }] }, signature: { isValid: true } },
          },
          // Valid (ID 2)
          {
            commit: { oid: 'sha-2', authors: { nodes: [{ user: { databaseId: 222 } }] }, signature: { isValid: true } },
          },
          // Invalid (ID 3 - Not in allowed list)
          {
            commit: { oid: 'sha-3', authors: { nodes: [{ user: { databaseId: 333 } }] }, signature: { isValid: true } },
          },
          // Valid ID, Invalid Signature
          {
            commit: {
              oid: 'sha-4',
              authors: { nodes: [{ user: { databaseId: 111 } }] },
              signature: { isValid: false },
            },
          },
        ],
      },
    },
  },
};

const ALLOWED_IDS_STR = '111, 222'; // Comma separated

// Mock JQ Logic in JS
function verify(data: MockData, allowedIdsStr: string): string[] {
  const allowedIds = allowedIdsStr.split(',').map((s) => parseInt(s.trim()));

  const nodes = data.data.resource.commits.nodes;

  return nodes
    .filter((node: CommitNode) => {
      const commit = node.commit;

      // Check Authors
      const hasBadAuthor = commit.authors.nodes.some((author: CommitAuthor) => {
        if (!author.user) return true;
        return !allowedIds.includes(author.user.databaseId);
      });

      // Check Signature
      const badSig = !commit.signature || commit.signature.isValid !== true;

      return hasBadAuthor || badSig;
    })
    .map((n: CommitNode) => n.commit.oid);
}

const result = verify(mockData, ALLOWED_IDS_STR);
console.log('Invalid Commits:', result);

if (JSON.stringify(result) === JSON.stringify(['sha-3', 'sha-4'])) {
  console.log('✅ PASSED');
} else {
  console.log('❌ FAILED');
  process.exit(1);
}
