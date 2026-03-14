# Repository Guidelines

## Project Structure & Module Organization

`entry.js` boots the UI, while `index.js` configures TerriaJS startup and application state. Main source lives in `lib/`: `Core/` for app-specific logic, `Views/` for React UI, and `Styles/` for Sass variables and shared styling. Type declarations live in `types/`. Static assets, `index.ejs`, init configs, and fixture data live in `wwwroot/`, with sample datasets under `wwwroot/test/`. Build tooling is in `buildprocess/` and `gulpfile.js`. Deployment material is in `deploy/` and `doc/deploying/`. `ckanext-cesiumpreview/` is a separate CKAN plugin with its own Python test surface.

## Build, Test, and Development Commands

Use Node `>=20` and Yarn.

- `yarn install --frozen-lockfile`: install dependencies exactly as locked.
- `yarn gulp dev`: watch sources, rebuild incrementally, and run `terriajs-server` on port `3001`.
- `yarn gulp build`: create a development bundle in `wwwroot/build/`.
- `yarn gulp release`: create the production bundle used by CI.
- `yarn gulp lint`: run ESLint on `index.js` and `lib/`.
- `yarn start`: serve the existing build using `serverconfig.json`.
- `yarn prettier-check` or `yarn prettier`: verify or rewrite formatting.

## Coding Style & Naming Conventions

Follow `.editorconfig`: 2-space indentation, UTF-8, trimmed trailing whitespace, final newline. Prettier is the formatting source of truth, with `trailingComma: none`; staged files are auto-formatted by Husky via `pretty-quick`. ESLint extends `terriajs/.eslintrc.js`, and CI treats warnings as failures. Match existing naming patterns: React components in PascalCase (`Loader.tsx`), stores/utilities in camelCase (`terriaStore.ts`), and Sass modules next to related views or under `lib/Styles/`.

## Testing Guidelines

The root CI check is `yarn gulp lint release` on Node 20, 22, and 24; run that before opening a PR. `wwwroot/test/` contains fixture files, not a standalone root test suite. Legacy browser specs are referenced by `wwwroot/SpecRunner.html`; only touch that path if you are maintaining the old Jasmine flow. For changes inside `ckanext-cesiumpreview/`, add or update tests under `ckanext/cesiumpreview/tests/` and run them in a CKAN test environment.

## Commit & Pull Request Guidelines

Git history favors short, imperative subjects such as `Upgrade terriajs and terriajs-cesium.` or `Mark default proxy domains in serverconfig.json as deprecated.` Keep release/version bumps separate from feature work when possible. PRs should describe user-visible changes, note config or deployment impact, link related issues, and include screenshots for UI changes in `lib/Views` or `wwwroot`. Wait for GitHub Actions CI to pass before requesting review.
