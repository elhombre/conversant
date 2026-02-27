# Conversant Monorepo

Research prototype for the Conversant voice UX project.

## Stack

- Turborepo
- Yarn Berry (PnP)
- Next.js App Router (`apps/frontend`)
- shadcn/ui components
- Biome (no ESLint/Prettier)

## Workspace Layout

- `apps/frontend` - UI shell and voice interaction prototype

## Commands

Run from repository root (`code`):

- `yarn dev` - start development tasks
- `yarn build` - build all workspaces
- `yarn lint` - run Biome checks through Turbo
- `yarn format` - run Biome format through Turbo
- `yarn check-types` - run type checks through Turbo

## Current Milestone

Stage 0 baseline shell is implemented in `apps/frontend`:

- FSM status indicators
- Microphone initialization and live input level meter
- `Reset Session` and `Mute/Resume` controls
- Debug panel with timings and runtime text placeholders
- Simulation control for local validation before STT/LLM/TTS integration
