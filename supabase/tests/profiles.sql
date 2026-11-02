-- Profiles, public decks, likes and reports: who may read and change what. Run with scripts/check-migrations.mjs.
\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.as_user(u text, email text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'email', coalesce(email, u || '@x.test'), 'role', 'authenticated')::text, false);
end $f$;
create or replace procedure t.expect_fail(q text, what text) language plpgsql as $f$
begin
  begin execute q; exception when others then raise notice 'ok refused: % (%)', what, sqlerrm; return; end;
  raise exception 'should have failed: %', what;
end $f$;
create or replace function t.check(ok boolean, what text) returns void language plpgsql as $f$
begin if not coalesce(ok, false) then raise exception 'check failed: %', what; end if; raise notice 'ok: %', what; end $f$;
grant usage on schema t to anon, authenticated;

insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001','gail@x.test'), ('bbbbbbbb-0000-0000-0000-000000000002','b@x.test'),
 ('cccccccc-0000-0000-0000-000000000003','c@x.test'), ('dddddddd-0000-0000-0000-000000000004','d@x.test'),
 ('eeeeeeee-0000-0000-0000-000000000005','admin@x.test');
insert into public.admins values ('admin@x.test');

-- Gail makes a profile and three decks, one hidden
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.profiles (handle, name, bio, avatar_card, avatar_art, avatar_artist) values ('gail', 'Gail Mercer', 'Golgari forever.', 'Sakura-Tribe Elder', 'https://cards.scryfall.io/art_crop/front/1/2/abc.jpg?1562', 'Some Artist');
reset role;
insert into public.decks (id, user_id, name, commander, d) values
 ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Meren', 'Meren of Clan Nel Toth', 'AAAA'),
 ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Krenko', 'Krenko, Mob Boss', 'BBBB');
set role authenticated;
-- the way the app saves (no id), hidden from the start
insert into public.decks (user_id, name, commander, d, hidden, description) values (auth.uid(), 'Azusa', 'Azusa, Lost but Seeking', 'CCCC', true, 'lands');
reset role;
update public.decks set id = '11111111-0000-0000-0000-000000000003' where name = 'Azusa';
set role authenticated;
call t.expect_fail($q$insert into public.decks (id, user_id, name, commander, d) values (gen_random_uuid(), auth.uid(), 'x', 'y', 'FFFF')$q$, 'choose a deck id');
call t.expect_fail($q$insert into public.decks (user_id, name, commander, d, likes) values (auth.uid(), 'x', 'y', 'DDDD', 99)$q$, 'set likes on insert');
call t.expect_fail($q$update public.decks set likes = 50 where id = '11111111-0000-0000-0000-000000000001'$q$, 'set likes on update');
call t.expect_fail($q$update public.decks set removed = false$q$, 'set removed on a deck');
call t.expect_fail($q$update public.profiles set removed = false$q$, 'set removed on a profile');
call t.expect_fail($q$insert into public.profiles (handle, name) values ('Bad Handle', 'x')$q$, 'bad handle');
call t.expect_fail($q$update public.profiles set avatar_art = 'https://evil.test/x.jpg'$q$, 'picture from elsewhere');
update public.decks set description = 'My Friday deck.' where id = '11111111-0000-0000-0000-000000000001';
select t.check((select public.handle_free('gail')), 'own handle counts as free for its owner');
reset role;

-- a visitor
set role anon;
select set_config('request.jwt.claims', '', false);
call t.expect_fail($q$select * from public.profiles$q$, 'anon reads profiles table');
call t.expect_fail($q$select * from public.decks$q$, 'anon reads decks table');
select t.check(jsonb_array_length(public.public_profile('GAIL') -> 'decks') = 2, 'profile lists the 2 shown decks (handle case-blind)');
select t.check(not (public.public_profile('gail')::text like '%aaaaaaaa%'), 'profile has no user id');
select t.check(public.public_deck('11111111-0000-0000-0000-000000000003') is null, 'hidden deck has no public page');
select t.check(public.public_deck('11111111-0000-0000-0000-000000000001') ->> 'description' = 'My Friday deck.', 'public deck has its description');
select t.check(public.public_deck('11111111-0000-0000-0000-000000000001') -> 'author' ->> 'handle' = 'gail', 'public deck names its player');
select t.check(not public.handle_free('gail') and public.handle_free('newbie'), 'handle_free');
call t.expect_fail($q$select public.file_report('deck', null, '11111111-0000-0000-0000-000000000001', 'spam')$q$, 'anon reports');
reset role;

