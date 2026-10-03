-- Global activity feed and action-filtered pages use the same stable cursor order.
CREATE INDEX audit_events_list ON qr_review.audit_events(created_at DESC,id DESC);
CREATE INDEX audit_events_action_list ON qr_review.audit_events(action,created_at DESC,id DESC);
