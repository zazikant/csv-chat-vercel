# Architecture — Email Campaign Tracker

This document covers the complete architecture of the Email Campaign Tracker app: database schema, triggers, API routes, dedup logic, identity-field sync, and the LLM chat agent.

> **Quick links**
> - [Setup instructions](README.md) — install, configure env vars, run
> - [Schema SQL](migration_schema.sql) — full DDL (run in Supabase SQL Editor)
> - [Schema v3 migration](SCHEMA_V3_MULTIPLE_EMAILS.sql) — change PK from `email` to `id` (multiple rows per email)

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind CSS v4 |
| Backend | Next.js API routes (Node.js runtime) |
| Database | Supabase (PostgreSQL) |
| LLM | NVIDIA integrate API (`nvidia/nemotron-3-super-120b-a12b`) via raw fetch + SSE |
| AI orchestration | LangGraph (state machine for intent → SQL → execute → format) |

No OpenAI SDK at runtime — the NVIDIA client (`lib/nvidia.ts`) uses raw `fetch` + Server-Sent Events parsing.

---

## 2. Database Schema (v3)

### Table: `contacts`

Multiple rows per email are allowed (one row per mailer). The primary key is `id` (auto-incrementing), not `email`.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | Auto-incrementing primary key |
| `email` | text NOT NULL | Not unique — multiple rows per email allowed |
| `name` | text | Identity field (synced across all rows with same email) |
| `company` | text | Identity field (synced) |
| `designation` | text | Identity field (synced) |
| `phone` | text | Identity field (synced) |
| `city` | text | |
| `sector` | text | |
| `optin_status` | text | `Subscribed` / `Hard Bounced` / `Unsubscribed` |
| `mailer_id` | text FK → `mailers.mailer_id` | Which mailer this row tracks. NULL = unassigned |
| `opens` | integer | Manual count of opens for this (email, mailer) |
| `clicks` | integer | Manual count of clicks for this (email, mailer) |
| `tags` | text[] | Free-form categorization tags |
| `last_activity_date` | timestamptz | Auto-maintained by trigger |
| `engagement_score` | text | Auto: `HOT` (clicks>0) / `WARM` (opens>0) / `COLD` |
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto |

**Constraints:**
- Primary key: `id`
- Unique: `(email, mailer_id)` — prevents exact duplicates, allows same email with different mailers

**Indexes:**
- `contacts_email_idx` on `email`
- `contacts_company_idx`, `contacts_name_idx`, `contacts_mailer_id_idx`
- `contacts_engagement_idx`, `contacts_optin_idx`
- `contacts_tags_gin_idx` (GIN) on `tags` for fast tag search

### Table: `mailers`

| Column | Type | Notes |
|---|---|---|
| `mailer_id` | text PK | e.g. `M001`, `M002` |
| `subject_line` | text NOT NULL | The email subject line |
| `template_name` | text | Which email design was used |
| `sent_date` | timestamptz | When the blast was sent |
| `total_sent` | integer | Auto: count of contacts with this `mailer_id` |
| `unique_opens` | integer | Auto: count of contacts with this mailer_id AND opens>0 |
| `total_opens` | integer | Auto: sum of opens |
| `unique_clicks` | integer | Auto: count of contacts with this mailer_id AND clicks>0 |
| `total_clicks` | integer | Auto: sum of clicks |
| `unsubscribed_count` | integer | Auto: count where `optin_status='Unsubscribed'` |
| `hardbounced_count` | integer | Auto: count where `optin_status='Hard Bounced'` |
| `open_rate` | numeric(5,2) GENERATED | `unique_opens / total_sent * 100` |
| `click_rate` | numeric(5,2) GENERATED | `unique_clicks / total_sent * 100` |
| `unsubscribe_rate` | numeric(5,2) GENERATED | `unsubscribed_count / total_sent * 100` |
| `hardbounce_rate` | numeric(5,2) GENERATED | `hardbounced_count / total_sent * 100` |

All counter columns are **auto-maintained by a trigger** on `contacts`. Never write to them directly.

### RPCs (stored functions)

| Function | Purpose |
|---|---|
| `recompute_mailer_counters(p_mailer_id text)` | Recomputes all counters for a mailer from the contacts table |
| `run_select_query(query_text text)` | Server-side SQL SELECT runner (used by chat agent + SQL Query Box) |
| `get_tag_counts()` | Returns distinct tags with usage counts (for smart suggestions) |
| `cleanup_old_data()` | Daily cleanup: drops stale tables, runs ANALYZE |

