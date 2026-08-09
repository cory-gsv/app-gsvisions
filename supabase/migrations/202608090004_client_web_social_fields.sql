alter table public.profiles
  add column if not exists brokerage_website_url text,
  add column if not exists facebook_url text,
  add column if not exists instagram_url text,
  add column if not exists linkedin_url text,
  add column if not exists twitter_url text,
  add column if not exists youtube_url text;
