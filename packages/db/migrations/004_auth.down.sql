-- G04-01 rollback: remove authentication baseline tables and helper.
drop trigger if exists users_updated_at on users;
drop function if exists skelet_users_updated_at();
drop table if exists sessions;
drop table if exists users;