-- B likes Gail's deck; can't like twice, a hidden deck, or own deck; reads only own rows
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
insert into public.likes (deck_id) values ('11111111-0000-0000-0000-000000000001');
select t.check((public.public_deck('11111111-0000-0000-0000-000000000001') ->> 'likes')::int = 1, 'like counted');
call t.expect_fail($q$insert into public.likes (deck_id) values ('11111111-0000-0000-0000-000000000001')$q$, 'like twice');
call t.expect_fail($q$insert into public.likes (deck_id) values ('11111111-0000-0000-0000-000000000003')$q$, 'like a hidden deck');
call t.expect_fail($q$insert into public.likes (user_id, deck_id) values ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002')$q$, 'like as someone else');
insert into public.profiles (handle, name) values ('bee', 'Bee');
reset role;
insert into public.decks (id, user_id, name, commander, d) values ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Bee deck', 'Judith, the Scourge Diva', 'EEEE');
set role authenticated;
call t.expect_fail($q$insert into public.likes (deck_id) values ('22222222-0000-0000-0000-000000000001')$q$, 'like own deck');
select t.check((select count(*) from public.decks) = 1, 'B sees only own decks');
select t.check((select count(*) from public.profiles) = 1, 'B sees only own profile');
insert into public.likes (deck_id) values ('11111111-0000-0000-0000-000000000002');
delete from public.likes where deck_id = '11111111-0000-0000-0000-000000000002';
select t.check((public.public_deck('11111111-0000-0000-0000-000000000002') ->> 'likes')::int = 0, 'unlike counted');
select t.check(public.file_report('deck', null, '11111111-0000-0000-0000-000000000001', 'spam'), 'B reports');
select t.check(public.file_report('deck', null, '11111111-0000-0000-0000-000000000001', 'spam again'), 'B reports again (still one report)');
call t.expect_fail($q$select * from public.reports$q$, 'B reads reports');
call t.expect_fail($q$select public.admin_reports()$q$, 'B reads the admin queue');
call t.expect_fail($q$select public.admin_moderate('deck', '11111111-0000-0000-0000-000000000001', true)$q$, 'B moderates');
reset role;

select t.as_user('cccccccc-0000-0000-0000-000000000003'); set role authenticated;
call t.expect_fail($q$insert into public.profiles (handle, name) values ('gail', 'Fake Gail')$q$, 'taken handle');
select public.file_report('deck', null, '11111111-0000-0000-0000-000000000001', 'rude');
reset role; set role anon;
select t.check(public.public_deck('11111111-0000-0000-0000-000000000001') is not null, 'two reporters: still up');
reset role;
select t.as_user('dddddddd-0000-0000-0000-000000000004'); set role authenticated;
select public.file_report('deck', null, '11111111-0000-0000-0000-000000000001', 'rude');
select t.check(not public.file_report('deck', null, '11111111-0000-0000-0000-000000000003', 'x'), 'hidden deck cannot be reported');
reset role; set role anon;
select t.check(public.public_deck('11111111-0000-0000-0000-000000000001') is null, 'three reporters: taken down');
select t.check(jsonb_array_length(public.public_profile('gail') -> 'decks') = 1, 'taken-down deck off the profile');
reset role;

-- the admin puts it back
select t.as_user('eeeeeeee-0000-0000-0000-000000000005', 'Admin@X.test'); set role authenticated;
select t.check(jsonb_array_length(public.admin_reports()) = 1 and (public.admin_reports() -> 0 ->> 'count')::int = 3 and (public.admin_reports() -> 0 ->> 'removed')::boolean, 'admin queue: one deck, 3 reports, down');
select public.admin_moderate('deck', '11111111-0000-0000-0000-000000000001', false);
select t.check(jsonb_array_length(public.admin_reports()) = 0, 'queue settled');
select t.check(public.public_deck('11111111-0000-0000-0000-000000000001') is not null, 'back up');
select public.admin_moderate('profile', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select t.check(public.public_profile('gail') is null and public.public_deck('11111111-0000-0000-0000-000000000001') is null, 'profile down takes its decks down');
select public.admin_moderate('profile', 'aaaaaaaa-0000-0000-0000-000000000001', false);
reset role;

-- deleting B's account takes B's like off the count
delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select t.check((select likes from public.decks where id = '11111111-0000-0000-0000-000000000001') = 0, 'deleted account: like gone');
select t.check(not exists (select 1 from public.profiles where handle = 'bee'), 'deleted account: profile gone');
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001'); set role authenticated;
update public.decks set name = 'Meren 2', hidden = true where id = '11111111-0000-0000-0000-000000000001';
select t.check((select hidden from public.decks where id = '11111111-0000-0000-0000-000000000001'), 'owner hides a deck');
reset role;
\echo ALL GOOD
