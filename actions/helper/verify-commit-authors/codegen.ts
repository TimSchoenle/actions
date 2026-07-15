import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: 'node_modules/@octokit/graphql-schema/schema.graphql',
  // GitHub's published schema deprecates object fields whose interface declarations are
  // not deprecated (e.g. `Project.id` vs `Node.id`). graphql v17 promotes this to a hard
  // schema-validation error, which codegen surfaces via `assertValidSchema` while validating
  // our documents. We only consume this third-party schema to generate types, so we build it
  // as `assumeValid` to skip the self-consistency check while still validating our documents.
  config: {
    assumeValid: true,
  },
  documents: 'src/**/*.graphql',
  generates: {
    'src/generated/graphql.ts': {
      plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
      config: {
        onlyOperationTypes: true,
        // The action now shares the repository's `verbatimModuleSyntax`, under which a value import
        // of a type is an error. Emitting `import type` keeps the generated file compiling.
        useTypeImports: true,
      },
    },
  },
};

export default config;
