# Email Campaign Tracker

A Next.js 16 + TypeScript app for managing email contacts and tracking the performance of every mailer you send — open rates, click rates, and the full journey of every email.

Built on Supabase (3-table schema) with a LangGraph + NVIDIA LLM chat panel for natural-language querying of the data.

## Database schema (3 tables)

| Table | Purpose | PK |
| --- | --- | --- |
| `contacts` | Master contact list — one row per person | `email` |
| `mailers` | Campaign library — one row per mailer blast | `mailer_id` (e.g. `M001`) |
| `email_journey` | Event log — many rows per email / per mailer | `id` (auto) |

### Auto-maintained counters
Every `INSERT` into `email_journey` automatically updates:
- `contacts.total_sent`, `total_opens`, `total_clicks`, `last_activity_date`, `engagement_score`
- `mailers.total_sent`, `delivered`, `unique_opens`, `total_opens`, `unique_clicks`, `total_clicks`, `bounced`, `unsubscribed`

So your app code never has to compute rollups — just insert journey events and the master tables stay in sync.

`mailers.open_rate` and `mailers.click_rate` are GENERATED ALWAYS columns (`unique_opens / delivered * 100` and `unique_clicks / delivered * 100`).

## LLM: NVIDIA only

The chat panel uses NVIDIA's integrate API exclusively (no OpenRouter, no GLM).

- **Gateway:** `https://integrate.api.nvidia.com/v1/chat/completions`
- **Default model:** `nvidia/nemotron-3-super-120b-a12b` (120B params, fast ~4s, `reasoning_effort: 'low'`)
- **Client:** `lib/nvidia.ts` — raw `fetch` + SSE parsing, **no `@langchain/openai` SDK** at runtime.
  Ported from <https://github.com/zazikant/tradingview-notes-app-nvidia>.
- **Auth:** `NVIDIA_API_KEY` env var (server-only — never prefixed with `NEXT_PUBLIC_`).

The LangGraph nodes in `lib/langgraph/nodes.ts` call `nvidiaChat(prompt)` for each step (intent classification, SQL generation, error recovery, response formatting). Each call has a 55s timeout and 2 retries for transient 429/5xx errors.

## First-time setup

### 1. Run the schema DDL

Open <https://supabase.com/dashboard/project/gdmztlzpsobyjousvvyp/sql/new> and paste the contents of:

```
migration_schema.sql
```

Click **Run**. This creates all 3 tables, indexes, the auto-rollup trigger, and the `updated_at` touch trigger. (Re-running is safe — every block is `DROP IF EXISTS` / `CREATE IF NOT EXISTS`.)

### 2. Optional: create a `run_select_query` RPC for the chat panel
The chat panel calls `supabase.rpc("run_select_query", { query_text })`. If you want the chat panel to work, create this function in SQL Editor:

```sql
create or replace function public.run_select_query(query_text text)
returns json language plpgsql security definer as $$
declare
  result json;
begin
  -- only allow SELECT
  if lower(trim(query_text)) !~ '^select' then
    raise exception 'Only SELECT queries are allowed';
  end if;
  execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from (' || query_text || ') t' into result;
  return result;
end;
$$;
```

### 3. Configure env vars

Create `.env.local` with these values from your Supabase project dashboard
(Project Settings → API) and your NVIDIA build account (<https://build.nvidia.com>
→ API Keys):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>      # sb_secret_*
NVIDIA_API_KEY=<your-nvidia-api-key>                    # nvapi-...
```

Notes:
- Use the `sb_secret_*` key (new-format service role key). The legacy
  `sbp_*` publishable keys don't work for server-side writes.
- `.env.local` is gitignored — never commit it.
- The NVIDIA client (`lib/nvidia.ts`) reads `NVIDIA_API_KEY` server-side.
  It is never sent from the browser, so you don't need to expose it via
  `NEXT_PUBLIC_*`.

### 4. Install + run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## UI

The app has a tabbed table view:
- **Contacts** tab — master contact list with all 22 columns, search, sort, pagination, bulk delete, CSV upload, add/edit via modal.
- **Mailers** tab — campaign library with auto-computed open rate / click rate, sortable columns, add/edit via modal.

On the right is the Chat panel — a LangGraph agent (NVIDIA-powered) that turns natural-language queries into SQL and updates the visible table.

## How to record email events

When you send a mailer via SendGrid / Brevo / SES, your webhook handler should insert rows into `email_journey`:

```ts
await supabase.from("email_journey").insert({
  email: "rajesh@company.com",
  mailer_id: "M001",
  subject_line: "Q1 Newsletter",
  event_type: "OPENED",            // SENT | DELIVERED | OPENED | CLICKED | BOUNCED | UNSUBSCRIBED
  timestamp: new Date().toISOString(),
  link_clicked: null,
  device_info: "Mobile / Mumbai",
});
```

The trigger then automatically:
- Increments `mailers.total_opens`, `unique_opens`, etc.
- Increments `contacts.total_opens`, updates `last_activity_date`, recalculates `engagement_score` (HOT if clicked, WARM if opened, COLD otherwise).

## File layout (key files)

```
app/
  page.tsx                          # Tabbed UI (Contacts | Mailers) + chat panel
  api/
    chat/route.ts                   # LangGraph chat endpoint (NVIDIA-powered)
    contacts/route.ts               # GET/POST/PUT/DELETE on contacts (key=email)
    contacts/bulk/route.ts          # POST bulk upsert
    contacts/values/route.ts        # GET distinct values (for FieldSuggest)
    mailers/route.ts                # GET/POST/PUT/DELETE on mailers (key=mailer_id)
components/
  ContactsTable.tsx                # Contacts tab table
  MailersTable.tsx                  # Mailers tab table
  EditModal.tsx                     # Add/edit contact modal
  MailerEditModal.tsx               # Add/edit mailer modal
  CSVUploadModal.tsx                # Bulk contact CSV upload
  ChatPanel.tsx                    # NVIDIA-backed chat panel (no settings UI)
lib/
  supabase.ts                       # Supabase client (reads env vars)
  nvidia.ts                         # NVIDIA streaming chat client (raw fetch + SSE)
  langgraph/
    state.ts                       # ContactRow / MailerRow / JourneyRow types
    tools.ts                        # getTableSchema() for LLM
    nodes.ts                       # intent classifier, SQL generator, etc. (calls nvidiaChat)
    edges.ts / graph.ts            # LangGraph wiring
migration_schema.sql               # DDL — run this in Supabase SQL Editor first
.env.local                         # Supabase URL + service role key + NVIDIA_API_KEY
```
