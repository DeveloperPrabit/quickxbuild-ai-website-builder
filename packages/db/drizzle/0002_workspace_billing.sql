-- Monetization: workspace_billing gate source of truth
CREATE TABLE IF NOT EXISTS "workspace_billing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"credits_balance" integer DEFAULT 10 NOT NULL,
	"subscription_tier" varchar DEFAULT 'FREE' NOT NULL,
	"workspace_type" varchar DEFAULT 'PERSONAL' NOT NULL,
	"stripe_customer_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill from existing subscription_limit rows (sum active ai_nums per org)
INSERT INTO "workspace_billing" (
  "organization_id",
  "credits_balance",
  "subscription_tier",
  "workspace_type",
  "stripe_customer_id",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  sl.organization_id,
  GREATEST(COALESCE(SUM(CASE WHEN sl.is_active THEN sl.ai_nums ELSE 0 END), 0), 0)::integer,
  CASE
    WHEN bool_or(sl.is_active AND lower(sl.plan_name) LIKE '%max%') THEN 'ADVANCED'
    WHEN bool_or(sl.is_active AND lower(sl.plan_name) LIKE '%business%') THEN 'BUSINESS'
    WHEN bool_or(sl.is_active AND (lower(sl.plan_name) LIKE '%pro%' OR lower(sl.plan_name) LIKE '%basic%')) THEN 'BASIC'
    ELSE 'FREE'
  END,
  'PERSONAL',
  (array_agg(sl.stripe_customer_id) FILTER (WHERE sl.stripe_customer_id IS NOT NULL))[1],
  0,
  CURRENT_TIMESTAMP,
  now()
FROM "subscription_limit" sl
GROUP BY sl.organization_id
ON CONFLICT ("organization_id") DO NOTHING;
