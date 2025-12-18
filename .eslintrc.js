module.exports = {
    ignorePatterns: ['repo-scan-dashboard-main/dist/**'],
    env: { node: true, es2020: true },
    // parser: '@typescript-eslint/parser', // Parser will be set in overrides
    // parserOptions: { // Parser options will be set in overrides
    //   project: ['./tsconfig.json', './repo-scan-dashboard-main/tsconfig.eslint.json'],
    //   sourceType: 'module',
    // },
    plugins: [
      '@typescript-eslint/eslint-plugin',
      'sonarjs',
      'unicorn',
      'import',
    ],
    extends: [
      'eslint:recommended',
    ],
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx']
        },
      },
      react: { // Add React version detection for React-specific rules
        version: "detect"
      }
    },
    rules: {},
    overrides: [
      // Override for Node.js CommonJS scripts across the repo (outside the TS app)
      {
        files: [
          '*.js',
          'bin/**/*.js',
          'scripts/**/*.js',
          'packages/dev-tools/**/*.js',
        ],
        excludedFiles: [
          'repo-scan-dashboard-main/**',
        ],
        parser: 'espree',
        env: { node: true, es2020: true },
        parserOptions: { ecmaVersion: 2020, sourceType: 'script' },
        rules: {
          'unicorn/*': 'off',
          'sonarjs/*': 'off',
          'import/*': 'off',
          'no-empty': 'off',
          'no-undef': 'off',
          'complexity': 'off',
          'max-lines-per-function': 'off',
          'max-params': 'off',
          'max-depth': 'off',
        },
      },
      {
        files: ['repo-scan-dashboard-main/**/*.{ts,tsx}'], // Apply TypeScript-specific rules only to TS/TSX files
        excludedFiles: [
          'repo-scan-dashboard-main/dist/**', // Exclude compiled output
          'repo-scan-dashboard-main/vite.config.ts', // Handle with JS-like override below
        ],
        parser: '@typescript-eslint/parser', // Explicitly set parser for TS/TSX
        parserOptions: {
          project: 'repo-scan-dashboard-main/tsconfig.eslint.json', // Point to the new unified tsconfig for linting
          tsconfigRootDir: __dirname, // Resolve tsconfig from project root
          sourceType: 'module',
        },
        extends: [ // TS rules without heavy type-checking set
          'plugin:@typescript-eslint/recommended',
        ],
        rules: {
          // Relax noisy rules for the TS app
          'unicorn/*': 'off',
          'sonarjs/*': 'off',
          'import/*': 'off',
          'complexity': 'off',
          'max-lines-per-function': 'off',
          'max-depth': 'off',
          'max-params': 'off',
          '@typescript-eslint/no-unused-vars': 'off',
        },
      },
      // Override for CommonJS scripts that use require and other CJS features
      {
        files: [
          'repo-scan-dashboard-main/scripts/**/*.js',
          'repo-scan-dashboard-main/*.config.js',
          'repo-scan-dashboard-main/postcss.config.js',
          'repo-scan-dashboard-main/vite.config.ts'
        ],
        extends: ['eslint:recommended'], // Only basic JS rules for these files
        // Use a simpler parser that doesn't require a TypeScript project
        parser: 'espree', // Or '@babel/eslint-parser' if React/JSX is involved in these JS files
        parserOptions: {
          ecmaVersion: 2020,
          sourceType: 'module', // Can be 'script' or 'module' depending on the file
        },
        rules: {
          // Relax rules for these files
          'unicorn/*': 'off',
          'import/*': 'off',
          'sonarjs/*': 'off',
          'no-undef': 'off',
          'no-empty': 'off',
        },
      },
      // File-specific override for the HTML report generator with many escaped quotes
      {
        files: ['generate-html-lint-report.js'],
        rules: {
          'no-useless-escape': 'off',
        }
      },
    ],
  };
