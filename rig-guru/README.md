# Rig Guru — Industrial hardware strategy app

Full-stack app: **Next.js** chat UI → **FastAPI** backend → **PostgreSQL** (SQLAlchemy), optional **retail scraping**, **local RAG** (URLs, PDFs, text files + Gemini embeddings), and **Google Gemini** for chat replies.

```
User → Next.js :3000 → FastAPI (:8000 by default) → PostgreSQL + Gemini + RAG (rag_data/) + optional scrape
```

---

## Repository layout

```
Rig Guru/                         # project root
├── run.py                        # pip/npm install + start backend + frontend
├── run_rig_guru.bat              # Windows: same as run.py, window stays open (pause)
├── backend/
│   ├── main.py                   # API only: uvicorn rig_guru.api.app:app
│   ├── requirements.txt
│   ├── .env                      # secrets (not in git)
│   ├── rag_data/                 # RAG corpus (gitignored)
│   ├── scripts/                  # migration_auth.sql, run_migration_auth.py, verify_users_schema.py
│   ├── samples/
│   │   ├── knowledge_urls.sample.txt
│   │   └── rag_pdfs/             # put PDFs for RAG here (*.pdf gitignored)
│   ├── tools/                    # rag_ingest CLI
│   └── rig_guru/
│       ├── env.py
│       ├── database.py
│       ├── models.py             # Users, Conversation, Message, UserData
│       ├── api/app.py            # FastAPI, CORS, POST /api/chat
│       └── services/
│           ├── ai_controller.py  # Gemini, intent, RAG, scraper
│           ├── scraper.py
│           └── rag_store.py
└── frontend/
    └── src/                      # App Router, components/chat, lib/api.ts
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| **Python 3.11+** | Backend |
| **Node.js** (LTS) + **npm** | Frontend |
| **PostgreSQL** | Users, chat history |
| **Google AI Studio API key** | Gemini chat + embeddings ([AI Studio](https://aistudio.google.com)) |

---

## Terminal cheat sheet

Run these from **`Rig Guru/Rig Guru`** (the folder that contains **`run.py`**), unless a command says **`cd backend`** or **`cd frontend`**.

| Command | What it does |
|--------|----------------|
| `python -u run.py` | Install backend + frontend deps if needed, start **API + Next.js** together (Windows-friendly). |
| `cd backend` then `pip install -r requirements.txt` | Install **Python** packages only. |
| `cd backend` then `python main.py` | Start **FastAPI** only (port from **`BACKEND_PORT`** / **`.env`**, or next free port if busy). |
| `cd backend` then `python scripts/run_migration_auth.py` | Apply **DB migration** (`googleSub`, `Conversation`, `Message.conversationID`) using **`DATABASE_URL`**. |
| `cd backend` then `python scripts/verify_users_schema.py` | List **`Users`** columns — confirms **`googleSub`** exists. |
| `cd backend` then `python -m tools.rag_ingest https://example.com/article` | **RAG:** ingest one **URL** into `rag_data/corpus.jsonl` (needs **`GEMINI_API_KEY`**). |
| `cd backend` then `python -m tools.rag_ingest --file samples/knowledge_urls.sample.txt` | **RAG:** ingest **many URLs** (one per line, `#` comments ok). |
| `cd backend` then `python -m tools.rag_ingest --pdf samples/rag_pdfs/your.pdf` | **RAG:** ingest one **PDF** (repeat `--pdf` for more files). |
| `cd backend` then `python -m tools.rag_ingest --text-file path/to/notes.txt` | **RAG:** ingest a **UTF-8 text** file (optional first line `Title: …`). |
| `cd frontend` then `npm install` | Install **Node** dependencies (first time / after `package.json` changes). |
| `cd frontend` then `npm run dev` | **Next.js** dev server → **http://localhost:3000** (use **`npm.cmd run dev`** in PowerShell if scripts are blocked). |
| `cd frontend` then `npm run build` | **Production** build of the UI. |

