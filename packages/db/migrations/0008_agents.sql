ALTER TABLE "user" ADD COLUMN "kind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "agent_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_agent_workspace_id_workspace_id_fk" FOREIGN KEY ("agent_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;