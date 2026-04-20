-- 2026-04-19 Seed entitlement feature catalog.
--
-- Seeds the canonical feature inventory from the architecture spec. Each
-- row is idempotent via ON CONFLICT (feature_key) DO UPDATE so re-running
-- converges every environment on the same catalog.
--
-- Categories: core, users_team, technician_app, service_hvac,
--             sales_revenue, integrations, reporting, communication,
--             scale_advanced
--
-- `is_core = true` features cannot be disabled by plans or overrides —
-- the resolver short-circuits them to enabled/unlimited. They exist in the
-- catalog so the admin UI can display them (greyed / locked) alongside
-- non-core features.
--
-- No plan-feature rows are seeded. Plan packaging is populated via the
-- platform admin UI after features exist.
--
-- Run via: npm run db:migrate

INSERT INTO subscription_features
  (feature_key, display_name, description, category, limit_type, is_core, active, sort_order)
VALUES
  -- Core (always enabled, cannot be disabled)
  ('clients',              'Clients / Customers',            'Customer company + location management',      'core',            'count',         true,  true, 100),
  ('locations',            'Locations',                      'Per-company service locations',                'core',            'count',         true,  true, 110),
  ('jobs',                 'Jobs',                           'Job ticket creation and tracking',             'core',            'none',          true,  true, 120),
  ('quotes',               'Quotes',                         'Quote creation and conversion',                'core',            'none',          true,  true, 130),
  ('invoices',             'Invoices',                       'Invoice creation and sending',                 'core',            'none',          true,  true, 140),
  ('scheduling_calendar',  'Scheduling Calendar',            'Visit scheduling calendar surface',            'core',            'none',          true,  true, 150),
  ('dispatch_board',       'Dispatch Board',                 'Live dispatch board — always available',       'core',            'none',          true,  true, 160),
  ('notes',                'Notes',                          'Notes on jobs, clients, quotes, invoices',     'core',            'none',          true,  true, 170),
  ('attachments',          'Attachments',                    'File attachments on notes and entities',       'core',            'none',          true,  true, 180),

  -- Users / Team
  ('office_users',         'Office Users',                   'Owner / manager / dispatcher / office seats',  'users_team',      'seat_count',    false, true, 200),
  ('technician_users',     'Technician Users',               'Technician seats (field app)',                 'users_team',      'seat_count',    false, true, 210),
  ('total_users',          'Total Users',                    'Combined active user cap',                     'users_team',      'seat_count',    false, true, 220),
  ('role_permissions',     'Custom Role Permissions',        'Custom role / permission configuration',       'users_team',      'none',          false, true, 230),

  -- Technician App
  ('tech_mobile_app',      'Technician Mobile App',          'Access to /tech/* PWA surface',                'technician_app',  'none',          false, true, 300),
  ('clock_in_out',         'Clock In / Out',                 'Tech attendance (work_sessions)',              'technician_app',  'none',          false, true, 310),
  ('time_tracking',        'Time Tracking',                  'Per-job time entries',                         'technician_app',  'none',          false, true, 320),
  ('tech_job_notes',       'Technician Job Notes',           'Field notes posted from the tech app',         'technician_app',  'none',          false, true, 330),
  ('photo_uploads',        'Photo Uploads',                  'Attach photos from field devices',             'technician_app',  'storage_gb',    false, true, 340),
  ('gps_status',           'GPS / Live Status',              'Real-time technician position telemetry',      'technician_app',  'none',          false, true, 350),

  -- Service / HVAC
  ('equipment_tracking',   'Equipment Tracking',             'Location-level equipment records',             'service_hvac',    'count',         false, true, 400),
  ('equipment_photos',     'Equipment Nameplate Photos',     'Per-equipment nameplate OCR + photos',         'service_hvac',    'none',          false, true, 410),
  ('pm_contracts',         'PM Contracts',                   'Preventive maintenance recurring contracts',   'service_hvac',    'count',         false, true, 420),
  ('pm_templates',         'PM Templates',                   'Reusable PM job content templates',            'service_hvac',    'none',          false, true, 430),
  ('recurring_visits',     'Recurring Visits',               'Auto-generated recurring visits',              'service_hvac',    'none',          false, true, 440),
  ('warranty_tracking',    'Warranty Tracking',              'Warranty fields on equipment / jobs',          'service_hvac',    'none',          false, true, 450),
  ('asset_history',        'Asset History',                  'Historical service events per asset',          'service_hvac',    'none',          false, true, 460),

  -- Sales / Revenue
  ('leads',                'Leads',                          'Lead capture and qualification',               'sales_revenue',   'none',          false, true, 500),
  ('pipeline',             'Sales Pipeline',                 'Visual pipeline / stage tracking',             'sales_revenue',   'none',          false, true, 510),
  ('quote_approvals',      'Quote Approvals',                'Approval workflow for outbound quotes',        'sales_revenue',   'none',          false, true, 520),
  ('online_payments',      'Online Payments',                'Customer portal payment acceptance',           'sales_revenue',   'none',          false, true, 530),
  ('payment_sync',         'Payment Sync',                   'Outbound payment sync to QBO',                 'sales_revenue',   'none',          false, true, 540),
  ('deposits',             'Deposits',                       'Invoice deposits / partial payments',          'sales_revenue',   'none',          false, true, 550),

  -- Integrations
  ('quickbooks_online',    'QuickBooks Online',              'Two-way QBO sync (items / customers / invoices)', 'integrations', 'none',          false, true, 600),
  ('stripe_payments',      'Stripe Payments',                'Stripe-backed card processing',                'integrations',    'none',          false, true, 610),
  ('csv_export',           'CSV Export',                     'Bulk data export surfaces',                    'integrations',    'none',          false, true, 620),
  ('api_access',           'API Access',                     'External API / integration access',            'integrations',    'custom',        false, true, 630),
  ('webhooks',             'Webhooks',                       'Outbound webhook delivery',                    'integrations',    'count',         false, true, 640),

  -- Reporting
  ('basic_reports',        'Basic Reports',                  'Core reporting (AR, job list, dashboards)',    'reporting',       'none',          false, true, 700),
  ('advanced_reports',     'Advanced Reports',               'Deeper reporting (trends, aging, mix)',        'reporting',       'none',          false, true, 710),
  ('payroll_reports',      'Payroll Reports',                'Timesheet + payroll export reports',           'reporting',       'none',          false, true, 720),
  ('margin_reports',       'Margin Reports',                 'Job margin / profitability analysis',          'reporting',       'none',          false, true, 730),
  ('custom_reports',       'Custom Reports',                 'Customer-built reports / saved queries',       'reporting',       'count',         false, true, 740),

  -- Communication
  ('email_sending',        'Email Sending',                  'Outbound email (invoices, quotes, jobs)',      'communication',   'none',          false, true, 800),
  ('sms_reminders',        'SMS Reminders',                  'Outbound SMS reminders',                       'communication',   'monthly_count', false, true, 810),
  ('customer_portal',      'Customer Portal',                'Self-serve customer portal surface',           'communication',   'none',          false, true, 820),
  ('review_requests',      'Review Requests',                'Post-job review request flow',                 'communication',   'monthly_count', false, true, 830),

  -- Scale / Advanced
  ('branches',             'Branches',                       'Multi-branch / multi-region support',          'scale_advanced',  'branch_count',  false, true, 900),
  ('multi_location_reporting', 'Multi-Location Reporting',   'Reporting rolled up across branches',          'scale_advanced',  'none',          false, true, 910),
  ('custom_branding',      'Custom Branding',                'Branded emails / portal / invoice PDFs',       'scale_advanced',  'none',          false, true, 920),
  ('priority_support',     'Priority Support',               'Priority support SLA tier',                    'scale_advanced',  'none',          false, true, 930)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  category        = EXCLUDED.category,
  limit_type      = EXCLUDED.limit_type,
  is_core         = EXCLUDED.is_core,
  active          = EXCLUDED.active,
  sort_order      = EXCLUDED.sort_order,
  updated_at      = CURRENT_TIMESTAMP;
