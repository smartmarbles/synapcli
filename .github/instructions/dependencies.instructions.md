---
description: 'Dependency version and footprint conventions for SynapCLI'
applyTo: 'package.json'
---

# Dependency Conventions

- All dependency versions are pinned exactly (no `^` or `~`)
- `@types/*` packages: major.minor should match the corresponding package where a matching version exists on npm
- **Minimise the dependency footprint** — before adding a new package:
  - If the functionality is already provided by a transitive dependency (e.g. a sub-package of something already installed), use that directly rather than adding a new top-level dependency
  - If only a single small function is needed, implement it inline rather than pulling in a package
  - New packages must justify their weight: broad functionality used in multiple places
