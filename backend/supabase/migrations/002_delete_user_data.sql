-- Account deletion RPC. Called from the profile page after the user types DELETE.
-- security definer so it can remove the auth.users row.

create or replace function public.delete_user_data()
returns void as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.terms where user_id = uid;
  delete from public.transcript_chunks where user_id = uid;
  delete from public.sessions where user_id = uid;
  begin
    delete from public.integrations where user_id = uid;
  exception when undefined_table then null;
  end;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.delete_user_data() from anon, public;
grant execute on function public.delete_user_data() to authenticated;
