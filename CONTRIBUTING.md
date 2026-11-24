# Contributing to seeqlite

## Setup and checks

Use pnpm 11 and a Node.js version supported by the workspace. [Workspace manifest](./package.json)

Run the same checks as CI from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

`pnpm check` runs Biome and TypeScript. The test suite compares the reader against `node:sqlite` on databases from SQLite, sql.js, and SQLittle. [Fixture sources and cases](./packages/seeqlite/tests/fixtures/README.md)

## Benchmarks

With Google Chrome installed, run `pnpm bench` from the repository root. Vitest runs the TypeScript source in Node and headless Chrome. Both read the same snapshot of 40,000 event rows and 40 overflow blobs. Before timing, each runtime checks the full JSON against a digest generated with `node:sqlite`.

The comparison table reports mean latency and percentiles in milliseconds. The two fastest workloads batch reads so Chrome's timer can resolve them. For a per-operation mean, divide the open-and-list result by 500 and the ten-row preview result by 100. The scan, `toJSON()`, and `JSON.stringify()` results each measure one operation per sample.
