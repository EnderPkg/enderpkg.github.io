
# EndPkg API

Backend for the EndPkg package manager.

## Requirements

- Node.js
- Cloudflare account
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2

## Install

```bash
cd worker
npm install
```

## Development

```bash
npm run dev
```

## Database

Create the D1 database and configure its ID in wrangler.toml.

Initialize the schema:

```bash
npm run db:init
```

## Deploy

```bash
npm run deploy
```

## API

- GET /api/health
- GET /api/packages
- GET /api/packages?search=name
- GET /api/packages/:slug
- GET /api/packages/:slug/:version/download
- POST /api/submissions

New submissions are stored wit
h pending status.
