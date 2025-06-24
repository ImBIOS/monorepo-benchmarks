# Benchmarking Nx, Turbo, Lerna, and Lage
<!--
Recording:

![nx-turbo-recording](./readme-assets/turbo-nx-perf.gif) -->

Repo contains:

1. 5 shared buildable packages/libraries with 250 components each
2. 5 Next.js applications built out of 20 app-specific libraries. Each app-specific lib has 250 components each. Each
   library uses the shared components.

Combined there are about 26k components. It's a lot of components, but they are very small. This corresponds to a medium
size enterprise repo. A lot of our clients have repos that are 10x bigger than this, so this repo isn't something out or
ordinary. And, the bigger the repo, the bigger the difference in performance between Nx and Turbo.

The repo has Nx, Turbo, Lerna and Lage enabled. They don't affect each other. You can remove one without affecting the
other one.

## Benchmark & Results (June 24, 2025)

Run `pnpm run benchmark`. The benchmark will warm the cache of all the tools. We benchmark how quickly
Turbo/Nx/Lage/Lerna can figure out what needs to be restored from the cache and restores it.

These are the numbers using GitHub Actions runner:

* average lage time is: 6539.1
* average turbo time is: 49806.2
* average lerna (powered by nx) time is: 1810.1
* average nx time is: 739.6
* nx is 8.8x faster than lage
* nx is 67.3x faster than turbo
* nx is 2.4x faster than lerna (powered by nx)

### Does this performance difference matter in practice?

The cache restoration Turborepo provides is likely to be fast enough for a lot of small and mid-size repos.
What matters more is the ability to distribute any command across say 50 machines while
preserving the dev ergonomics of running it on a single machine. Nx can do it. Bazel can do it (which Nx
borrows some
ideas from). Turbo can't. This is where the perf gains are for larger repos.
See [this benchmark](https://github.com/vsavkin/interstellar) to learn more.

## Dev ergonomics & Staying out of your way

When some folks compare Nx and Turborepo, they say something like "Nx may do all of those things well, and may be
faster, but Turbo is built to stay out of you way". Let's talk about staying out of your way:

Run `nx build crew --skip-nx-cache` and `turbo run build --scope=crew --force`:

![terminal outputs](./readme-assets/turbo-nx-terminal.gif)

Nx doesn't change your terminal output. Spinners, animations, colors are the same whether you use Nx or not (we
instrument Node.js to get this result). What is also important is that when you restore things from cache, Nx will
replay the terminal output identical to the one you would have had you run the command.

Examine Turbo's output: no spinners, no animations, no colors. Pretty much anything you run with Turbo looks different (
and a lot worse, to be honest) from running the same command without Turbo.

A lot of Nx users don't even know they use Nx, or even what Nx is. Things they run look the same, they just got faster.

## Automated Daily Benchmarks

This repository runs automated benchmarks daily to track performance trends over time:

### 🤖 Automation Features

* **Daily Benchmarks**: Runs at 6 AM UTC daily via GitHub Actions
* **Dependency Updates**: Automated daily updates to latest versions of all tools (nx, turbo, lerna, lage)
* **Performance Monitoring**: Detects significant performance regressions (>10% change)
* **Automatic README Updates**: Always updates the "Benchmark & Results" section with latest data
* **GitHub Releases**: Creates/updates releases with version-based tags for easy historical tracking
* **Issue Creation**: Automatically creates GitHub issues for performance regressions

### 🏷️ Release Management

Each benchmark run automatically creates or updates a GitHub release:

* **Version-based Tags**: Tags include all tool versions (e.g., `benchmark-nx21.0.3-turbo2.5.3-lerna8.2.2-lage2.14.6`)
* **Rich Release Notes**: Detailed performance results, tool versions, and raw benchmark data
* **Historical Tracking**: Easy to find and compare results across different tool versions
* **Automatic Updates**: If a release already exists for the current tool versions, it gets updated

### 📊 Manual Benchmark

You can also run benchmarks manually:

```bash
# Regular benchmark with console output
pnpm run benchmark

# JSON benchmark for automation (TypeScript compiled)
pnpm run benchmark:json

# TypeScript development (run directly with tsx)
pnpm run benchmark:json:ts
```

### 🛠️ TypeScript Development

The automation scripts are built with TypeScript for better type safety and developer experience:

**Development Commands:**

* `pnpm run benchmark:json:ts` - Run TypeScript benchmark directly with tsx
* `pnpm run test:automation:ts` - Run TypeScript tests directly
* `pnpm run build:scripts` - Compile TypeScript scripts to JavaScript
* `pnpm run build:scripts:watch` - Watch mode compilation
* `pnpm run compare:results:ts` - Run TypeScript comparison directly
* `pnpm run create:release:ts` - Generate release information from benchmark results

**File Structure:**

* **`benchmark-json.ts`** - TypeScript version with strict types
* **`scripts/compare-and-update-readme.ts`** - Compares results and updates README
* **`scripts/create-release.ts`** - Generates GitHub releases with version-based tags
* **`scripts/test-compare.ts`** - Test suite for automation functions
* **`scripts/types.ts`** - Shared type definitions and interfaces
* **`dist/*.js`** - Compiled JavaScript (auto-generated, ignored by git)

**TypeScript Configuration:**

* **`tsconfig.scripts.json`** - TypeScript config for automation scripts
* Uses strict mode, modern target (ES2020), CommonJS modules for Node.js compatibility

### 🔧 Dependency Management

The repository uses:

* **Dependabot**: For automated dependency PRs
* **Daily Update Workflow**: Aggressive updates to ensure we're testing latest versions
* **Compatibility Testing**: Benchmarks run after updates to ensure everything works

### 📈 Performance Tracking

Results are automatically tracked and compared:

* Stores previous results for comparison
* Detects trends and significant changes
* Updates README only when meaningful changes occur
* Creates alerts for regressions

## Found an issue? Send a PR

If you find any issue with the repo, with the benchmark or the setup, please send a PR. The intention isn't to cherry
pick some example where Turbo doesn't do well because of some weird edge case. If it happens that the repo surfaces some
edge case with how turbo works, send a PR, and let's fix it. We tried to select the setup that Turbo should handle
well (e.g., Next.js apps). The repo doesn't use any incrementality which Nx is very good at. We did our best to make it
fair.
