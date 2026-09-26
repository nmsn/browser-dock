CREATE TYPE "public"."config_status" AS ENUM('PENDING_PUSH', 'PUSH_FAILED', 'IN_LINE', 'WAIT_EXECUTE', 'EXECUTING', 'DONE', 'FAILED', 'CANCELLING', 'CANCELLED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."config_type" AS ENUM('HOT_ITEM_TOP', 'FAN_PACKET', 'SECKILL', 'SECKILL_PUSH', 'FLASH_DISCOUNT', 'COUPON', 'COMMENT_LUCKY_DRAW', 'SHARE_LUCKY_DRAW', 'PACKET_RAIN', 'FREE_LUCKY_DRAW');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('PENDING_CREATE', 'CREATING', 'CREATED', 'CREATE_FAILED', 'CANCELLING', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"name" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "execution_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"taobao_account_id" text NOT NULL,
	"plan_id" integer,
	"config_id" integer,
	"config_type" text,
	"status" text NOT NULL,
	"result" jsonb,
	"fail_reason" text,
	"screenshot_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"config_type" "config_type" NOT NULL,
	"config_data" jsonb NOT NULL,
	"config_status" "config_status" DEFAULT 'PENDING_PUSH' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"scheduled_trigger_time" timestamp with time zone,
	"actual_trigger_time" timestamp with time zone,
	"execution_result" text,
	"fail_reason" text,
	"return_time" timestamp with time zone,
	"claim_device_id" text,
	"claim_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"plan_code" text,
	"execution_mode" text DEFAULT 'PLUGIN' NOT NULL,
	"live_date" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"live_id" text,
	"live_title" text,
	"plan_status" "plan_status" DEFAULT 'PENDING_CREATE' NOT NULL,
	"scheduled_trigger_time" timestamp with time zone,
	"actual_trigger_time" timestamp with time zone,
	"plugin_version" text,
	"claim_device_id" text,
	"claim_time" timestamp with time zone,
	"execution_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"taobao_account_id" text NOT NULL,
	"room_name" text NOT NULL,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_taobao_account_id_unique" UNIQUE("taobao_account_id")
);
--> statement-breakpoint
ALTER TABLE "execution_records" ADD CONSTRAINT "execution_records_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_configs" ADD CONSTRAINT "plan_configs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;