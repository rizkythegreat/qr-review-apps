CREATE SCHEMA IF NOT EXISTS qr_review;
REVOKE ALL ON SCHEMA qr_review FROM PUBLIC;

CREATE TABLE qr_review.admin_users (
  user_id uuid PRIMARY KEY,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE qr_review.qr_batches (
  id uuid PRIMARY KEY,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  activation_codes_expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  activation_snapshot bytea,
  snapshot_valid boolean NOT NULL DEFAULT true
);
CREATE TABLE qr_review.qr_codes (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES qr_review.qr_batches(id),
  token text COLLATE "C" NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  activation_hash text,
  status text NOT NULL DEFAULT 'UNACTIVATED' CHECK (status IN ('UNACTIVATED','ACTIVE','SUSPENDED','RETIRED')),
  stock_status text NOT NULL DEFAULT 'GENERATED' CHECK (stock_status IN ('GENERATED','AVAILABLE','SOLD','DAMAGED')),
  store_name text CHECK (char_length(store_name) BETWEEN 1 AND 120),
  review_url text CHECK (char_length(review_url) <= 2048),
  pin_hash text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  auth_generation integer NOT NULL DEFAULT 1 CHECK (auth_generation > 0),
  ownership_id uuid,
  activated_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('ACTIVE','SUSPENDED') OR
    (stock_status = 'SOLD' AND pin_hash IS NOT NULL AND store_name IS NOT NULL AND review_url IS NOT NULL
     AND ownership_id IS NOT NULL AND activated_at IS NOT NULL)),
  CHECK (stock_status <> 'DAMAGED' OR status = 'RETIRED'),
  CHECK (status = 'UNACTIVATED' OR activation_hash IS NULL)
);
CREATE INDEX qr_codes_list ON qr_review.qr_codes(created_at DESC,id DESC);
CREATE INDEX qr_codes_batch ON qr_review.qr_codes(batch_id);
CREATE TABLE qr_review.sales_records (
  id uuid PRIMARY KEY,
  qr_id uuid NOT NULL UNIQUE REFERENCES qr_review.qr_codes(id),
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 100),
  sold_at timestamptz NOT NULL,
  buyer_name text,
  support_contact text,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE qr_review.ownership_periods (
  id uuid PRIMARY KEY,
  qr_id uuid NOT NULL REFERENCES qr_review.qr_codes(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  total_visits bigint NOT NULL DEFAULT 0 CHECK (total_visits >= 0),
  last_visited_at timestamptz,
  UNIQUE (id,qr_id)
);
CREATE UNIQUE INDEX ownership_one_current ON qr_review.ownership_periods(qr_id) WHERE ended_at IS NULL;
ALTER TABLE qr_review.qr_codes ADD CONSTRAINT qr_current_ownership
  FOREIGN KEY (ownership_id,id) REFERENCES qr_review.ownership_periods(id,qr_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE qr_review.owner_sessions (
  session_hash text PRIMARY KEY,
  qr_id uuid NOT NULL REFERENCES qr_review.qr_codes(id),
  ownership_id uuid NOT NULL,
  auth_generation integer NOT NULL,
  csrf_token text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  revoked_at timestamptz
);
CREATE INDEX owner_sessions_qr ON qr_review.owner_sessions(qr_id);
CREATE TABLE qr_review.support_grants (
  id uuid PRIMARY KEY,
  qr_id uuid NOT NULL REFERENCES qr_review.qr_codes(id),
  kind text NOT NULL CHECK (kind IN ('PIN_RESET','OWNERSHIP_TRANSFER')),
  token_hash text NOT NULL UNIQUE,
  auth_generation integer NOT NULL,
  ownership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX support_grants_qr ON qr_review.support_grants(qr_id);
CREATE TABLE qr_review.scan_events (
  id uuid PRIMARY KEY,
  qr_id uuid NOT NULL,
  ownership_id uuid NOT NULL,
  visited_at timestamptz NOT NULL,
  FOREIGN KEY (ownership_id,qr_id) REFERENCES qr_review.ownership_periods(id,qr_id)
);
CREATE INDEX scan_events_retention ON qr_review.scan_events(visited_at);
CREATE TABLE qr_review.audit_events (
  id uuid PRIMARY KEY,
  qr_id uuid NOT NULL REFERENCES qr_review.qr_codes(id),
  action text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('ADMIN','OWNER','SYSTEM')),
  actor_id text,
  reason text,
  changes jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_qr_list ON qr_review.audit_events(qr_id,created_at DESC,id DESC);
CREATE TABLE qr_review.export_jobs (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES qr_review.qr_batches(id),
  kind text NOT NULL CHECK (kind IN ('PUBLIC_QR','ACTIVATION_CODES')),
  image_format text NOT NULL DEFAULT 'png' CHECK (image_format IN ('png','svg')),
  size_px integer NOT NULL DEFAULT 1024 CHECK (size_px BETWEEN 256 AND 2048),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','READY','FAILED','EXPIRED')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  started_at timestamptz,
  lease_id uuid,
  artifact bytea,
  failure_code text
);
CREATE INDEX export_jobs_queue ON qr_review.export_jobs(created_at) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE qr_review.idempotency_records (
  scope text NOT NULL,
  key uuid NOT NULL,
  fingerprint text NOT NULL,
  committed boolean NOT NULL DEFAULT false,
  response bytea,
  secret boolean NOT NULL DEFAULT false,
  response_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  qr_id uuid REFERENCES qr_review.qr_codes(id),
  state_guard jsonb,
  PRIMARY KEY (scope,key)
);
CREATE TABLE qr_review.rate_limits (
  bucket text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION qr_review.guard_qr_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QR units cannot be deleted'; END IF;
  IF NEW.token IS DISTINCT FROM OLD.token OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'Printed identifiers are immutable';
  END IF;
  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN RAISE EXCEPTION 'RETIRED is terminal'; END IF;
  IF OLD.stock_status IN ('DAMAGED','SOLD') AND NEW.stock_status <> OLD.stock_status THEN
    RAISE EXCEPTION 'Physical stock is terminal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_qr BEFORE UPDATE OR DELETE ON qr_review.qr_codes
  FOR EACH ROW EXECUTE FUNCTION qr_review.guard_qr_update();

-- Sensitive tables are outside Supabase's exposed public schema. There are no browser policies.
DO $$ DECLARE t record; r text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'qr_review' LOOP
    EXECUTE format('ALTER TABLE qr_review.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON qr_review.%I FROM PUBLIC', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA qr_review FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA qr_review FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qr_review FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qr_review FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA qr_review REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA qr_review REVOKE ALL ON FUNCTIONS FROM PUBLIC;
