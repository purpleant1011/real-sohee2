/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-legacy-imageworker-in-production-chat',
      severity: 'error',
      comment: 'Production chat route and tool runtime must not import legacy ImageWorker',
      from: {
        path: '^(src/app/api/workspaces/.*/agent/chat/route\\.ts|src/features/tool-runtime/dispatchers/content-dispatcher\\.ts)$'
      },
      to: {
        path: 'src/lib/ai/image-worker\\.ts$'
      }
    },
    {
      name: 'no-raw-images-in-publishing',
      severity: 'error',
      comment: 'Production publishing routes must not import test fixtures or mock publishers',
      from: {
        path: '^src/app/api/workspaces/.*/publishing/'
      },
      to: {
        path: 'tests/|fixtures/|__tests__/'
      }
    },
    {
      name: 'no-tests-in-production',
      severity: 'error',
      comment: 'Production source code must never import test files, mocks, or fixtures',
      from: {
        path: '^src/',
        pathNot: '\\.(spec|test)\\.(ts|tsx)$'
      },
      to: {
        path: '(tests/|__tests__/|fixtures/)'
      }
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies should be avoided',
      from: {},
      to: {
        circular: true
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json'
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default']
    }
  }
};
