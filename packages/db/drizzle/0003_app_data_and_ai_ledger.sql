-- Secure tenant app data + append-only AI R&D ledger
CREATE TABLE IF NOT EXISTS "app_data" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"collection" text DEFAULT 'default' NOT NULL,
	"record_key" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_data_tenant_project_idx" ON "app_data" USING btree ("tenant_id","project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_data_tenant_project_collection_idx" ON "app_data" USING btree ("tenant_id","project_id","collection");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_data_tenant_project_collection_key_uidx" ON "app_data" USING btree ("tenant_id","project_id","collection","record_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_execution_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"plan_id" text,
	"prompt" text NOT NULL,
	"plan_summary" text,
	"code_output" text,
	"build_status" text NOT NULL,
	"credit_cost" integer DEFAULT 1 NOT NULL,
	"model_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_execution_ledger_tenant_created_idx" ON "ai_execution_ledger" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_execution_ledger_project_created_idx" ON "ai_execution_ledger" USING btree ("project_id","created_at");
