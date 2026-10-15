-- Additive cutover: stop old application workers before applying this migration.
-- Historical model costs are unknown, never backfilled as zero.
alter table public.generations
  add column contract_version text not null default 'legacy-v1',
  add column source_note_id uuid,
  add column source_deleted boolean not null default false,
  add column result jsonb,
  add column config jsonb,
  add column attempt_started timestamptz,
  add column reserved_micro_usd bigint check (reserved_micro_usd >= 0),
  add column exposure_micro_usd bigint check (exposure_micro_usd >= 0),
  add column estimated_micro_usd bigint check (estimated_micro_usd >= 0),
  add column cost_status text not null default 'legacy_unknown'
    check (cost_status in ('legacy_unknown', 'reserved', 'settled', 'unknown', 'released')),
  add column latency_ms integer check (latency_ms >= 0),
  add column trace_id text;
update public.generations set source_note_id = note_id, source_deleted = note_id is null,
  status = case when status = 'reserved' then 'failed' else status end,
  summary = case when note_id is null then null else summary end;

-- Remove every legacy mutation entry point, including service_role grants.
drop function public.reserve_generation(uuid, uuid, uuid);
drop function public.finish_generation(uuid, uuid, text, text, integer, integer);
drop function public.fail_generation(uuid, uuid);

create function public.purge_note_generations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The deleting transaction already holds the note row lock. Finalizers acquire
  -- the same note lock before touching a generation, so content cannot resurrect.
  update public.generations set summary = null, result = null, source_deleted = true
    where user_id = old.user_id and source_note_id = old.id;
  return old;
end;
$$;
revoke all on function public.purge_note_generations() from public, anon, authenticated, service_role;
create trigger purge_note_content before delete on public.notes
  for each row execute function public.purge_note_generations();

create function public.reserve_generation_v2(p_user uuid, p_note uuid, p_request uuid,
  p_config jsonb, p_reserved bigint, p_trace text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.generations;
  account public.billing_accounts;
  current_period date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  max_requests integer;
  max_budget bigint;
  consumed integer;
  exposed bigint;
begin
  if p_reserved is null or p_reserved < 0 or p_reserved > 2000000
    or p_config is null or p_config->>'provider' not in ('fixture', 'openai')
    or coalesce((p_config->>'inputCap')::int, 0) not between 1 and 65536
    or coalesce((p_config->>'outputCap')::int, 0) not between 1 and 2000
    or coalesce((p_config->>'inputRate')::numeric, -1) not between 0 and 1000
    or coalesce((p_config->>'outputRate')::numeric, -1) not between 0 and 1000
    or coalesce(length(p_config->>'model'), 0) not between 1 and 100
    or coalesce(length(p_config->>'promptHash'), 0) <> 64
    or p_trace is null or p_trace !~ '^[0-9a-f]{32}$'
    or (p_config->>'provider' = 'fixture' and
      (p_reserved <> 0 or (p_config->>'inputRate')::numeric <> 0 or (p_config->>'outputRate')::numeric <> 0)) then
    raise exception 'invalid_generation_config';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 1));
  -- Lock order throughout the content lifecycle: note, then generation.
  perform 1 from public.notes where id = p_note and user_id = p_user for share;
  if not found then return jsonb_build_object('kind', 'not_found'); end if;
  update public.generations set status = 'failed',
    exposure_micro_usd = case when attempt_started is null then 0 else reserved_micro_usd end,
    cost_status = case when attempt_started is null then 'released' else 'unknown' end
    where user_id = p_user and contract_version = 'v2' and status = 'reserved' and expires_at <= clock_timestamp();
  select * into existing from public.generations where user_id = p_user and request_id = p_request;
  if found then
    if existing.source_note_id is distinct from p_note then return jsonb_build_object('kind', 'conflict'); end if;
    if existing.status = 'succeeded' then
      return jsonb_build_object('kind', 'cached', 'generation', to_jsonb(existing));
    end if;
    return jsonb_build_object('kind', case when existing.status = 'reserved' then 'pending' else 'failed' end);
  end if;
  select * into account from public.billing_accounts where user_id = p_user;
  if account.plan = 'pro' and account.status in ('active', 'trialing') and account.period_end > clock_timestamp() then
    max_requests := 100; max_budget := 2000000;
  else max_requests := 5; max_budget := 100000; end if;
  select count(*) into consumed from public.generations
    where user_id = p_user and period = current_period and status in ('reserved', 'succeeded');
  if consumed >= max_requests then return jsonb_build_object('kind', 'limit'); end if;
  select coalesce(sum(exposure_micro_usd), 0) into exposed from public.generations
    where user_id = p_user and period = current_period;
  if exposed + p_reserved > max_budget then return jsonb_build_object('kind', 'budget'); end if;
  insert into public.generations(user_id, request_id, note_id, source_note_id, period, status,
    contract_version, config, provider, reserved_micro_usd, exposure_micro_usd, cost_status, trace_id)
    values (p_user, p_request, p_note, p_note, current_period, 'reserved', 'v2', p_config,
      p_config->>'model', p_reserved, p_reserved, 'reserved', p_trace);
  return jsonb_build_object('kind', 'reserved');
end;
$$;

