```bash

 ┌─────────────────────────┐      ┌──────────────────────────┐
 │  GitHub Actions Runner  │      │ GitHub Encrypted Secrets │
 │  (microchess-pages.yml) │      │   (Repository Settings)  │
 └────────────┬────────────┘      └────────────┬─────────────┘
              │                                │
              │ 1. Spawns Ubuntu-Latest VMs     │
              ├────────────────────────────────┘
              ▼
  [ INJECT PIPELINE VARIABLES ]
  Maps context keys into build env variables:
    - NODE_ENV = production
    - JSONBIN_ACCESS_KEY = ${{ secrets.JSONBIN_ACCESS_KEY }}
    - JSONBIN_BIN_ID     = ${{ secrets.JSONBIN_BIN_ID }}
              │
              ▼
 ┌─────────────────────────┐
 │     WEBPACK ENGINE      │ ◄─── Reads entry point: microchess/js/index.js
 │  (webpack.config.js)    │
 └────────────┬────────────┘
              │
              │ 2. Webpack DefinePlugin acts as an inline text compiler.
              │    It scans index.js code and replaces generic expressions:
              │      - process.env.JSONBIN_ACCESS_KEY  ──► "SECRET_ACCESS_KEY_STRING"
              │      - process.env.JSONBIN_BIN_ID      ──► "SECRET_BIN_ID_STRING"
              ▼
 ┌─────────────────────────┐
 │   microchess/dist/      │
 │      bundle.js          │ ◄─── Raw string values are baked here safely.
 └────────────┬────────────┘      Your source code stays 100% clean of keys.
              │
              ▼
 ┌─────────────────────────┐
 │  VIRTUAL TREE STAGING   │
 │    (pages/ directory)   │
 └────────────┬────────────┘
              │ 3. Generates layout structure matching local system path paths:
              ├─► microchess.html      ──► pages/index.html   (Domain Homepage)
              ├─► microchess/dist/*    ──► pages/dist/*       (Houses compiled bundle.js)
              └─► randomchess.json     ──► pages/randomchess.json (CI Local Snapshot)
              │
              ▼
 ┌─────────────────────────┐
 │   GITHUB PAGES SERVERS  │
 └────────────┬────────────┘
              │
              │ 4. Deploys virtual bundle package files live onto web nodes.
              ▼
 ┌─────────────────────────┐
 │   End User's Browser    │
 │ (Public Dashboard URL)  │
 └─────────────────────────┘
        │
        └─► Natively requests: ./dist/bundle.js
            Natively executes secure direct connections out to JSONBin APIs!
```
