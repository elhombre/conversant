# Contributing

## Development Setup

1. Install dependencies:

```bash
yarn install
```

2. Copy and fill environment variables:

```bash
cp .env.example .env
```

3. Start local database and apply migrations:

```bash
docker compose up -d
yarn db:migrate:deploy
```

4. Run frontend:

```bash
yarn workspace frontend dev
```

## Quality Gates

Run before opening a pull request:

```bash
yarn lint
yarn check-types
yarn build
```

## Commit Messages

- Use Conventional Commits format.
- Keep one logical change per commit.

## Pull Requests

- Describe what changed and why.
- Include screenshots/GIFs for UI changes.
- Mention any env or migration changes explicitly.
