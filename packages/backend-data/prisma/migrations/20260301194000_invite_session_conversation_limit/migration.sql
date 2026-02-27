ALTER TABLE "invite_tokens"
ADD COLUMN "conversation_max_duration_sec" INTEGER;

ALTER TABLE "sessions"
ADD COLUMN "conversation_max_duration_sec" INTEGER;

ALTER TABLE "invite_tokens"
ADD CONSTRAINT "invite_tokens_conversation_max_duration_sec_check"
CHECK ("conversation_max_duration_sec" IS NULL OR "conversation_max_duration_sec" > 0);

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_conversation_max_duration_sec_check"
CHECK ("conversation_max_duration_sec" IS NULL OR "conversation_max_duration_sec" > 0);
