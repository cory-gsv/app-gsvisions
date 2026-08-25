-- Keep the floor-plan product link as an internal CubiCasa entitlement without promising it as a deliverable.
update public.products
set description = corrected.description,
    updated_at = now()
from (values
  ('standard-media', 'Listing photography, aerial drone photos, and one polished virtual twilight.'),
  ('matterport-media', 'Listing photography and aerial photos paired with virtual twilight and an immersive 3D Matterport tour.'),
  ('video-plus', 'Photo and cinematic video coverage with aerial drone photography and video.'),
  ('signature', 'Our complete photo, video, aerial photography, aerial video, virtual twilight, and 3D media suite.')
) as corrected(package_key, description)
where public.products.slug like corrected.package_key || '-tier-%'
  and public.products.description is distinct from corrected.description;

update public.products
set duration_minutes = case substring(public.products.slug from 'tier-([0-4])$')
      when '0' then corrected.durations[1]
      when '1' then corrected.durations[2]
      when '2' then corrected.durations[3]
      when '3' then corrected.durations[4]
      when '4' then corrected.durations[5]
    end,
    updated_at = now()
from (values
  ('standard-media', array[85,100,130,160,190]::integer[]),
  ('matterport-media', array[120,140,190,205,270]::integer[]),
  ('video-plus', array[195,235,290,345,440]::integer[]),
  ('signature', array[230,260,350,420,560]::integer[])
) as corrected(package_key, durations)
where public.products.slug like corrected.package_key || '-tier-%'
  and public.products.duration_minutes is distinct from case substring(public.products.slug from 'tier-([0-4])$')
    when '0' then corrected.durations[1]
    when '1' then corrected.durations[2]
    when '2' then corrected.durations[3]
    when '3' then corrected.durations[4]
    when '4' then corrected.durations[5]
  end;
