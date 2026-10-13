-- Tables included in the nightly data backup (K-17.5): everything in public and app.
select format('%I.%I', schemaname, tablename)
from pg_tables
where schemaname in ('public', 'app')
order by 1;
