-- Run against an existing Rig Guru Postgres DB if tables already existed before auth.
-- Uses information_schema so we alter whichever user table actually exists ("Users" vs users).

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Users'
  ) THEN
    ALTER TABLE public."Users" ADD COLUMN IF NOT EXISTS "googleSub" VARCHAR(255);
    CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub
      ON public."Users" ("googleSub") WHERE "googleSub" IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "googleSub" VARCHAR(255);
    CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub_lc
      ON public.users ("googleSub") WHERE "googleSub" IS NOT NULL;
  END IF;
END $migration$;

CREATE TABLE IF NOT EXISTS "Conversation" (
    "conversationID" SERIAL PRIMARY KEY,
    "userID" INTEGER NOT NULL REFERENCES "Users"("userID") ON DELETE CASCADE,
    "title" VARCHAR(255) NOT NULL DEFAULT 'New chat',
    "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
    "titleIsCustom" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_conversation_user ON "Conversation" ("userID");

ALTER TABLE IF EXISTS "Message" ADD COLUMN IF NOT EXISTS "conversationID" INTEGER REFERENCES "Conversation"("conversationID") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_message_conversation ON "Message" ("conversationID");
