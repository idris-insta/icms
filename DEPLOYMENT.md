# ICMS — Server Deployment

The application ships as a single Docker image (API + built React SPA on one
origin) plus a MariaDB container.

## Install

On the server, with Docker installed:

```bash
git clone <your-repo> icms && cd icms && ./install.sh
```

`install.sh` generates `.env` with random secrets, builds the image, starts
MariaDB and the app, applies the schema, and waits for the health check.

Options:

```bash
./install.sh --port 9000
./install.sh --migrate-from-postgres postgresql://icms_user:pass@host:5432/icms
```

First sign-in is `owner@icms.com` / `owner123`. **Change it immediately** under
Settings → Users.

## Migrating existing PostgreSQL data

`migrate-to-mariadb.js` copies every table, preserves primary keys so foreign
keys stay intact, and verifies row counts on both sides afterwards. It is
re-runnable — rows upsert rather than collide.

The migration runs inside the app container, so the PostgreSQL server must be
reachable from there. If PostgreSQL is on the Docker host, it must listen on
more than `127.0.0.1` (`listen_addresses` in `postgresql.conf` plus a matching
`pg_hba.conf` rule) and you address it as `host.docker.internal`. Otherwise
point `PG_URL` at its LAN address.

```bash
docker compose exec -e PG_URL=postgresql://user:pass@host.docker.internal:5432/icms \
  app node migrate-to-mariadb.js
```

## Day-to-day

```bash
docker compose ps            # status
docker compose logs -f app   # follow logs
docker compose restart app   # restart the API
docker compose down          # stop (volumes and data are kept)
./backup.sh                  # dump database + uploads into ./backups
```

`GET /api/health` reports process and database status without authentication —
point your uptime monitor at it.

## AI features (agent chat + OCR field extraction)

OCR works without any AI: the regex layer pulls B/L number, invoice number,
vessel, ports, ETD/ETA, container and seal numbers, weight, CBM, cartons, amount,
currency and incoterm straight out of a PDF text layer. AI is only used for
scanned images with no text layer, and to fill fields the rules miss.

The agent and image OCR need Ollama. Inside a container `localhost` is the
container, so:

* Run Ollama listening beyond loopback: `OLLAMA_HOST=0.0.0.0 ollama serve`
* Leave `OLLAMA_URL` at its default (`http://host.docker.internal:11435`) for a
  host install, or point it at wherever Ollama runs.
* A value saved in Settings → AI overrides the environment.

Pick a model the machine can actually serve. On CPU, an 8B model took 105s for
one short answer here and larger models exceeded the 180s ceiling. Raise
`AI_TIMEOUT_MS` or use a GPU host if answers time out; the API returns a clear
504 explaining which it was rather than hanging.

## Behind a reverse proxy

Terminate TLS at nginx/Caddy and forward to the published port. Keep
`TRUST_PROXY=true` so client IPs come from `X-Forwarded-For` (the login rate
limiter depends on it). `CORS_ORIGINS` stays empty as long as the SPA is served
by the API — same-origin requests are always allowed.

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Notes on the MariaDB migration

The application's SQL was written for PostgreSQL. Rather than hand-porting ~370
call sites, `src/db/dialect.js` translates at the driver boundary: `$n`
placeholders, `::casts`, `date_trunc`, `to_char`, `INTERVAL 'n days'`,
`ON CONFLICT`, aggregate `FILTER (WHERE …)`, and `RETURNING` (which MariaDB does
not support on `UPDATE`) are all handled there. Constructs that could not be
translated safely — `LATERAL` joins, `DISTINCT ON`, and the jsonb operators —
were rewritten by hand in the route files.

Two isolation details are load-bearing and should not be "cleaned up":

* MariaDB runs in **READ COMMITTED**, set both on the server and per connection.
  MariaDB's REPEATABLE READ default would let a transaction that waits on a row
  lock still read its pre-wait snapshot, which hands two concurrent requests the
  same PO number.
* `import_orders.updated_at` is `TIMESTAMP(6)`. It doubles as the row version
  for optimistic concurrency; at whole-second resolution two edits in the same
  second compare equal and one is silently lost.

Setting `DB_CLIENT=pg` with a `DATABASE_URL` still runs the app against
PostgreSQL, which is useful as a rollback during cutover. The tracking-updates
endpoint uses MariaDB JSON functions and is the one part that will not work in
that mode.

## Verification

Four suites run against a deployed instance:

```bash
ICMS_BASE=http://127.0.0.1:8080 ./verify.sh
```

| Suite | What it proves |
| --- | --- |
| `dialect.test.js` | The SQL translator handles every construct the routes use (run standalone: `cd icms-backend && node dialect.test.js`). |
| `smoke.py` | Every endpoint returns 200, and the create / update / duplicate / tracking / status / settings write paths work. |
| `race_test.py` | Simultaneous PO allocation yields distinct numbers; two clients editing one order cannot both win; a schedule cannot generate the same shipment twice. |
| `search_test.py` | Order search actually filters, and list totals are read back correctly. |
| `json_test.py` | `doc_checklist` and `tracking_updates` come back as objects/arrays, not strings. |
| `authz_test.py` | Unauthenticated and cross-role requests are rejected, and deactivating a user invalidates their existing token. |
| `import_test.py` | Excel order import (multi-item POs, dates, brand/notes/sqm), CSV master import (idempotent upsert), document upload/download round-trip, and the fields the print view needs. |
| `ai_test.py` | Ollama reachability, OCR field extraction from a Bill of Lading, and agent Q&A. A slow local model reports a warning, not a failure — answer latency is a property of the host. |

**The suites write real rows** — they create orders, duplicate them, and edit
them. Run them against a staging instance, or reset afterwards with
`docker compose down -v && docker compose up -d && ./migrate-from-postgres.sh`.

The search and JSON suites exist because those were genuine PostgreSQL→MariaDB breakages that
a plain endpoint sweep did not catch: `ILIKE` has no MariaDB equivalent, a bare
`COUNT(*)` is returned under a different column name, and MariaDB hands JSON
columns back as text where PostgreSQL's `jsonb` returned parsed values.