---

## 3. Triggers

### `trg_contacts_rollup` (BEFORE INSERT OR UPDATE)

Function: `contacts_before_trigger()`

Sets auto-maintained fields on the NEW row:
- `last_activity_date` — set to `now()` if opens>0 or clicks>0, else NULL
- `engagement_score` — `HOT` if clicks>0, `WARM` if opens>0, `COLD` otherwise
- `updated_at` — set to `now()`
- `tags` — normalized: trim + lowercase + dedupe + **sort** (so tag order doesn't cause spurious updates)

**Critical:** For DELETE, returns `old` (not `new` which is NULL — returning NULL from a BEFORE DELETE trigger cancels the delete).

### `trg_contacts_after` (AFTER INSERT OR UPDATE OR DELETE)

Function: `contacts_after_trigger()`

Recomputes the affected mailer's counters after every contact change:
- On INSERT/UPDATE: recompute the mailer referenced by `new.mailer_id`
- On UPDATE with mailer_id change: recompute BOTH old and new mailers
- On DELETE: recompute the mailer referenced by `old.mailer_id`

**Critical:** The condition uses `(v_new_mailer IS NULL OR v_old_mailer <> v_new_mailer)` — not just `v_old_mailer <> v_new_mailer` — because `'M001' <> NULL` evaluates to NULL (falsy) in SQL, which would skip the recompute on DELETE.

### `trg_mailers_touch` (BEFORE UPDATE on mailers)

Function: `touch_updated_at()`

Sets `updated_at = now()` on every mailer update.

---

## 4. API Routes

### `GET /api/contacts`
Returns all contacts, ordered by `id DESC` (newest first).

### `POST /api/contacts`
Add a new contact or update an existing one.

**Logic:**
1. Normalize email to lowercase
2. Check if a row with the same `(email, mailer_id)` already exists
3. If exists → UPDATE that row by `id`
4. If not → INSERT a new row
5. **Sync identity fields** (name/company/designation/phone) to all other rows with the same email

**Auto-creates mailer:** If `mailer_id` references a mailer that doesn't exist, a stub mailer is created automatically.

### `PUT /api/contacts`
Update a contact by `id`.

**Logic:**
1. Update the row by `id`
2. **Sync identity fields** to all other rows with the same email

### `DELETE /api/contacts`
Delete contacts by `id` or `ids`.

- `{id: 1}` — delete one row
- `{ids: [1, 2, 3]}` — delete multiple rows

### `POST /api/contacts/bulk`
CSV bulk upload with dedup logic.

**Pipeline:**
1. **Clean + validate** each row (normalize email, tags, optin_status)
2. **Auto-create mailers** that don't exist yet
3. **Fetch all existing contacts** (for dedup lookups)
4. **Pre-fill blank identity fields** from the latest existing record for that email
5. **Dedup logic** (see section 5 below)
6. **De-duplicate intra-CSV** by `(email, mailer_id)` — later row wins
7. **Insert + Update** (separate calls; updates need the `id`)
8. **Sync identity fields** across all rows with the same email

### `POST /api/query`
Run a raw SQL SELECT query (used by the SQL Query Box).

- Only SELECT statements are allowed (enforced client-side + server-side via the `run_select_query` RPC)
- Returns `{rows: [...]}`

### `GET /api/tags`
Returns distinct tags with usage counts. Used by the TagsInput component's smart-suggestion dropdown.

### `GET /api/mailers`
Returns all mailers. Supports `?values=1` for a lightweight response (just `mailer_id` + `subject_line`) used by the contact form's mailer autocomplete.

### `POST/PUT/DELETE /api/mailers`
Full CRUD for mailers. All counter/generated fields are stripped from the payload — they're auto-maintained by triggers.

### `POST /api/chat`
LangGraph chat agent. Stateless — no conversation history is persisted to Supabase (minimum disk usage). The NVIDIA API key is read from `NVIDIA_API_KEY` env var (server-only).

---

## 5. CSV Dedup Logic (v3)

The dedup key is `(email, mailer_id)`. For each CSV row:

| Condition | Action |
|---|---|
| `(email, mailer_id)` exists in DB AND all fields match exactly | **SKIP** (exact duplicate) |
| `(email, mailer_id)` exists in DB AND any field differs | **UPDATE** that row by `id` |
| `(email, mailer_id)` is new BUT the 4 identity fields (name+company+designation+phone) match an existing record with a **different email** | **SKIP** (identity match — do nothing) |
| `(email, mailer_id)` is new AND no identity match | **INSERT** a new row |

### Pre-fill behavior
Before dedup, blank identity fields (name/company/designation/phone) are auto-filled from the **latest existing record** for that email (across all mailers). If the CSV provides a non-blank value, it wins.

### Intra-CSV dedup
If the CSV itself has multiple rows with the same `(email, mailer_id)`, the **later row wins** (more recent = more authoritative). Earlier duplicates are added to `skippedRows` with reason `"duplicate (email, mailer_id) in CSV — earlier row skipped, later row wins"`.

### Response shape
```json
{
  "inserted": 5,
  "updated": 2,
  "upserted": 7,
  "skipped": 1,
  "identitySkipped": 0,
  "intraCsvDuplicates": 0,
  "skippedRows": [
    {"email": "x@y.com", "reason": "exact duplicate — no changes needed"}
  ],
  "total": 8
}
```

---

## 6. Identity Field Sync

The 4 identity fields (name, company, designation, phone) are **synced across all rows with the same email**. When you update one row's identity, all other rows for that email get the same values.

This happens in 3 places:

1. **PUT /api/contacts** (Edit form) — after updating by `id`, calls `syncIdentityFields()` which updates all other rows with the same email
2. **POST /api/contacts** (Add form) — after insert/upsert, calls `syncIdentityFields()`
3. **POST /api/contacts/bulk** (CSV upload) — Step 7 builds a map of email → latest identity fields and syncs them across all rows

The `syncIdentityFields()` helper:
- Only syncs fields that were in the update payload
- Uses `.eq('email', email).neq('id', savedId)` to update OTHER rows (not the one just saved)
- Non-fatal: if sync fails, the primary save still succeeds

---

## 7. LLM Chat Agent

### Architecture
- **Model:** `nvidia/nemotron-3-super-120b-a12b` (120B params, ~4s latency)
- **Gateway:** `https://integrate.api.nvidia.com/v1/chat/completions`
- **Client:** `lib/nvidia.ts` — raw `fetch` + SSE parsing, no OpenAI SDK
- **Orchestration:** LangGraph state machine

### LangGraph pipeline
```
schema_loader → intent_classifier → sql_generator → query_executor → response_formatter
                                        ↑                ↓
                                        └── error_recovery ←┘ (retry up to 3x)
```

1. **schema_loader** — loads the schema description (from `getTableSchema()`)
2. **intent_classifier** — classifies the query: filter/count/lookup/aggregate/sort/mailer/reset/unknown
3. **sql_generator** — generates a SELECT query based on the schema + intent
4. **query_executor** — runs the SQL via `run_select_query` RPC
5. **error_recovery** — if SQL fails, asks the LLM to fix it (up to 3 retries)
6. **response_formatter** — generates a natural-language response

### Stateless
No conversation history is persisted to Supabase. The LangGraph state machine passes `conversationHistory` in-memory within a single chat turn, but nothing is written to the database. This keeps Supabase disk usage minimal (only `contacts` + `mailers` tables + RPCs).

### NVIDIA client configuration
- `max_tokens`: 16384 (raised from 4096 to prevent "empty content" errors when the model spends its entire budget on reasoning_content)
- `temperature`: 0.3
- `reasoning_effort`: low
- `timeout`: 55s (under Vercel Hobby's 60s Node cap)
- Retryable: 429, 500, 502, 503, 504, ECONNRESET, ETIMEDOUT, "empty content"

---

## 8. UI Components

### Tabs
- **Contacts** — master contact list with search, filters, sort, pagination
- **Mailers** — campaign library with auto-computed rates, sort, filters

Both tabs have:
- SQL Query Box (paste-your-own SQL)
- Upload CSV (bulk add/update)
- Delete CSV (bulk delete by email or mailer_id)
- Add Record / Add Mailer button
- Filters toggle (dropdowns for structured filtering)
- Search (free-text across all fields)
- CSV export

### Responsive layout
- Wide screens (md+): table + chat panel side-by-side
- Narrow screens: only one panel shown. "Chat" button in tab bar switches to full-screen chat. "Back to table" returns.

### TagsInput component
- Chip input with smart suggestions (bulb icon)
- Fetches all distinct tags from `/api/tags` with usage counts
- Enter always adds the typed text (doesn't pick from suggestions)
- Tags are normalized to lowercase + sorted on save (via trigger)

### Mailer ID combobox
- Type to filter mailers by ID or subject_line
- Dropdown arrow (▾) opens the full list
- Arrow keys + Enter to pick from filtered list
- Typing a new mailer_id that doesn't exist → auto-creates a stub mailer

---

## 9. File Structure

```
app/
  page.tsx                          # Tabbed UI (Contacts | Mailers) + chat panel + SQL query box
  api/
    chat/route.ts                   # LangGraph chat endpoint (NVIDIA-powered, stateless)
    contacts/route.ts               # GET/POST/PUT/DELETE on contacts (by id)
    contacts/bulk/route.ts          # POST bulk upload with dedup + identity sync
    contacts/values/route.ts        # GET distinct values (for FieldSuggest autocomplete)
    mailers/route.ts               # GET/POST/PUT/DELETE on mailers
    query/route.ts                  # POST raw SQL SELECT (for SQL Query Box)
    tags/route.ts                  # GET distinct tags with counts (for TagsInput)
components/
  ContactsTable.tsx                # Contacts tab table (id-based selection)
  MailersTable.tsx                  # Mailers tab table
  EditModal.tsx                    # Add/edit contact modal (id-based PUT/DELETE)
  MailerEditModal.tsx               # Add/edit mailer modal
  CSVUploadModal.tsx                # Bulk contact CSV upload
  BulkDeleteModal.tsx              # Bulk delete by CSV/paste (contacts by email, mailers by id)
  SqlQueryBox.tsx                  # Paste-your-own SQL box (on both tabs)
  ChatPanel.tsx                    # NVIDIA-backed chat panel (no settings UI)
  TagsInput.tsx                    # Chip input with smart suggestions
  FieldSuggest.tsx                 # Autocomplete for text fields
lib/
  supabase.ts                       # Supabase client (reads env vars)
  nvidia.ts                         # NVIDIA streaming chat client (raw fetch + SSE)
  langgraph/
    state.ts                       # ContactRow (with id), MailerRow types
    tools.ts                       # getTableSchema() for LLM
    nodes.ts                       # intent classifier, SQL generator, etc.
    edges.ts / graph.ts            # LangGraph wiring
supabase/functions/cleanup/        # Daily cleanup Edge Function (Deno)
migration_schema.sql               # Full DDL (run in Supabase SQL Editor)
SCHEMA_V3_MULTIPLE_EMAILS.sql       # Migration: email → id as PK
.env.local                         # Supabase URL + service role key + NVIDIA_API_KEY
```

---

## 10. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | Supabase service role key (`sb_secret_*` format) |
| `NVIDIA_API_KEY` | Vercel + `.env.local` | NVIDIA build API key (`nvapi-*` format) |

Never prefix `NVIDIA_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` with `NEXT_PUBLIC_` — they're server-only.

---

## 11. Daily Cleanup

To prevent Supabase bloat:

1. **`cleanup_old_data()` RPC** — drops any stale log tables, runs `ANALYZE` on contacts + mailers (updates planner statistics). Never touches live data.

2. **pg_cron schedule** (optional) — run daily at 3 AM UTC:
   ```sql
   -- Enable pg_cron extension first (Dashboard → Database → Extensions)
   select cron.schedule('daily-cleanup', '0 3 * * *', 'select public.cleanup_old_data()');
   ```

3. **Edge Function** (`supabase/functions/cleanup/index.ts`) — alternative if pg_cron isn't enabled. Can be called by external cron (Vercel Cron, GitHub Actions).

---

## 12. Common Queries

```sql
-- Show all contacts (newest first)
SELECT * FROM contacts ORDER BY id DESC;

-- Show all contacts for a specific email (across all mailers)
SELECT * FROM contacts WHERE email = 'anil@godrej.com' ORDER BY id DESC;

-- Show HOT contacts (clicked something)
SELECT * FROM contacts WHERE engagement_score = 'HOT' ORDER BY email;

-- Show contacts tagged "vip"
SELECT * FROM contacts WHERE 'vip' = ANY(tags);

-- Show mailers ranked by open rate (best subject lines)
SELECT * FROM mailers ORDER BY open_rate DESC;

-- Show mailer M001 performance summary
SELECT mailer_id, total_sent, unique_opens, total_opens,
       unique_clicks, total_clicks, unsubscribed_count, hardbounced_count,
       open_rate, click_rate, unsubscribe_rate, hardbounce_rate
FROM mailers WHERE mailer_id = 'M001';

-- Show contacts in mailer M001 who haven't opened
SELECT * FROM contacts WHERE mailer_id = 'M001' AND opens = 0;
```
