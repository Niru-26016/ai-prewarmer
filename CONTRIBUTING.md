# Contributing to AI Prewarmer

Thanks for your interest in contributing! Whether you are fixing bugs, improving docs, adding new provider support, or refining the UI, contributions are welcome.

## Development Workflow

### Prerequisites

- **Node.js**: `22.x` (see `.nvmrc`)
- **npm**: `10.x` or newer
- **Git**

### Getting Started

1. **Fork & clone the repository**:

   ```bash
   git clone https://github.com/<your-username>/ai-prewarmer.git
   cd ai-prewarmer
   ```

2. **Install dependencies**:

   ```bash
   npm ci
   ```

3. **Initialize local development secrets**:

   ```bash
   npm run local:setup
   ```

   This generates a local `.dev.vars` file with random secrets for local mock testing.

4. **Start the local development server**:
   ```bash
   npm start
   ```
   Open `http://127.0.0.1:8787` in your browser. Use the generated `ADMIN_PASSWORD` from your `.dev.vars` file to log in. In local mode, executions are mocked and will not contact external model APIs.

## Testing and Verification

Before submitting a pull request, make sure all test suites and quality gates pass:

```bash
# Run lint, format check, TypeScript typecheck, unit tests, and worker tests
npm run check

# Format code automatically
npm run format

# Run Playwright end-to-end tests
npx playwright install chromium
npm run test:e2e
```

## Pull Request Guidelines

1. Create a descriptive feature branch: `git checkout -b feature/my-new-feature`.
2. Keep changes focused and atomic.
3. Update tests and documentation for any user-facing or architectural changes.
4. Ensure `npm run check` and `npm run test:e2e` pass with zero errors.
5. Submit your PR with a clear summary of what changed and how you verified it.
