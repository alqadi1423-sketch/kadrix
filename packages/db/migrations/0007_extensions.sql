-- Folds Arabic letter variants, diacritics and tatweel before indexing so
-- searches match however a word was typed. Mirrors foldSearchText in core.
CREATE OR REPLACE FUNCTION veloq_search_text(t text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(
    regexp_replace(lower(t), '[\u064B-\u065F\u0670\u0640]', '', 'g'),
    'أإآٱىةؤئ',
    'اااايهوي'
  )
$$;--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('issueCreated', 'stateChanged', 'assigneeChanged', 'priorityChanged', 'labelAdded', 'commentAdded');--> statement-breakpoint
CREATE TYPE "public"."field_kind" AS ENUM('text', 'number', 'select', 'multiSelect', 'date', 'user', 'checkbox', 'url');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('csv', 'jira', 'linear', 'github');--> statement-breakpoint
CREATE TYPE "public"."recurrence_freq" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "automation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"kind" "field_kind" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"stats" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_ref" (
	"workspace_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"external_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	CONSTRAINT "import_ref_workspace_id_source_external_id_pk" PRIMARY KEY("workspace_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "issue_field_value" (
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "issue_field_value_issue_id_field_id_pk" PRIMARY KEY("issue_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "issue_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"weekdays" smallint[] DEFAULT '{}' NOT NULL,
	"day_of_month" smallint,
	"start_date" date NOT NULL,
	"next_date" date NOT NULL,
	"last_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" text,
	"minutes" integer NOT NULL,
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "issue_title_trgm_idx";--> statement-breakpoint
ALTER TABLE "issue" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', veloq_search_text(coalesce("issue"."title", ''))), 'A') || setweight(to_tsvector('simple', veloq_search_text(coalesce("issue"."description", ''))), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "page" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', veloq_search_text(coalesce("page"."title", ''))), 'A') || setweight(to_tsvector('simple', veloq_search_text(coalesce("page"."content_text", ''))), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_ref" ADD CONSTRAINT "import_ref_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_ref" ADD CONSTRAINT "import_ref_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_value" ADD CONSTRAINT "issue_field_value_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_value" ADD CONSTRAINT "issue_field_value_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_value" ADD CONSTRAINT "issue_field_value_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_template" ADD CONSTRAINT "issue_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_template" ADD CONSTRAINT "issue_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_template" ADD CONSTRAINT "issue_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_template_id_issue_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."issue_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_ws_idx" ON "automation_rule" USING btree ("workspace_id","trigger");--> statement-breakpoint
CREATE INDEX "custom_field_ws_idx" ON "custom_field" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "import_ref_issue_idx" ON "import_ref" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "field_value_field_idx" ON "issue_field_value" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "issue_template_project_idx" ON "issue_template" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "recurrence_due_idx" ON "recurrence" USING btree ("active","next_date");--> statement-breakpoint
CREATE INDEX "time_entry_issue_idx" ON "time_entry" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "time_entry_ws_date_idx" ON "time_entry" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "issue_title_trgm_idx" ON "issue" USING gin (veloq_search_text("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "issue_search_idx" ON "issue" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "page_search_idx" ON "page" USING gin ("search_vector");