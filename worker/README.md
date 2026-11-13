# EndPkg Worker

Cloudflare Worker API und D1-Schema.

## Dateien

- `src/header.js`: reiner Parser für EndPkg-Metadaten
- `src/index.js`: öffentliche Lese-API und eingeschränkter Quell-Download
- `schema.sql`: D1-Schema
- `test/`: automatisierte Node-Tests

## Test

```bash
npm test
```

## D1

`schema.sql` im D1 SQL-Editor ausführen. Danach D1 als Binding `DB` mit dem Worker verbinden.

## Deploy

`database_id` in `wrangler.toml` ersetzen, dann:

```bash
npm install
npx wrangler deploy
```

Das Projekt verwendet kein R2.
