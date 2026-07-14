import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: 'node_modules/@octokit/graphql-schema/schema.graphql',
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
