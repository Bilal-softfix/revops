-- M2-T4 contact merge re-points the merged contact's history: timeline_events stays append-only
-- for app_user except for this one column.
GRANT UPDATE ("contact_id") ON "timeline_events" TO "app_user";
