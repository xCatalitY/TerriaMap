@AGENTS.md

## Subdirectories

| Directory                | What                                                             | When to read                                          |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `lib/`                   | App-specific core logic, React views, and Sass styles            | Modifying UI, adding catalog behavior                 |
| `wwwroot/`               | Static assets, init configs, fixture data, and built output      | Adding catalog items, modifying client config         |
| `buildprocess/`          | Webpack and build tooling                                        | Modifying build configuration                         |
| `deploy/`                | Helm charts and deployment manifests                             | Deploying TerriaMap, modifying deployment config      |
| `services/`              | Server-side adapter services (OpenSky live aircraft)             | Adding live data sources, modifying adapter behavior  |
| `plans/`                 | Implementation plans with decision logs and architecture context | Understanding why features are structured as they are |
| `types/`                 | TypeScript declaration files                                     | Adding or modifying type declarations                 |
| `doc/`                   | Deployment and operational documentation                         | Deploying or operating TerriaMap                      |
| `ckanext-cesiumpreview/` | Separate CKAN plugin with its own Python test surface            | Modifying CKAN preview integration                    |
| `architecture/`          | Architecture diagrams and cross-cutting design documentation     | Understanding system-level design decisions           |
