-- G04-04 rollback: remove plan entitlements and billing-event intake.
drop trigger if exists subscriptions_updated_at on subscriptions;
drop function if exists skelet_subscriptions_updated_at();
drop table if exists billing_events;
drop table if exists subscriptions;
