ALTER TABLE messages ADD COLUMN reply_to_id integer CHECK (reply_to_id IS NULL OR reply_to_id > 0);
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN mentions_json text NOT NULL DEFAULT '[]' CHECK (json_valid(mentions_json) AND json_type(mentions_json) = 'array');
