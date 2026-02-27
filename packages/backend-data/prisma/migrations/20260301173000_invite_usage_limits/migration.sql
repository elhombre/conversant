ALTER TABLE "invite_tokens"
ADD COLUMN "max_uses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "uses_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "invite_tokens"
SET "uses_count" = CASE
  WHEN "used_at" IS NULL THEN 0
  ELSE 1
END;

ALTER TABLE "invite_tokens"
ADD CONSTRAINT "invite_tokens_max_uses_check" CHECK ("max_uses" > 0),
ADD CONSTRAINT "invite_tokens_uses_count_check" CHECK ("uses_count" >= 0),
ADD CONSTRAINT "invite_tokens_uses_count_le_max_uses_check" CHECK ("uses_count" <= "max_uses");

DROP INDEX "invite_tokens_expires_at_used_at_revoked_at_idx";
CREATE INDEX "invite_tokens_expires_at_revoked_at_uses_count_max_uses_idx"
  ON "invite_tokens"("expires_at", "revoked_at", "uses_count", "max_uses");
