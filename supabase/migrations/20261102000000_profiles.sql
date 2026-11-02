-- Hundredfoldz community, part 1: profiles, public decks, likes and reports.
-- Apply after 20261026000000_accounts.sql (SQL editor or supabase db push).
--
-- A player who creates a profile gets a public page (/u/<handle>) listing their saved decks,
-- except the ones they hide. Public pages are read through the functions at the end
-- (public_profile, public_deck), which return only public fields: never user ids, emails, token
-- use or hidden decks. Nobody else can read the tables directly.
-- Moderation: an admin (an email in public.admins, added by hand, see the end) can take a profile
-- or a deck down; three open reports from different accounts take it down until an admin looks.

-- ---- profiles ---------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  name text not null check (char_length(name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 300),
  -- the picture: a card's art crop from Scryfall (the server looks the card up), with its artist
  avatar_card text check (avatar_card is null or char_length(avatar_card) between 1 and 150),
  avatar_art text check (avatar_art is null or (char_length(avatar_art) <= 300 and avatar_art ~ '^https://cards\.scryfall\.io/art_crop/[A-Za-z0-9/._-]+(\?[0-9]+)?$')),
  avatar_artist text check (avatar_artist is null or char_length(avatar_artist) <= 120),
  -- taken down by an admin, or by reports until an admin looks
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
drop policy if exists "profiles: add own" on public.profiles;
drop policy if exists "profiles: change own" on public.profiles;
drop policy if exists "profiles: delete own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: add own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles: change own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles: delete own" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

-- players change what they wrote, never `removed`
revoke all on public.profiles from anon, authenticated;
grant select, delete on public.profiles to authenticated;
grant insert (user_id, handle, name, bio, avatar_card, avatar_art, avatar_artist) on public.profiles to authenticated;
grant update (user_id, handle, name, bio, avatar_card, avatar_art, avatar_artist, updated_at) on public.profiles to authenticated;

create or replace function public.profiles_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
for each row execute function public.profiles_touch();

-- ---- decks: hidden, a description, likes, taken down, based on ------------------------

alter table public.decks add column if not exists hidden boolean not null default false;
alter table public.decks add column if not exists description text not null default '' check (char_length(description) <= 1000);
alter table public.decks add column if not exists likes integer not null default 0;
alter table public.decks add column if not exists removed boolean not null default false;
-- "Save a copy" of someone's public deck: where it came from (cleared if that deck goes)
alter table public.decks add column if not exists based_on uuid references public.decks (id) on delete set null;

create index if not exists decks_user_public on public.decks (user_id, created_at desc) where not hidden and not removed;

-- the old table-wide insert grant would let a player set likes or removed: list the columns instead
revoke insert, update on public.decks from authenticated;
grant insert (user_id, name, commander, partner, colors, bracket, d, model, usage, hidden, description, based_on) on public.decks to authenticated;
grant update (name, updated_at, hidden, description) on public.decks to authenticated;

-- ---- likes ------------------------------------------------------------------------

-- a deck anyone may see: not hidden, not taken down, and its player has a profile that's up
create or replace function public.deck_is_public(p_deck uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.decks d join public.profiles p on p.user_id = d.user_id
    where d.id = p_deck and not d.hidden and not d.removed and not p.removed
  );
$$;
revoke all on function public.deck_is_public(uuid) from public;
grant execute on function public.deck_is_public(uuid) to anon, authenticated;

create or replace function public.deck_owner(p_deck uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.decks where id = p_deck;
$$;
revoke all on function public.deck_owner(uuid) from public, anon;
grant execute on function public.deck_owner(uuid) to authenticated;

create table if not exists public.likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);
create index if not exists likes_deck on public.likes (deck_id);

alter table public.likes enable row level security;
drop policy if exists "likes: read own" on public.likes;
drop policy if exists "likes: add own" on public.likes;
drop policy if exists "likes: delete own" on public.likes;
create policy "likes: read own" on public.likes for select to authenticated using ((select auth.uid()) = user_id);
-- one like per account, on a public deck that isn't your own
create policy "likes: add own" on public.likes for insert to authenticated
  with check ((select auth.uid()) = user_id and public.deck_is_public(deck_id) and public.deck_owner(deck_id) <> (select auth.uid()));
create policy "likes: delete own" on public.likes for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.likes from anon, authenticated;
grant select, delete on public.likes to authenticated;
grant insert (user_id, deck_id) on public.likes to authenticated;

-- the count on the deck follows the likes table
create or replace function public.likes_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.decks set likes = likes + 1 where id = new.deck_id;
  else
    update public.decks set likes = greatest(likes - 1, 0) where id = old.deck_id;
  end if;
  return null;
end $$;

drop trigger if exists likes_count on public.likes;
create trigger likes_count after insert or delete on public.likes
for each row execute function public.likes_count();

-- liking doesn't count as changing the deck
create or replace function public.decks_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- one insert at a time per user, so parallel saves can't pass the cap together
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    if (select count(*) from public.decks where user_id = new.user_id) >= 1000 then
      raise exception 'deck limit reached (1000 per account)' using errcode = 'P0001';
    end if;
    new.updated_at := now();
  elsif (new.name, new.hidden, new.description) is distinct from (old.name, old.hidden, old.description) then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---- public pages ---------------------------------------------------------------------

-- a profile and its public decks, newest first; null when there's no such profile (or it's down)
create or replace function public.public_profile(p_handle text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'handle', p.handle, 'name', p.name, 'bio', p.bio,
    'avatarCard', p.avatar_card, 'avatarArt', p.avatar_art, 'avatarArtist', p.avatar_artist,
    'createdAt', p.created_at,
    'decks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'commander', d.commander, 'partner', d.partner, 'colors', d.colors,
        'bracket', d.bracket, 'likes', d.likes, 'createdAt', d.created_at
      ) order by d.created_at desc)
      from public.decks d where d.user_id = p.user_id and not d.hidden and not d.removed
    ), '[]'::jsonb)
  )
  from public.profiles p
  where p.handle = lower(p_handle) and not p.removed;