**Health:** open **`http://localhost:8000/api/health`** (adjust port) — expect `"ok": true` for DB connectivity.

---

## Quick start — one command (`run.py`)

From the **project root** (folder that contains `run.py`):

```powershell
cd path\to\Rig Guru
python -u run.py
```

- **`python -u`** = unbuffered output so you see logs immediately.
- **`run.py`** runs `pip install` (backend), `npm install` (frontend, if needed), starts the API, then **`npm.cmd run dev`** on Windows (avoids PowerShell blocking `npm.ps1`).

Then open **http://localhost:3000** in the browser.

**Windows:** If a console **flashes and closes**, double-click **`run_rig_guru.bat`** — it runs `python -u run.py` and **pauses** so you can read errors.

**Note:** After startup, that terminal will **keep showing logs** and look “idle” — that is normal. The servers are running until you press **Ctrl+C**.

---

## Manual start — two terminals (alternative)

| Step | Terminal | Commands |
|------|----------|----------|
| 1 | Backend | `cd backend` → `python main.py` |
| 2 | Frontend | `cd frontend` → `npm.cmd run dev` (PowerShell) or `npm run dev` (cmd) |

- API docs: **http://localhost:8000/docs** (use **`BACKEND_PORT`** in `.env` if you changed the port).
- App UI: **http://localhost:3000**

**PowerShell:** If `npm` fails with *running scripts is disabled*, use **`npm.cmd run dev`** or run **`Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`** once.

**Port already in use (e.g. WinError 10048):** **`main.py`** / **`run.py`** try the next ports (up to **+9**) automatically. If the API is **not** on **8000**, set **`BACKEND_INTERNAL_URL=http://127.0.0.1:<port>`** in **`frontend/.env.local`** and restart **`npm run dev`**. Or free **8000** by closing the other API terminal. To force one port only, set **`BACKEND_PORT`** in **`backend/.env`** to a known-free port.

---

## Configuration (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATABASE_URL` | e.g. `postgresql+psycopg2://USER:PASSWORD@localhost:5433/rigguru` |
| `BACKEND_PORT` or `PORT` | API port (default **8000**). Change if the port is busy. |
| `GEMINI_MODELS` | *(Optional)* Comma-separated chat model ids |
| `FRONTEND_PORT` | *(Optional)* CORS origin port if not `3000` |
| `RAG_ENABLED` | *(Optional)* `true` / `false` (default `true`) |
| `RAG_TOP_K` | *(Optional)* Chunks injected into hardware prompts (default `6`) |
| `GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_MODELS` | *(Optional)* Embedding model ids ([embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings)); defaults try `gemini-embedding-001` and fallbacks |
| `RAG_DATA_DIR` | *(Optional)* Corpus directory (default `backend/rag_data`) |
| `JWT_SECRET_KEY` or `SESSION_SECRET_KEY` | **Auth:** secret used to sign the **session cookie** (use a long random string in dev/prod). |
| `JWT_EXPIRE_DAYS` or `SESSION_EXPIRE_DAYS` | *(Optional)* Session cookie lifetime in days (default **7**). |
| `GOOGLE_CLIENT_ID` | *(Optional)* Google OAuth **Web client** ID for `POST /api/auth/google` (must match the frontend client ID). |
| `RIGGURU_SEED_DEFAULT_USER` | Set to **`0`**, **`false`**, **`no`**, or **`off`** to **disable** seeding `Users.userID = 1` on startup (default **on** for quick local dev). |

**`rig_guru/env.py`** finds **`backend/.env`** from any working directory.

**Frontend → API (local dev):** By default the UI calls **`/__rigguru_api/...`** on the same host as Next.js; **`next.config.ts`** rewrites that to **`http://127.0.0.1:8000`** (override with **`BACKEND_INTERNAL_URL`** in **`.env.local`** if the API uses another port). That avoids **CORS** and **`Failed to fetch`** when `/docs` works but Register does not.

