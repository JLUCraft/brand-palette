# Brand Palette

Derives brand colors, semantic tokens, contrast reports, and web, Chakra UI, and Compose themes from emblem inputs. Image processing runs locally.

## Setup and structure

`brands/<id>/brand.json` is the brand definition of record. Generated theme files must be regenerated from it. Install dependencies with `bun install --frozen-lockfile`; use `bun run dev` for the palette interface and `bun run palette --help` for CLI options. Emblem originals stay outside source control.

Keep consumer checkouts beside this repository. [scripts/check-consumers.ts](scripts/check-consumers.ts) defines the generated files checked against the brand manifest. CI recreates that layout and checks the current consumer branches, including `folly` for FollyLauncher. Missing or changed generated files fail the check; it does not rewrite them.

## Validation

Select one validation channel for a batch and reuse successful results for unchanged inputs. Standard commands:

```sh
bun run build
bun run test
bun run check:consumers
```

Read [AGENTS.md](AGENTS.md) before making changes.
