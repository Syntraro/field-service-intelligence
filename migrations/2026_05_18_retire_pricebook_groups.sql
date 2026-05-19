-- Retire pricebook_groups and pricebook_group_items tables.
-- Bundle system is superseded by service_templates (Flat-Rate Services),
-- which provide all the same capabilities plus pricing, labor tracking,
-- skill requirements, cost custody, and soft-delete.
-- Run: npm run db:migrate:one -- migrations/2026_05_18_retire_pricebook_groups.sql
DROP TABLE IF EXISTS pricebook_group_items;
DROP TABLE IF EXISTS pricebook_groups;