**Direct URL (optional):** Set **`NEXT_PUBLIC_API_URL`** to the **API root only** (e.g. `http://localhost:8001`) — **do not** add `/api`. If you use this, the browser talks to another origin; ensure backend **CORS** allows your Next origin.

**Frontend auth / Google button:** Set **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** in **`frontend/.env.local`** to the **same** OAuth client ID as **`GOOGLE_CLIENT_ID`** on the API if you use Google. Users sign in at **`/login`** with **email + password**; the browser stores a **signed session cookie** (`rigguru_session`) and sends it on API requests (`credentials: include`). Wrong password → no cookie → **`401`**. Conversations and messages are **per user** in Postgres.

---

### Database migration (existing installs)

If you already have a database from before conversations/auth, apply **`backend/scripts/migration_auth.sql`** so **`googleSub`** on **`Users`**, **`Conversation`**, and **`Message.conversationID`** exist. Easiest:

```powershell
cd backend
python scripts/run_migration_auth.py
```

(Uses **`DATABASE_URL`** from **`backend/.env`**.) New installs can rely on **`create_all`** if starting fresh.

---

## RAG — ingest knowledge (no Docker)

Use the **Terminal cheat sheet** commands (`python -m tools.rag_ingest …`). Requires **`GEMINI_API_KEY`** in **`backend/.env`**.

| Source | Notes |
|--------|--------|
| **URLs** | Sites that allow simple HTTP fetch work (e.g. Wikipedia). Some retail sites return **403** to bots — use PDF/text instead. |
| **PDFs** | Prefer text-based PDFs; scanned books need OCR elsewhere first. Default location: **`samples/rag_pdfs/`** (subfolders OK; **`*.pdf` gitignored**). |
| **`.txt`** | UTF-8; optional first line `Title: My document` for chunk titles. |

**Corpus:** `backend/rag_data/corpus.jsonl` (gitignored). **Re-run ingest** after adding URLs/files. The chat uses RAG mainly on **hardware / procurement–style** messages (GPU, laptop, budget, recommend, etc.).

---

## API (short)

| Endpoint | Notes |
|----------|--------|
| **`POST /api/auth/register`** | Email + username + password → sets session cookie + returns `{ user_id, email, username }`. |
| **`POST /api/auth/login`** | Email + password → session cookie (wrong password → **401**). |
| **`POST /api/auth/logout`** | Clears session cookie. |
| **`POST /api/auth/google`** | Body `{ "id_token": "<credential>" }` → session (requires **`GOOGLE_CLIENT_ID`**). |
| **`GET /api/auth/me`** | Current user (valid session cookie). |
| **`GET/POST /api/conversations`** | List or create chat threads for the current user. |
| **`PATCH` / `DELETE` `/api/conversations/{id}`** | Rename, pin, delete (cannot delete last thread). |
| **`GET /api/conversations/{id}/messages`** | Message history for that thread. |
| **`POST /api/chat`** | Body `{ "message": string, "conversation_id": number }` — user from session; saves to that conversation. |
| **Response** | `{ "text": string, "groundingChunks": array }` (shape may vary). |

Open **http://localhost:8000/docs** for the full OpenAPI schema.

**DB quick check:** **http://localhost:8000/api/health** (or your API port) — should show `"ok": true` and `"database": "connected"`. If `"ok": false`, fix **PostgreSQL** / **DATABASE_URL** before using Register.

---

## Database notes

- DB name and host must match **`DATABASE_URL`**.
- Tables are created on startup with **`create_all`** (dev).
- Optional seed user **`Users.userID = 1`**: only if **`RIGGURU_SEED_DEFAULT_USER=true`** (see env table).

---

## Troubleshooting (short)

## Roadmap

1. Deployment, scaling  
2. UI polish — errors, admin  

---

## Security

- Rotate any exposed API keys.  
- Never commit **`backend/.env`**.  
- Only index PDFs/text you have the **right** to use in your corpus.