create function public.begin_generation_attempt_v2(p_user uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.generations; source uuid;
begin
  select source_note_id into source from public.generations where user_id = p_user and request_id = p_request;
  perform 1 from public.notes where id = source and user_id = p_user for share;
  if not found then return jsonb_build_object('kind', 'not_found'); end if;
  update public.generations set attempt_started = clock_timestamp()
    where user_id = p_user and request_id = p_request and contract_version = 'v2'
      and status = 'reserved' and attempt_started is null
      and expires_at > clock_timestamp() and not source_deleted
    returning * into row;
  if not found then return jsonb_build_object('kind', 'attempt_denied'); end if;
  -- An explicit acknowledged response is the ONLY permission to call the provider.
  return jsonb_build_object('kind', 'attempt', 'config', row.config,
    'period', row.period, 'reservedMicroUsd', row.reserved_micro_usd, 'traceId', row.trace_id);
end;
$$;

create function public.finish_generation_v2(p_user uuid, p_request uuid, p_result jsonb,
  p_input integer, p_output integer, p_latency integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.generations; source uuid; source_content text; source_alive boolean; cost bigint; item jsonb;
begin
  select source_note_id into source from public.generations where user_id = p_user and request_id = p_request;
  select content into source_content from public.notes where id = source and user_id = p_user for share;
  source_alive := found;
  select * into row from public.generations where user_id = p_user and request_id = p_request for update;
  if not found or row.contract_version <> 'v2' or row.attempt_started is null or row.cost_status = 'settled' then
    return jsonb_build_object('kind', 'finish_denied');
  end if;
  if p_input is null or p_output is null or p_latency is null or p_input < 0 or p_output < 0 or p_latency < 0
    or p_output > (row.config->>'outputCap')::int or p_input > (row.config->>'inputCap')::int + 256 then
    raise exception 'invalid_generation_usage';
  end if;
  cost := ceil(p_input * (row.config->>'inputRate')::numeric) + ceil(p_output * (row.config->>'outputRate')::numeric);
  if cost > row.reserved_micro_usd then raise exception 'generation_cost_exceeds_reservation'; end if;
  -- A late worker may settle known financial metadata but cannot become successful
  -- after expiry/failure, nor persist content after deletion.
  if not source_alive or row.source_deleted or row.status <> 'reserved' or row.expires_at <= clock_timestamp() then
    update public.generations set status = 'failed', summary = null, result = null,
      input_tokens = p_input, output_tokens = p_output, latency_ms = p_latency,
      estimated_micro_usd = cost, exposure_micro_usd = reserved_micro_usd, cost_status = 'unknown'
      where user_id = p_user and request_id = p_request;
    return jsonb_build_object('kind', case when not source_alive or row.source_deleted then 'deleted' else 'expired' end);
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or not (p_result ?& array['kind', 'takeaways'])
    or (select count(*) from jsonb_object_keys(p_result)) <> 2
    or p_result->>'kind' not in ('summary', 'insufficient_content')
    or jsonb_typeof(p_result->'takeaways') <> 'array' then raise exception 'invalid_generation_result'; end if;
  if (p_result->>'kind' = 'summary' and jsonb_array_length(p_result->'takeaways') not between 1 and 3)
    or (p_result->>'kind' = 'insufficient_content' and jsonb_array_length(p_result->'takeaways') <> 0) then
    raise exception 'invalid_generation_result';
  end if;
  for item in select value from jsonb_array_elements(p_result->'takeaways') loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['text', 'evidence'])
      or (select count(*) from jsonb_object_keys(item)) <> 2
      or jsonb_typeof(item->'text') <> 'string' or jsonb_typeof(item->'evidence') <> 'string'
      or length(item->>'text') not between 1 and 500 or length(item->>'evidence') not between 1 and 1000
      or strpos(source_content, item->>'evidence') = 0 then raise exception 'invalid_generation_evidence'; end if;
  end loop;
  update public.generations set status = 'succeeded', result = p_result,
    summary = case when p_result->>'kind' = 'insufficient_content' then 'Not enough substantive facts to summarize.'
      else (select string_agg('• ' || (value->>'text'), E'\n') from jsonb_array_elements(p_result->'takeaways')) end,
    input_tokens = p_input, output_tokens = p_output, latency_ms = p_latency,
    estimated_micro_usd = cost, exposure_micro_usd = cost, cost_status = 'settled'
    where user_id = p_user and request_id = p_request returning * into row;
  return jsonb_build_object('kind', 'succeeded', 'generation', to_jsonb(row));
end;
$$;

create function public.fail_generation_v2(p_user uuid, p_request uuid)
returns void language sql security definer set search_path = '' as $$
  update public.generations set status = 'failed',
    exposure_micro_usd = case when attempt_started is null then 0 else reserved_micro_usd end,
    cost_status = case when attempt_started is null then 'released' else 'unknown' end
    where user_id = p_user and request_id = p_request and contract_version = 'v2' and status = 'reserved';
$$;
revoke all on function public.reserve_generation_v2(uuid, uuid, uuid, jsonb, bigint, text),
  public.begin_generation_attempt_v2(uuid, uuid),
  public.finish_generation_v2(uuid, uuid, jsonb, integer, integer, integer),
  public.fail_generation_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_generation_v2(uuid, uuid, uuid, jsonb, bigint, text),
  public.begin_generation_attempt_v2(uuid, uuid),
  public.finish_generation_v2(uuid, uuid, jsonb, integer, integer, integer),
  public.fail_generation_v2(uuid, uuid) to service_role;
