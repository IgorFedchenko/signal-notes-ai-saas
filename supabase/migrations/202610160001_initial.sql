create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 20 and 12000),
  created_at timestamptz not null default now()
);
create index notes_owner_created on public.notes(user_id, created_at desc);

create table public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  checkout_session_id text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'none',
  period_end timestamptz,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.generations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  note_id uuid references public.notes(id) on delete set null,
  period date not null,
  status text not null check (status in ('reserved', 'succeeded', 'failed')),
  summary text,
  provider text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index generations_meter on public.generations(user_id, period, status);

-- Receipts contain identifiers only; no card details or raw webhook payloads.
create table public.stripe_events (
  id text primary key,
  event_type text not null,
  customer_id text not null,
  processed_at timestamptz not null default now()
);

alter table public.notes enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.generations enable row level security;
alter table public.stripe_events enable row level security;

revoke all on public.notes, public.billing_accounts, public.generations, public.stripe_events from anon, authenticated;
grant select, insert, delete on public.notes to authenticated;
grant select on public.billing_accounts, public.generations to authenticated;
grant all on public.notes, public.billing_accounts, public.generations, public.stripe_events to service_role;

create policy notes_read on public.notes for select to authenticated using ((select auth.uid()) = user_id);
create policy notes_create on public.notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notes_delete on public.notes for delete to authenticated using ((select auth.uid()) = user_id);
create policy billing_read on public.billing_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy generations_read on public.generations for select to authenticated using ((select auth.uid()) = user_id);

create function public.create_billing_account() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_accounts(user_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.create_billing_account() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_billing_account();

-- Only the server may reserve/finalize. User JWTs cannot forge a plan or a token count.
create function public.reserve_generation(p_user uuid, p_note uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.generations;
  account public.billing_accounts;
  current_period date := date_trunc('month', now() at time zone 'UTC')::date;
  max_requests integer;
  consumed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 1));
  if not exists(select 1 from public.notes where id = p_note and user_id = p_user) then
    return jsonb_build_object('kind', 'not_found');
  end if;
  update public.generations set status = 'failed'
    where user_id = p_user and status = 'reserved' and expires_at <= now();
  select * into existing from public.generations where user_id = p_user and request_id = p_request;
  if found then
    if existing.note_id is distinct from p_note then return jsonb_build_object('kind', 'conflict'); end if;
    if existing.status = 'succeeded' then
      return jsonb_build_object('kind', 'cached', 'summary', existing.summary, 'provider', existing.provider);
    end if;
    if existing.status = 'reserved' then return jsonb_build_object('kind', 'pending'); end if;
    -- Failed/expired requests use a fresh request key. A late worker cannot finalize a new reservation.
    return jsonb_build_object('kind', 'failed');
  end if;
  select * into account from public.billing_accounts where user_id = p_user;
  max_requests := case when account.plan = 'pro' and account.status in ('active', 'trialing')
    and account.period_end > now() then 100 else 5 end;
  select count(*) into consumed from public.generations
    where user_id = p_user and period = current_period and status in ('reserved', 'succeeded');
  if consumed >= max_requests then return jsonb_build_object('kind', 'limit'); end if;
  insert into public.generations(user_id, request_id, note_id, period, status)
    values (p_user, p_request, p_note, current_period, 'reserved');
  return jsonb_build_object('kind', 'reserved');
end;
$$;

create function public.finish_generation(p_user uuid, p_request uuid, p_summary text,
  p_provider text, p_input integer, p_output integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.generations set status = 'succeeded', summary = p_summary,
    provider = p_provider, input_tokens = p_input, output_tokens = p_output
    where user_id = p_user and request_id = p_request and status = 'reserved' and expires_at > now();
  return found;
end;
$$;

create function public.fail_generation(p_user uuid, p_request uuid)
returns void language sql security definer set search_path = '' as $$
  update public.generations set status = 'failed' where user_id = p_user and request_id = p_request and status = 'reserved';
$$;
revoke all on function public.reserve_generation(uuid, uuid, uuid),
  public.finish_generation(uuid, uuid, text, text, integer, integer), public.fail_generation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_generation(uuid, uuid, uuid),
  public.finish_generation(uuid, uuid, text, text, integer, integer), public.fail_generation(uuid, uuid)
  to service_role;