$$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;

-- one public deck with its player and, for a copy, the deck it was based on (when that's public too)
create or replace function public.public_deck(p_deck uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'name', d.name, 'commander', d.commander, 'partner', d.partner, 'colors', d.colors,
    'bracket', d.bracket, 'likes', d.likes, 'createdAt', d.created_at, 'description', d.description, 'd', d.d,
    'author', jsonb_build_object('handle', p.handle, 'name', p.name, 'avatarArt', p.avatar_art),
    'basedOn', (
      select jsonb_build_object('id', o.id, 'name', o.name, 'handle', op.handle, 'author', op.name)
      from public.decks o join public.profiles op on op.user_id = o.user_id
      where o.id = d.based_on and not o.hidden and not o.removed and not op.removed
    )
  )
  from public.decks d join public.profiles p on p.user_id = d.user_id
  where d.id = p_deck and not d.hidden and not d.removed and not p.removed;
$$;
revoke all on function public.public_deck(uuid) from public;
grant execute on function public.public_deck(uuid) to anon, authenticated;

-- is a handle free (for the profile form)? Taken-down profiles keep theirs.
create or replace function public.handle_free(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where handle = lower(p_handle) and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
$$;
revoke all on function public.handle_free(text) from public;
grant execute on function public.handle_free(text) to anon, authenticated;

-- ---- reports and moderation -----------------------------------------------------------

-- admins, by login email. Add yourself once in the SQL editor:
--   insert into public.admins (email) values ('you@example.com');
create table if not exists public.admins (email text primary key check (email = lower(email)));
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('profile', 'deck')),
  -- the profile's user, or the deck
  target uuid not null,
  reason text not null check (char_length(reason) between 1 and 300),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (reporter, kind, target)
);
create index if not exists reports_open on public.reports (kind, target) where not resolved;
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- report a profile (by handle) or a deck. Three open reports from different accounts take it down.
create or replace function public.file_report(p_kind text, p_handle text, p_deck uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  t uuid;
  n int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_kind = 'profile' then
    select user_id into t from public.profiles where handle = lower(p_handle) and not removed;
  elsif p_kind = 'deck' and public.deck_is_public(p_deck) then
    t := p_deck;
  end if;
  if t is null then
    return false;
  end if;
  insert into public.reports (reporter, kind, target, reason)
  values (auth.uid(), p_kind, t, left(trim(p_reason), 300))
  on conflict (reporter, kind, target) do update set reason = excluded.reason, resolved = false, created_at = now();
  select count(*) into n from public.reports where kind = p_kind and target = t and not resolved;
  if n >= 3 then
    if p_kind = 'profile' then
      update public.profiles set removed = true where user_id = t;
    else
      update public.decks set removed = true where id = t;
    end if;
  end if;
  return true;
end $$;
revoke all on function public.file_report(text, text, uuid, text) from public, anon;
grant execute on function public.file_report(text, text, uuid, text) to authenticated;

-- for admins: everything reported and not yet looked at, plus what's down
create or replace function public.admin_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'last' desc) from (
      select jsonb_build_object(
        'kind', r.kind, 'target', r.target, 'count', count(*), 'last', max(r.created_at),
        'reasons', jsonb_agg(r.reason order by r.created_at desc),
        'removed', coalesce(bool_or(p.removed), bool_or(d.removed), false),
        'title', coalesce(max(p.name), max(d.name)),
        'handle', coalesce(max(p.handle), max(dp.handle))
      ) as x
      from public.reports r
      left join public.profiles p on r.kind = 'profile' and p.user_id = r.target
      left join public.decks d on r.kind = 'deck' and d.id = r.target
      left join public.profiles dp on dp.user_id = d.user_id
      -- reports about something since deleted don't need a look
      where not r.resolved and (p.user_id is not null or d.id is not null)
      group by r.kind, r.target
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- for admins: take something down or put it back; either way its open reports are settled
create or replace function public.admin_moderate(p_kind text, p_target uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_kind = 'profile' then
    update public.profiles set removed = p_remove where user_id = p_target;
  elsif p_kind = 'deck' then
    update public.decks set removed = p_remove where id = p_target;
  end if;
  update public.reports set resolved = true where kind = p_kind and target = p_target and not resolved;
end $$;
revoke all on function public.admin_moderate(text, uuid, boolean) from public, anon;
grant execute on function public.admin_moderate(text, uuid, boolean) to authenticated;
