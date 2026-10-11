# Config wizard output

Every JSON file here is a config fragment the config wizard (B33) can emit, merged into the
user's db-sync config file. `npm run check:config` validates each one against the schema the
binary parses (`generated/config-schema.json`, B10) and fails the build, naming the key, if the
wizard could hand out an option db-sync does not read or a value it rejects (CON-4).

- `step1-*.json` — the four use-case choices on step 1 and the preset each one sets.
- `design-wallet-utxo.json` — the `Config · 6 Result` design's emitted config (Wallet / UTxO,
  prune spent outputs, LSM backend).

When the wizard is built, its output generator writes every combination it can produce here (or
its tests call `validateConfig` from `../config-schema.mjs` with `{fragment: true}`) so the gate
covers everything a user can copy.
