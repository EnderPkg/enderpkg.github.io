# EndPkg

EndPkg ist ein Paketmanager- und Registry-Projekt für CC:Tweaked (Lua).

Dieses Repository enthält das technische Grundgerüst:
- Cloudflare Worker als API (kein eigener Server erforderlich)
- Cloudflare D1 für Paketmetadaten
- GitHub und Pastebin als externe Quellen
- kein Cloudflare R2 und kein eigener Dateispeicher
- strenge EndPkg-Header-Erkennung und automatisierte Tests

> **Status:** Entwicklungsgrundgerüst, noch kein vollständiger öffentlicher Paketmanager.
> Der globale Quell-Scanner, der Veröffentlichungsprozess, Missbrauchsschutz und produktive
> Betriebsüberwachung müssen noch ergänzt und geprüft werden. Automatische technische
> Prüfungen sind keine Sicherheitsgarantie für Lua-Code.

## Repository-Struktur

```text
.
├── .github/workflows/test.yml
├── README.md
├── index.html
└── worker/
    ├── README.md
    ├── package.json
    ├── wrangler.toml
    ├── schema.sql
    ├── src/
    │   ├── header.js
    │   └── index.js
    └── test/
        ├── header.test.js
        └── worker.test.js
```

## EndPkg-Paketformat

Die erste Zeile muss exakt `-- #enderpkg` lauten. Der Header endet mit einer Leerzeile
oder der ersten Nicht-Kommentarzeile. Maximal 20 Headerzeilen sind erlaubt.

```lua
-- #enderpkg
-- #name: "Example Package"
-- #author: "ExampleAuthor"
-- #version: "1.0.0"
-- #description: "An example CC:Tweaked package"
-- #license: "MIT"
-- #platform: "cc-tweaked"
-- #dependencies: [
--   "library-a@^1.2.0",
--   "library-b@~2.0.0"
-- ]

print("Hello from EndPkg!")
```

Metadatenwerte sind JSON-Werte. `name`, `author` und `version` sind Pflichtfelder.
Abhängigkeiten sind Paket-Slugs mit Versionsangaben, keine URLs.

## Lokal testen

Voraussetzung: Node.js 22 oder neuer.

```bash
cd worker
npm test
```

## Cloudflare vorbereiten

1. Eine D1-Datenbank anlegen.
2. Die D1-Datenbank-ID in `worker/wrangler.toml` eintragen.
3. `worker/schema.sql` in der D1-Datenbank ausführen.
4. Im Worker-Binding muss `DB` auf diese D1-Datenbank zeigen.
5. `CORS_ORIGIN` in `wrangler.toml` auf die tatsächliche Website setzen.
6. Aus `worker/` deployen: `npx wrangler deploy`.

Das Grundgerüst verwendet **kein R2**. Die Download-Route ruft eine registrierte GitHub-Raw-
oder Pastebin-Raw-Quelle ab. Sie ist kein beliebiger URL-Proxy.

## API im Grundgerüst

- `GET /api/health`
- `GET /api/packages`
- `GET /api/packages/:slug`
- `GET /api/packages/:slug/:version/download`

Nur veröffentlichte Versionen werden in öffentlichen Registry-Abfragen angezeigt.

## Wichtige Grenzen

- GitHub-Code-Suche ist nicht gleichbedeutend mit einer vollständigen Suche über alle
  öffentlichen Repositories. Sie hat Authentifizierungs- und Ratenlimit-Bedingungen.
- Eine Pastebin-Raw-URL lädt einen bekannten Paste ab; sie bietet keine allgemeine
  öffentliche Paste-Discovery.
- Deshalb enthält dieses Grundgerüst noch keinen behaupteten „finde alles“-Scanner.
  Als nächster Schritt wird ein kontrollierter Einreichungs- und Scanprozess ergänzt.
- Die Download-Route erlaubt nur HTTPS-Quellen von `raw.githubusercontent.com`,
  `github.com` (Raw-Pfade) und `pastebin.com` (Raw-Pfade). Redirects werden nicht verfolgt.
- Hash-Prüfung, Größenlimits und technische Veröffentlichungskontrollen müssen vor einem
  öffentlichen Produktivbetrieb vollständig in den Scan-/Publish-Prozess eingebunden werden.
- Syntax- und Metadatenprüfungen beweisen nicht, dass ein Lua-Paket sicher ist.

## Lizenz

Noch nicht festgelegt. Vor einer öffentlichen Veröffentlichung eine Projektlizenz wählen.
