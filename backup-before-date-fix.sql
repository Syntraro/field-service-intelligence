--
-- PostgreSQL database dump
--

\restrict NGrTVpnKfkMcY0J6rQQvETx3iWicTQVd3mwxuVC7niIQddo3mQuSMgDdUFCkesr

-- Dumped from database version 16.11 (74c6bb6)
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.audit_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    platform_admin_id character varying NOT NULL,
    platform_admin_email text NOT NULL,
    target_company_id character varying,
    target_user_id character varying,
    action text NOT NULL,
    reason text,
    details text,
    ip_address text,
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO neondb_owner;

--
-- Name: calendar_assignments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.calendar_assignments (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    client_id character varying NOT NULL,
    assigned_technician_ids character varying[],
    year integer NOT NULL,
    month integer NOT NULL,
    day integer,
    scheduled_date text NOT NULL,
    scheduled_hour integer,
    auto_due_date boolean DEFAULT true NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    completion_notes text,
    job_number integer NOT NULL,
    scheduled_start_minutes integer,
    duration_minutes integer DEFAULT 60
);


ALTER TABLE public.calendar_assignments OWNER TO neondb_owner;

--
-- Name: client_notes; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.client_notes (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    client_id character varying NOT NULL,
    user_id character varying NOT NULL,
    note_text text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.client_notes OWNER TO neondb_owner;

--
-- Name: client_parts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.client_parts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    client_id character varying NOT NULL,
    part_id character varying NOT NULL,
    quantity integer NOT NULL
);


ALTER TABLE public.client_parts OWNER TO neondb_owner;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.clients (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    company_name text NOT NULL,
    location text,
    address text,
    city text,
    province text,
    postal_code text,
    contact_name text,
    email text,
    phone text,
    roof_ladder_code text,
    notes text,
    selected_months integer[] NOT NULL,
    inactive boolean DEFAULT false NOT NULL,
    next_due text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    parent_company_id character varying,
    bill_with_parent boolean DEFAULT true NOT NULL,
    qbo_customer_id text,
    qbo_parent_customer_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone
);


ALTER TABLE public.clients OWNER TO neondb_owner;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.companies (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    province_state text,
    postal_code text,
    email text,
    phone text,
    trial_ends_at timestamp without time zone,
    subscription_status text DEFAULT 'trial'::text NOT NULL,
    subscription_plan text,
    billing_interval text,
    current_period_end timestamp without time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tax_name text DEFAULT 'HST'::text NOT NULL,
    default_tax_rate text DEFAULT '13'::text NOT NULL
);


ALTER TABLE public.companies OWNER TO neondb_owner;

--
-- Name: company_audit_logs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.company_audit_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id character varying,
    metadata text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.company_audit_logs OWNER TO neondb_owner;

--
-- Name: company_counters; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.company_counters (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    next_job_number integer DEFAULT 10000 NOT NULL,
    next_invoice_number integer DEFAULT 1001 NOT NULL
);


ALTER TABLE public.company_counters OWNER TO neondb_owner;

--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.company_settings (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    company_name text,
    address text,
    city text,
    province_state text,
    postal_code text,
    email text,
    phone text,
    calendar_start_hour integer DEFAULT 8 NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.company_settings OWNER TO neondb_owner;

--
-- Name: customer_companies; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.customer_companies (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name text NOT NULL,
    legal_name text,
    phone text,
    email text,
    billing_street text,
    billing_city text,
    billing_province text,
    billing_postal_code text,
    billing_country text,
    is_active boolean DEFAULT true NOT NULL,
    qbo_customer_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.customer_companies OWNER TO neondb_owner;

--
-- Name: equipment; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.equipment (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    client_id character varying NOT NULL,
    name text NOT NULL,
    type text,
    model_number text,
    serial_number text,
    location text,
    notes text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.equipment OWNER TO neondb_owner;

--
-- Name: feedback; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.feedback (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    user_email text NOT NULL,
    category text NOT NULL,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    archived boolean DEFAULT false NOT NULL
);


ALTER TABLE public.feedback OWNER TO neondb_owner;

--
-- Name: invitation_tokens; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invitation_tokens (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    created_by_user_id character varying NOT NULL,
    token text NOT NULL,
    email text,
    role text DEFAULT 'technician'::text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    used_by_user_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.invitation_tokens OWNER TO neondb_owner;

--
-- Name: invitations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invitations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.invitations OWNER TO neondb_owner;

--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoice_lines (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    invoice_id character varying NOT NULL,
    line_number integer NOT NULL,
    description text NOT NULL,
    quantity text DEFAULT '1'::text NOT NULL,
    unit_price text DEFAULT '0'::text NOT NULL,
    line_subtotal text DEFAULT '0'::text NOT NULL,
    tax_code text,
    qbo_item_ref_id text,
    qbo_tax_code_ref_id text,
    metadata text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    line_item_type text DEFAULT 'service'::text NOT NULL,
    date date,
    technician_id character varying,
    tax_rate text DEFAULT '0'::text NOT NULL,
    job_line_item_id character varying,
    unit_cost text
);


ALTER TABLE public.invoice_lines OWNER TO neondb_owner;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoices (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    location_id character varying NOT NULL,
    customer_company_id character varying,
    invoice_number text,
    status text DEFAULT 'draft'::text NOT NULL,
    issue_date date NOT NULL,
    due_date date,
    currency text DEFAULT 'CAD'::text NOT NULL,
    subtotal text DEFAULT '0'::text NOT NULL,
    tax_total text DEFAULT '0'::text NOT NULL,
    total text DEFAULT '0'::text NOT NULL,
    notes_internal text,
    notes_customer text,
    qbo_invoice_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone,
    qbo_doc_number text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    amount_paid text DEFAULT '0'::text NOT NULL,
    balance text DEFAULT '0'::text NOT NULL,
    job_id character varying,
    sent_at timestamp without time zone,
    viewed_at timestamp without time zone,
    work_description text,
    client_message text,
    show_quantity boolean DEFAULT true NOT NULL,
    show_unit_price boolean DEFAULT true NOT NULL,
    show_line_totals boolean DEFAULT true NOT NULL,
    show_line_items boolean DEFAULT true NOT NULL,
    show_balance boolean DEFAULT true NOT NULL,
    dirty boolean DEFAULT false NOT NULL
);


ALTER TABLE public.invoices OWNER TO neondb_owner;

--
-- Name: job_equipment; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.job_equipment (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    job_id character varying NOT NULL,
    equipment_id character varying NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.job_equipment OWNER TO neondb_owner;

--
-- Name: job_notes; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.job_notes (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    assignment_id character varying NOT NULL,
    user_id character varying NOT NULL,
    note_text text NOT NULL,
    image_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.job_notes OWNER TO neondb_owner;

--
-- Name: job_parts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.job_parts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    job_id character varying NOT NULL,
    product_id character varying,
    equipment_id character varying,
    description text NOT NULL,
    quantity text NOT NULL,
    unit_price text,
    source text DEFAULT 'manual'::text NOT NULL,
    equipment_label text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    unit_cost text,
    sort_order integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.job_parts OWNER TO neondb_owner;

--
-- Name: job_template_line_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.job_template_line_items (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    template_id character varying NOT NULL,
    product_id character varying NOT NULL,
    description_override text,
    quantity text DEFAULT '1'::text NOT NULL,
    unit_price_override text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.job_template_line_items OWNER TO neondb_owner;

--
-- Name: job_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.job_templates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name text NOT NULL,
    job_type text,
    description text,
    is_default_for_job_type boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.job_templates OWNER TO neondb_owner;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.jobs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    location_id character varying NOT NULL,
    job_number integer NOT NULL,
    primary_technician_id character varying,
    assigned_technician_ids character varying[],
    status text DEFAULT 'draft'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    job_type text DEFAULT 'maintenance'::text NOT NULL,
    summary text NOT NULL,
    description text,
    access_instructions text,
    scheduled_start timestamp without time zone,
    scheduled_end timestamp without time zone,
    actual_start timestamp without time zone,
    actual_end timestamp without time zone,
    invoice_id character varying,
    qbo_invoice_id text,
    billing_notes text,
    recurring_series_id character varying,
    calendar_assignment_id character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.jobs OWNER TO neondb_owner;

--
-- Name: labor_entries; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.labor_entries (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    technician_id character varying NOT NULL,
    job_id character varying NOT NULL,
    minutes integer NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.labor_entries OWNER TO neondb_owner;

--
-- Name: location_equipment; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.location_equipment (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    location_id character varying NOT NULL,
    name text NOT NULL,
    equipment_type text,
    manufacturer text,
    model_number text,
    serial_number text,
    tag_number text,
    install_date date,
    warranty_expiry date,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.location_equipment OWNER TO neondb_owner;

--
-- Name: location_pm_part_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.location_pm_part_templates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    location_id character varying NOT NULL,
    product_id character varying NOT NULL,
    equipment_id character varying,
    description_override text,
    quantity_per_visit text NOT NULL,
    equipment_label text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.location_pm_part_templates OWNER TO neondb_owner;

--
-- Name: location_pm_plans; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.location_pm_plans (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    location_id character varying NOT NULL,
    has_pm boolean DEFAULT false NOT NULL,
    pm_type text,
    pm_jan boolean DEFAULT false NOT NULL,
    pm_feb boolean DEFAULT false NOT NULL,
    pm_mar boolean DEFAULT false NOT NULL,
    pm_apr boolean DEFAULT false NOT NULL,
    pm_may boolean DEFAULT false NOT NULL,
    pm_jun boolean DEFAULT false NOT NULL,
    pm_jul boolean DEFAULT false NOT NULL,
    pm_aug boolean DEFAULT false NOT NULL,
    pm_sep boolean DEFAULT false NOT NULL,
    pm_oct boolean DEFAULT false NOT NULL,
    pm_nov boolean DEFAULT false NOT NULL,
    pm_dec boolean DEFAULT false NOT NULL,
    notes text,
    recurring_series_id character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.location_pm_plans OWNER TO neondb_owner;

--
-- Name: maintenance_records; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.maintenance_records (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    client_id character varying NOT NULL,
    due_date text NOT NULL,
    completed_at text
);


ALTER TABLE public.maintenance_records OWNER TO neondb_owner;

--
-- Name: parts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.parts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    type text NOT NULL,
    filter_type text,
    belt_type text,
    size text,
    name text,
    description text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cost text,
    unit_price text,
    tax_exempt boolean DEFAULT false,
    sku text,
    markup_percent text,
    is_taxable boolean DEFAULT true,
    tax_code text,
    category text,
    is_active boolean DEFAULT true,
    qbo_item_id text,
    qbo_sync_token text,
    updated_at timestamp without time zone
);


ALTER TABLE public.parts OWNER TO neondb_owner;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.password_reset_tokens (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    requested_ip text
);


ALTER TABLE public.password_reset_tokens OWNER TO neondb_owner;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.payments (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    invoice_id character varying NOT NULL,
    amount text NOT NULL,
    method text DEFAULT 'other'::text NOT NULL,
    reference text,
    received_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.payments OWNER TO neondb_owner;

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.permissions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    "group" text NOT NULL,
    label text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.permissions OWNER TO neondb_owner;

--
-- Name: recurring_job_phases; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.recurring_job_phases (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    series_id character varying NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    frequency text NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    occurrences integer,
    until_date date
);


ALTER TABLE public.recurring_job_phases OWNER TO neondb_owner;

--
-- Name: recurring_job_series; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.recurring_job_series (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    location_id character varying NOT NULL,
    base_summary text NOT NULL,
    base_description text,
    base_job_type text DEFAULT 'service'::text NOT NULL,
    base_priority text DEFAULT 'normal'::text NOT NULL,
    default_technician_id character varying,
    start_date date NOT NULL,
    timezone text DEFAULT 'America/Toronto'::text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by_user_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.recurring_job_series OWNER TO neondb_owner;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.role_permissions (
    role_id character varying NOT NULL,
    permission_id character varying NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO neondb_owner;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.roles (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_system_role boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.roles OWNER TO neondb_owner;

--
-- Name: session; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.session (
    sid character varying(255) NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


ALTER TABLE public.session OWNER TO neondb_owner;

--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.subscription_plans (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    stripe_price_id text,
    monthly_price_cents integer,
    location_limit integer NOT NULL,
    is_trial boolean DEFAULT false NOT NULL,
    trial_days integer,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.subscription_plans OWNER TO neondb_owner;

--
-- Name: supplier_visit_details; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.supplier_visit_details (
    task_id character varying NOT NULL,
    supplier_id character varying,
    supplier_name_other text,
    po_number text,
    reconciled_at timestamp without time zone,
    reconciled_by_user_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.supplier_visit_details OWNER TO neondb_owner;

--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.suppliers (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.suppliers OWNER TO neondb_owner;

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.tasks (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    created_by_user_id character varying NOT NULL,
    assigned_to_user_id character varying,
    type text NOT NULL,
    title text NOT NULL,
    notes text,
    status text DEFAULT 'OPEN'::text NOT NULL,
    closed_at timestamp without time zone,
    closed_by_user_id character varying,
    scheduled_start_at timestamp without time zone,
    scheduled_end_at timestamp without time zone,
    all_day boolean DEFAULT false NOT NULL,
    checked_in_at timestamp without time zone,
    checked_out_at timestamp without time zone,
    job_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.tasks OWNER TO neondb_owner;

--
-- Name: technician_profiles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.technician_profiles (
    user_id character varying NOT NULL,
    labor_cost_per_hour text,
    billable_rate_per_hour text,
    color text,
    phone text,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.technician_profiles OWNER TO neondb_owner;

--
-- Name: technicians; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.technicians (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name text NOT NULL,
    user_id character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.technicians OWNER TO neondb_owner;

--
-- Name: user_permission_overrides; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.user_permission_overrides (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    permission_id character varying NOT NULL,
    override text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_permission_overrides OWNER TO neondb_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role text DEFAULT 'technician'::text NOT NULL,
    full_name text,
    first_name text,
    last_name text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role_id character varying,
    phone text,
    status text DEFAULT 'active'::text NOT NULL,
    use_custom_schedule boolean DEFAULT false NOT NULL,
    last_login_at timestamp without time zone,
    disabled boolean DEFAULT false NOT NULL
);


ALTER TABLE public.users OWNER TO neondb_owner;

--
-- Name: working_hours; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.working_hours (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    day_of_week integer NOT NULL,
    start_time text,
    end_time text,
    is_working boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.working_hours OWNER TO neondb_owner;

--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.audit_logs (id, platform_admin_id, platform_admin_email, target_company_id, target_user_id, action, reason, details, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: calendar_assignments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.calendar_assignments (id, company_id, user_id, client_id, assigned_technician_ids, year, month, day, scheduled_date, scheduled_hour, auto_due_date, completed, completion_notes, job_number, scheduled_start_minutes, duration_minutes) FROM stdin;
3fd31adf-40e8-4005-be5e-361d2f47daa3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1ed6bdf6-c818-473f-9691-c61dd50342bf	\N	2025	12	5	2025-12-05	11	f	f	\N	10170	30	60
7eeb42ed-8b8b-43f8-9b7c-4b9364a48c58	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	\N	2025	12	5	2025-12-05	13	f	f	\N	10172	15	60
2344cd0f-dbb5-47dc-8781-f98140b3cbaa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	350a078c-7287-47ba-be4d-cfbcf06cb385	\N	2025	12	5	2025-12-05	15	f	f	\N	10173	15	60
f04313fe-a38d-490c-83d1-33d8df06dc5e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	\N	2025	11	9	2025-11-09	8	f	t	\N	10162	\N	60
bda194ef-995c-4c29-9182-244e2d6dc2c9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	\N	2026	4	15	2026-04-15	\N	t	f	\N	10174	\N	60
c64970c6-62b3-41f9-b7cc-44ab7c32f6e5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6ac36a43-b6ce-4861-940a-82b63c978b66	\N	2025	12	17	2025-12-17	8	f	f	\N	10178	30	60
ae64cc05-23e4-4034-8b73-db989b1f5a5a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58593e8c-21c7-4fb4-aee1-750e46f2138a	\N	2026	3	15	2026-03-15	\N	t	f	\N	10123	\N	60
7905af13-d581-42f7-a582-92dd781e0a84	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	35e050d1-2dc0-4d8a-899f-e614a823a4fe	\N	2025	12	17	2025-12-17	12	f	f	\N	10181	45	60
e101ebff-a575-4287-9af5-f0462ec6a16d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1ed6bdf6-c818-473f-9691-c61dd50342bf	\N	2027	6	15	2027-06-15	\N	t	f	\N	10185	\N	60
112b2299-c72e-4541-8210-8ab0d1958028	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	786e0752-2eff-4e49-a257-dcef9f8235ab	\N	2025	11	3	2025-11-03	\N	f	t	\N	10000	\N	60
4825e870-4756-4b5e-a1a4-822d93cbd902	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	\N	2025	11	3	2025-11-03	\N	f	t	\N	10001	\N	60
95f661b4-add5-4650-8b22-c25269760b18	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	\N	2025	11	3	2025-11-03	\N	f	t	\N	10002	\N	60
a4778569-b196-4c56-baee-5e796f054df0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f921231e-6543-44b5-a170-27c78165a725	\N	2025	11	3	2025-11-03	\N	f	t	\N	10003	\N	60
906d503a-8164-465b-880b-12cf065d11c6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	0bdfdf83-0667-4f3e-a342-1fb45583c5db	\N	2025	11	19	2025-11-19	9	f	f	\N	10168	15	60
075496fd-a697-4ae6-b1a6-9302ff108745	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1b96df6e-86c5-4431-bfc7-b83de5b1e89e	\N	2025	12	5	2025-12-05	10	f	f	\N	10171	30	60
0b713029-fcbd-4855-8542-34792ad6f5bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1b96df6e-86c5-4431-bfc7-b83de5b1e89e	\N	2026	12	15	2026-12-15	\N	t	f	\N	10176	\N	60
fb67f17d-d443-4910-9ca0-a00cdb9065c2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	\N	2026	6	15	2026-06-15	\N	t	f	\N	10177	\N	60
d21f782d-2159-4c1a-9148-1b909c1e1d71	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5401fe54-7a66-4e7d-bf7f-372a97ec0384	\N	2025	12	17	2025-12-17	9	f	f	\N	10179	45	60
835fa4cd-ee29-4d84-a226-3aa3ea872448	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1ed6bdf6-c818-473f-9691-c61dd50342bf	\N	2026	12	15	2026-12-15	\N	t	t	\N	10175	\N	60
b8c76938-f47a-4578-b10b-c413a16f104f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	84aedf96-bace-4700-b66c-33b47a3d3727	\N	2025	12	3	2025-12-03	\N	f	t	\N	10124	\N	60
09829a5c-08d3-4aff-8aae-fd265cc88aee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	\N	2025	12	3	2025-12-03	9	f	t	\N	10113	\N	60
fc62db9e-379f-45fd-823e-178054842b46	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	\N	2025	11	13	2025-11-13	7	f	f	\N	10163	\N	60
7f6eebd7-6f85-41ae-beeb-89808d59ccc0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	\N	2025	11	8	2025-11-08	\N	f	t	\N	10010	\N	60
7fdcc298-28f5-4d43-8e44-3a34f3dcef91	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	355eb33b-661e-4cf2-a31f-6ee97fbe94d7	\N	2025	12	17	2025-12-17	11	f	f	\N	10180	15	60
019e78a8-165c-41de-9c0a-23010596fb30	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	84aedf96-bace-4700-b66c-33b47a3d3727	\N	2026	3	15	2026-03-15	\N	t	f	\N	10125	\N	60
6ceaf9fc-be9e-4af2-ae05-e2f3f448fe6f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ad268884-c03d-41c5-95f8-eb7aee1be738	\N	2025	12	17	2025-12-17	14	f	f	\N	10182	15	60
26b350ae-8623-4986-bbae-985505a90395	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	\N	2025	11	20	2025-11-20	\N	f	t	\N	10028	\N	60
5ad543e9-deca-43f1-8bff-ef8eddadca01	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f12cdc98-f777-4c27-8756-cc8403caf8f0	\N	2025	11	20	2025-11-20	\N	f	t	\N	10029	\N	60
7fcf3c31-6e82-4e38-bfaa-48db20b2b93c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	aeeca3d9-4501-4ceb-a339-ef0ca832a913	\N	2025	12	18	2025-12-18	9	f	f	\N	10183	15	60
91bd7792-32e5-4afd-9048-d23342176526	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f882a557-3caf-483c-9773-2f446a42e675	\N	2025	11	4	2025-11-04	\N	f	t	\N	10004	\N	60
a851cee5-2811-4ee4-ad66-44d3623b7d9a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	\N	2025	11	4	2025-11-04	\N	f	t	\N	10005	\N	60
e9ecb8b5-fade-4e43-b77e-d3a2e580c66c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	\N	2025	11	4	2025-11-04	\N	f	t	\N	10006	\N	60
f23129ee-cc5f-43ba-941a-3c91754f2e80	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	\N	2025	11	4	2025-11-04	\N	f	t	\N	10007	\N	60
fb0b446b-e7db-4bde-b61c-1c38c26f761d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	\N	2025	11	4	2025-11-04	\N	f	t	\N	10008	\N	60
0b742941-0007-4906-a677-a139f9640fd0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	\N	2025	11	7	2025-11-07	\N	f	t	\N	10009	\N	60
ff60a23c-b960-4e9b-a6a7-7b0bb9d8b497	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	\N	2025	11	10	2025-11-10	\N	f	t	\N	10011	\N	60
de346869-6e85-417a-bcc3-2472f7dad1a8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	\N	2025	11	11	2025-11-11	\N	f	t	\N	10012	\N	60
018b43e5-b6dc-43ed-9cb9-6fd21276f7ca	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	\N	2025	11	12	2025-11-12	\N	f	t	\N	10013	\N	60
46ed6f69-980c-42d5-814d-c872abc0f023	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	\N	2025	11	12	2025-11-12	\N	f	t	\N	10014	\N	60
4a9dca7a-707c-4a13-853a-d9de7634ea5f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	\N	2025	11	12	2025-11-12	\N	f	t	\N	10015	\N	60
da68621e-4cc8-47b9-94f4-07472d2b5115	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	\N	2025	11	12	2025-11-12	\N	f	t	\N	10016	\N	60
3fae842b-b6ed-454a-b0d1-d01eae62b9ab	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	\N	2025	11	13	2025-11-13	\N	f	t	\N	10017	\N	60
92d6809b-038b-41e7-98b5-35544aed47ca	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	\N	2025	11	13	2025-11-13	\N	f	t	\N	10018	\N	60
afba657e-9b2c-4bca-8616-e2a5e7ffcfb1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	\N	2025	11	13	2025-11-13	\N	f	t	\N	10019	\N	60
e62a4175-fe93-43e3-8889-9b63a52cc115	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	\N	2025	11	13	2025-11-13	\N	f	t	\N	10020	\N	60
b23baf39-dd28-4864-a70d-a588123a8fb4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	\N	2025	11	17	2025-11-17	\N	f	t	\N	10021	\N	60
bcca4001-f120-47d9-a35d-0085d7fea907	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	\N	2025	11	17	2025-11-17	\N	f	t	\N	10022	\N	60
3088c057-40e1-4f72-b18a-18607e1462c1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	\N	2025	11	18	2025-11-18	\N	f	t	\N	10023	\N	60
a28c5e61-4fee-41d7-aadf-908d5fb54211	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	\N	2025	11	18	2025-11-18	\N	f	t	\N	10024	\N	60
5e30450c-f66f-4b86-acc1-8fe10bf09834	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	\N	2025	11	19	2025-11-19	\N	f	t	\N	10025	\N	60
d47acb82-0c48-4710-ae32-5e5e549949bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	\N	2025	11	19	2025-11-19	\N	f	t	\N	10026	\N	60
df7d0011-2707-489e-b7da-a3302b3c9f8d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	\N	2025	11	19	2025-11-19	\N	f	t	\N	10027	\N	60
7646ee04-b5b8-4f6d-8fd0-08587143c0cc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	\N	2025	11	20	2025-11-20	\N	f	t	\N	10030	\N	60
52afa288-5ef5-4b76-84eb-5ceebef0b695	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7235b45d-2c03-49f3-819a-eb9ba79f587d	\N	2025	11	24	2025-11-24	8	f	t	\N	10031	\N	60
06bec982-35ee-4a8f-a523-5d06d6d7c90b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	\N	2025	11	25	2025-11-25	14	f	t	\N	10032	\N	60
356e6c35-cab7-4eaf-92a9-e800ac61069c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ede5f914-3c1d-4859-8cf1-4998c0121e50	\N	2025	11	25	2025-11-25	8	f	t	\N	10033	\N	60
6cf566cc-a730-4b95-84f3-68bea955a48a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	\N	2025	11	25	2025-11-25	11	f	t	\N	10034	\N	60
7ed8698d-672f-48de-a787-aabd5d9b6f1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b4de6b16-b7ba-4e7d-b592-3e7053fd0d9f	\N	2025	11	25	2025-11-25	13	f	t	\N	10035	\N	60
81ed5c7e-ebdc-4fe0-a9ab-9ba96d2d3835	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	33cc1c52-22c1-40a0-9f67-5f79ce7b9752	\N	2025	11	25	2025-11-25	12	f	t	\N	10036	\N	60
846f04a8-a0f5-451d-a6dc-aa1ad5cdda2c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5a3db429-87b4-4e18-a6f6-0e332aa3e5f0	\N	2025	11	25	2025-11-25	9	f	t	\N	10037	\N	60
93352a75-8353-44e1-aefb-e19e799eec27	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	360a3b6a-3424-4561-b669-cb9e7c0eef8a	\N	2025	11	25	2025-11-25	15	f	t	\N	10038	\N	60
a5f19b18-fd15-42f4-bb89-75dcf2b532a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	\N	2025	11	25	2025-11-25	10	f	t	\N	10039	\N	60
4475a13f-da8d-4b77-aa94-e0230ae8d403	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1344835b-040a-46b5-bf4c-d244437cb961	\N	2025	11	26	2025-11-26	12	f	t	\N	10040	\N	60
4569b256-db4c-4c76-a89d-5a41a76c0c47	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	\N	2025	11	26	2025-11-26	13	f	t	\N	10041	\N	60
0a045de9-cd11-4303-adb1-b7999ed0a172	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	\N	2025	11	28	2025-11-28	11	f	t	\N	10042	\N	60
0b13586e-25bd-442a-b38a-d0645e1bca5a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	2025	11	28	2025-11-28	9	f	t	\N	10043	\N	60
596409e0-8840-4338-b30b-396e4f7643f9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	\N	2025	11	28	2025-11-28	12	f	t	\N	10044	\N	60
ee9c572b-1881-4d04-a8b6-f2c62ac13f43	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4b04535e-e0d8-4f43-8fcb-b94523c22045	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	2025	11	28	2025-11-28	10	f	t	\N	10045	\N	60
1af8f653-5b7a-47a7-937a-cb3f6df03882	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	\N	2025	11	29	2025-11-29	11	f	t	\N	10046	\N	60
715e0ac8-8362-4c1b-bae5-a1a117982738	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	dc8bfd92-9a14-4086-b1ca-e621e27ef31b	\N	2025	11	29	2025-11-29	10	f	t	\N	10047	\N	60
c7ab67ac-5000-48fe-849b-5c142c55f83b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	216082a6-9da6-4128-8a10-b594d90d9d18	\N	2025	12	18	2025-12-18	10	f	f	\N	10184	45	60
5a6c835c-a29a-4eb1-b0dd-0a891a61df26	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	\N	2025	12	1	2025-12-01	8	f	t	\N	10049	\N	60
b512cbba-1bb5-4392-9bf6-874bbee35878	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	304d8fbb-bd38-48a4-9b11-81cfc72282da	\N	2025	12	4	2025-12-04	\N	f	t	\N	10050	\N	60
28e5dbf7-6dde-4ab3-9d2e-ec24764c47b4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58593e8c-21c7-4fb4-aee1-750e46f2138a	\N	2025	12	3	2025-12-03	\N	f	t	\N	10051	\N	60
25b3adf4-eba8-43df-a153-7b1ca6558681	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9ccd993a-92c7-4294-8850-4700578261b6	\N	2025	12	5	2025-12-05	\N	f	t	\N	10052	\N	60
045d0a07-c820-4c0d-a96d-7159c0d3bd2e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	\N	2026	2	15	2026-02-15	\N	t	f	\N	10056	\N	60
050eb7ec-db89-47aa-b350-2de1716d02d0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	\N	2026	2	15	2026-02-15	\N	t	f	\N	10057	\N	60
0c250d31-dce3-4fb2-97d0-1c8121b8cfdf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	\N	2026	2	15	2026-02-15	\N	t	f	\N	10058	\N	60
18d70abb-793c-4226-84f1-71300fb7523e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	\N	2026	2	15	2026-02-15	\N	t	f	\N	10059	\N	60
1be05087-a1f8-4972-af6e-91f0f04f9f6b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	\N	2026	2	15	2026-02-15	\N	t	f	\N	10060	\N	60
1c957be4-feac-4d9a-9646-642edcbef538	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	\N	2026	2	15	2026-02-15	\N	t	f	\N	10061	\N	60
26a01f2b-d3d8-451c-a096-07ebfaf2aaa8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5a3db429-87b4-4e18-a6f6-0e332aa3e5f0	\N	2026	2	15	2026-02-15	\N	t	f	\N	10062	\N	60
2a81c8bc-d3f4-45f1-b29a-5adba64f0f56	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ede5f914-3c1d-4859-8cf1-4998c0121e50	\N	2026	2	15	2026-02-15	\N	t	f	\N	10063	\N	60
361a356e-54db-4389-9ba8-f4c746787c6d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7235b45d-2c03-49f3-819a-eb9ba79f587d	\N	2026	2	15	2026-02-15	\N	t	f	\N	10064	\N	60
423c2ce5-aac6-4536-aec1-dde0fe9d1a66	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f882a557-3caf-483c-9773-2f446a42e675	\N	2026	2	15	2026-02-15	\N	t	f	\N	10065	\N	60
42545bf5-3268-49a6-9f99-2748c94b144a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	\N	2026	2	15	2026-02-15	\N	t	t	\N	10066	\N	60
493b16f4-5b1c-4a7c-923c-9143e22eb412	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	\N	2026	2	15	2026-02-15	\N	t	f	\N	10067	\N	60
4f22de05-f9e4-49d6-aa49-1ad74a988054	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	\N	2026	2	15	2026-02-15	\N	t	f	\N	10068	\N	60
510d7f82-35a6-4be8-ae97-c758a364c2e2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	\N	2026	2	15	2026-02-15	\N	t	f	\N	10069	\N	60
706ef77b-3a8d-4073-abd5-3c71e298584a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	\N	2026	2	15	2026-02-15	\N	t	t	\N	10070	\N	60
71dced18-e837-472a-8af0-437c69838e81	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	\N	2026	2	15	2026-02-15	\N	t	f	\N	10071	\N	60
75e6c725-0762-4726-8f0a-ca045918e0f1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	\N	2026	2	15	2026-02-15	\N	t	f	\N	10072	\N	60
77c299bf-9f92-4e48-980b-91e861bcb39a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	\N	2026	2	15	2026-02-15	\N	t	t	\N	10073	\N	60
78bae374-2f9b-4dc6-95a0-1b3382325203	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	\N	2026	2	15	2026-02-15	\N	t	f	\N	10074	\N	60
8aa23752-5262-4aa3-b0b9-4a4effe30ffb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	\N	2026	2	15	2026-02-15	\N	t	t	\N	10075	\N	60
8c2fa962-62ee-4377-b6f0-05adb5f47b4e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1344835b-040a-46b5-bf4c-d244437cb961	\N	2026	2	15	2026-02-15	\N	t	f	\N	10076	\N	60
9497e6d6-fe42-4677-adcc-0cd132b4b5f8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	33cc1c52-22c1-40a0-9f67-5f79ce7b9752	\N	2026	2	15	2026-02-15	\N	t	f	\N	10077	\N	60
9b302db7-52b4-4b9e-9c47-6628ff660bd0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	\N	2026	2	15	2026-02-15	\N	t	f	\N	10078	\N	60
9e0c0b0d-c975-4a33-9445-891bb3c0f34c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	\N	2026	2	15	2026-02-15	\N	t	f	\N	10079	\N	60
a2a0dbc5-6375-464c-a518-77386801f65c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	786e0752-2eff-4e49-a257-dcef9f8235ab	\N	2026	2	15	2026-02-15	\N	t	f	\N	10080	\N	60
b8471cf4-25d0-42f3-ba49-5aa917560f52	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	\N	2026	2	15	2026-02-15	\N	t	f	\N	10081	\N	60
ba1468e5-932b-432e-b643-057e728f7f3f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	\N	2026	2	15	2026-02-15	\N	t	t	\N	10082	\N	60
bb5b1160-6468-4cd9-b9b8-70d19f0b557c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	360a3b6a-3424-4561-b669-cb9e7c0eef8a	\N	2026	2	15	2026-02-15	\N	t	f	\N	10083	\N	60
c83e753b-d15d-4fc5-a063-db8619b74108	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	\N	2026	2	15	2026-02-15	\N	t	f	\N	10084	\N	60
ca4d13f3-db96-4d4d-9c85-599dfaa1f556	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	\N	2026	2	15	2026-02-15	\N	t	f	\N	10085	\N	60
d7ae9b71-1145-4823-a3e8-84ab24f57226	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	\N	2026	2	15	2026-02-15	\N	t	f	\N	10086	\N	60
d8f6bbea-7741-4478-8d00-cdc324f883fa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	\N	2026	2	15	2026-02-15	\N	t	f	\N	10087	\N	60
dc29e4ec-5f03-4aa5-a826-efedf1370938	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	\N	2026	2	15	2026-02-15	\N	t	f	\N	10088	\N	60
e4437723-0fe5-46c0-beae-8e95d4a5586e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f12cdc98-f777-4c27-8756-cc8403caf8f0	\N	2026	2	15	2026-02-15	\N	t	f	\N	10089	\N	60
f5c39d4d-7c5c-4e5d-b297-33fea5dfae8a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f921231e-6543-44b5-a170-27c78165a725	\N	2026	2	15	2026-02-15	\N	t	f	\N	10090	\N	60
f966f3af-8d0d-4af6-a96b-3dadb3e793cd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	\N	2026	2	15	2026-02-15	\N	t	f	\N	10091	\N	60
1dba91ae-b1c1-4c7a-ac19-118f522de7db	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	\N	2026	3	15	2026-03-15	\N	t	f	\N	10092	\N	60
4dcac7f7-8d28-43b6-be7b-336adc43ffaa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	\N	2026	3	15	2026-03-15	\N	t	f	\N	10093	\N	60
c5a9d212-3dcd-4e18-a0de-2350e549c89d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	\N	2026	3	15	2026-03-15	\N	t	t	\N	10094	\N	60
cb6e5937-4eec-40d6-8d3e-e0beba2bd261	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	\N	2026	4	15	2026-04-15	\N	t	f	\N	10095	\N	60
34450bfc-dfec-4d7e-9ec9-b76ff94ae76b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	\N	2026	5	15	2026-05-15	\N	t	f	\N	10096	\N	60
488d089d-e0f9-400a-9a44-169adde1fcaf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	\N	2026	5	15	2026-05-15	\N	t	f	\N	10097	\N	60
4eae94ac-b3af-4dd7-9cfb-a2867e9fe500	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	\N	2026	5	15	2026-05-15	\N	t	f	\N	10098	\N	60
8a1ced94-9f65-4de1-85ec-92d9e41fff24	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	\N	2026	5	15	2026-05-15	\N	t	f	\N	10099	\N	60
ba9b7724-355c-4cd6-b4e0-d486f6c16caf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	\N	2026	5	15	2026-05-15	\N	t	f	\N	10100	\N	60
c362e549-cf4c-482b-bf0a-7f979816ab53	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	\N	2026	5	15	2026-05-15	\N	t	f	\N	10101	\N	60
e16dd20a-6201-4d7a-8b4c-17ec17e3c4df	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	\N	2026	5	15	2026-05-15	\N	t	f	\N	10102	\N	60
e2d2b3bd-97de-42ea-b9b1-62dcb60dbc72	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	\N	2026	5	15	2026-05-15	\N	t	f	\N	10103	\N	60
2b789027-ba31-46a1-ab40-73289138d8ab	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	\N	2026	6	15	2026-06-15	\N	t	f	\N	10104	\N	60
4dee186d-d5b2-44af-95a1-d75d58aa3aa9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	\N	2026	7	15	2026-07-15	\N	t	f	\N	10105	\N	60
2968dbd3-0899-47df-b00a-0db989fd912a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	\N	2026	8	15	2026-08-15	\N	t	f	\N	10106	\N	60
3b0e16af-53b3-4719-ae67-ace0820c6ae7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	\N	2026	11	15	2026-11-15	\N	t	f	\N	10107	\N	60
6d96aa15-27b6-4a02-96de-6378c0b78b79	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	\N	2026	11	15	2026-11-15	\N	t	f	\N	10108	\N	60
7f3180e5-89e2-4f0d-9e86-6709220039ed	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b4de6b16-b7ba-4e7d-b592-3e7053fd0d9f	\N	2026	11	15	2026-11-15	\N	t	f	\N	10109	\N	60
86259a7d-87ad-462e-9e07-0895c25ff34b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4b04535e-e0d8-4f43-8fcb-b94523c22045	\N	2026	11	15	2026-11-15	\N	t	f	\N	10110	\N	60
0e2c5b4e-ce57-4b10-9c73-f038a1442f1b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	5dab5734-67f4-4af7-8fce-0f66c895ceaf	\N	2025	11	1	2025-11-01	\N	f	f	\N	10000	\N	60
4da60920-17d8-43b0-b6b0-7e502bb8afe9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	97a4e69b-9cd9-4475-998c-03df0a48d664	\N	2025	11	4	2025-11-04	\N	f	f	\N	10001	\N	60
74113a90-91b0-49b0-9709-8a7787a4e37e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	2233293f-fe6b-4416-b544-70e1ce5b20f5	\N	2025	11	4	2025-11-04	\N	f	f	\N	10002	\N	60
a33e03c6-b9a7-4245-9920-0027b3b85ace	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	44b43ff0-736c-4918-bf0b-bfb26eb5ab65	\N	2025	11	5	2025-11-05	\N	f	f	\N	10003	\N	60
\.


--
-- Data for Name: client_notes; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.client_notes (id, company_id, client_id, user_id, note_text, created_at, updated_at) FROM stdin;
15a86d70-ad9a-4bca-a73c-91191874ea16	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	1e4fa7f8-7c43-4ec2-8512-30649a60b946	retr	2025-12-09 12:48:02.308815	2025-12-09 12:48:02.308815
a9aa71ad-abc3-4dd9-bdab-2529277288ac	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	1e4fa7f8-7c43-4ec2-8512-30649a60b946	sdfsadf	2025-12-09 12:48:05.342101	2025-12-09 12:48:05.342101
616be7ae-773f-4860-a33a-6654ebd793a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	1e4fa7f8-7c43-4ec2-8512-30649a60b946	asdfsadf	2025-12-09 12:48:12.437603	2025-12-09 12:48:12.437603
22e89165-7b73-480d-9c7d-0ad59f922268	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	1e4fa7f8-7c43-4ec2-8512-30649a60b946	main main	2025-12-09 12:48:16.875055	2025-12-09 15:28:16.893
\.


--
-- Data for Name: client_parts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.client_parts (id, company_id, user_id, client_id, part_id, quantity) FROM stdin;
10c26e42-ca02-4dec-bb0e-fb3683e8eb50	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	535a5559-e3be-40c7-9210-6124e939a910	c82637df-1844-49cd-b49e-de578a5336ee	1
3b2c5d02-042f-4f1f-b213-034b2336a0d5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	1befca0d-e752-4af7-9c96-f4f722d65aff	4
3dc5e154-d7b9-4f69-9b27-9feae169ceb2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	749f14cc-2129-4ab0-b4d3-e00125d75834	5
38f475eb-2bb5-47b6-b3d3-144a2a4e996d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	17fe4e93-1c6d-46a6-80b8-199ce103062d	4
672a2a3f-b390-4769-88c9-407337b8a80a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	a74b0bd1-5666-4be0-819d-d5d0407624d7	12
0615a4f5-0876-4d90-9b94-4316f7922dbb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	a74b0bd1-5666-4be0-819d-d5d0407624d7	12
4618711e-222b-46da-89e7-884f65c3340c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	f1d2d9e4-9063-4e99-b719-c5cfd7969588	4
2a3d835a-0200-4792-a0c4-0a1e148927f3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	e8077fc1-acde-4445-93fd-7ad1fa254708	1
f6463059-9708-4ae2-a463-36c74cb0f7e3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	f45a7184-6f70-4dfb-b337-42b44adb3d62	1
a8bca2ad-2edc-4b7b-9e4f-b40ed817afb2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	16
06beaf1f-2130-49c7-a036-2204a9d715da	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	fe36bf84-3c84-4dc7-85df-313653f69dfc	3
54a0a857-c0f6-4141-afbc-921cc0dd26a1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	3
4f3d452e-9797-41d3-b86b-7b637238ebc7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	3
c1f2c046-5600-4cbb-8eb2-bf3cf4994224	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	ebb580ca-8b49-42a3-9511-ea27317709ba	3
42bdfea0-4c13-4a9f-ba14-482019754f92	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7da0a45f-86ef-419b-845f-66fe206790e2	a74b0bd1-5666-4be0-819d-d5d0407624d7	12
a692cb73-e81d-4eb6-9026-4d12a2d7d639	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7da0a45f-86ef-419b-845f-66fe206790e2	2e337333-bfce-4664-930a-00b9807aef61	1
872c25ec-e9c2-482c-a3a8-9b8d75ed9261	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7da0a45f-86ef-419b-845f-66fe206790e2	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
420eb30e-815f-451f-9599-547b1b37c152	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	be080552-9d43-4beb-a46d-0bf21663f8f5	2
d6da9639-7561-4460-9391-2e6d330f8db6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	2358c5a3-e674-44e2-b0d2-43575462cf05	3
3641f964-3b8a-4e1d-a3d1-cbe735e73db0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	ebb580ca-8b49-42a3-9511-ea27317709ba	3
60a2dce3-586f-4e77-a5f1-fc7d14a9c0d2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	09425e3f-1326-414f-a906-028c60dc3854	1
b97098ad-71cc-404c-b9b5-2cd579f3c8b6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	a74b0bd1-5666-4be0-819d-d5d0407624d7	8
d537652b-f4c1-4383-bc10-a905ce0a75e4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	14aa485f-c66f-46d7-aadf-915ec4135e43	2
5e650b80-b584-44c5-9820-3cea2824412f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	755a34e3-3ef1-41e1-a62f-701db399f230	2
eed9f313-ff3f-4a4e-bbe0-d35f80eb09c3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8552fa04-a111-4aa5-bebb-d9de0100f226	860b8055-630c-4663-8a9d-593c62ffa7c1	2
aff46e77-f70a-4f7f-a82a-79fa9468fac6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	fe9a669e-4c24-47bf-9c44-c16d626df909	4
6a803e39-413d-4b33-bbda-92b3ae83a17e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	c82637df-1844-49cd-b49e-de578a5336ee	1
fb0ea65f-47a8-4b92-a84f-5e6cd505e40b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	ee751c1f-43ad-4306-b888-c6f2be48d089	1
890ce5f1-6376-4f76-8ada-3fa6440a2967	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	5c8f0479-cea1-4f28-86c4-6ad9092f2bb0	1
bf7a26cb-2298-48ca-94e3-678d93895035	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	09425e3f-1326-414f-a906-028c60dc3854	1
15c67698-55f6-4d1a-8175-6e922a143fa2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	1
8506f44c-13bd-431a-8eb4-ca45293194ea	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	fe36bf84-3c84-4dc7-85df-313653f69dfc	1
311e606c-163a-4822-ba0e-552e8a3fa3c2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	5c5406ed-e069-4564-aedb-d698abef3f11	1
526d8db7-5489-4e73-930e-a822f95f0b2f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	60043990-c0e6-467b-a7c6-9020fbe27032	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
49961d82-3ed4-42e0-b525-013e7fdaeb60	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	60043990-c0e6-467b-a7c6-9020fbe27032	09425e3f-1326-414f-a906-028c60dc3854	1
9852842a-9557-40dc-9eb0-0812259b78bd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	304d8fbb-bd38-48a4-9b11-81cfc72282da	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
64ea7e86-abca-4cb3-bd2a-a48c8900416b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	84aedf96-bace-4700-b66c-33b47a3d3727	a667364b-55af-4bb0-9e80-8e35bded0c30	4
e2a3a304-3628-4a05-8add-de6a8ea1e883	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	47c29ae3-c19e-4710-910d-f03ba9ed94bd	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
b5b2cb8a-f84a-4dee-b6ce-9ae628dee4f4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	47c29ae3-c19e-4710-910d-f03ba9ed94bd	cd122b13-e790-425d-8bcd-c402002ff3b5	1
ece491da-1d4f-4d8a-9154-0767a859d6d4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	47c29ae3-c19e-4710-910d-f03ba9ed94bd	08f6179c-f1ee-40c7-85aa-146a69959275	1
1716910f-6be2-4c81-a728-be7803d82626	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d29bf555-dfba-4dba-8a74-ff84ce3bf8ab	fc79fd1a-5504-4b81-a460-548627d93866	3
e55c0f5b-0e86-4a76-9f0c-45cf3e160db7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d29bf555-dfba-4dba-8a74-ff84ce3bf8ab	8ba4e20c-1466-4fa9-9875-6ac5defacbd1	3
9af418a7-12f9-4c79-8d6a-699356e1f84b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d29bf555-dfba-4dba-8a74-ff84ce3bf8ab	e8077fc1-acde-4445-93fd-7ad1fa254708	7
0c584377-ee9c-4d82-a6c7-cc69f74c2936	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	1
40f8ec2e-e5f6-4cb7-9676-42454c03e63a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	fe36bf84-3c84-4dc7-85df-313653f69dfc	1
01553827-1cbd-4eba-9b46-12506bf609e0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	09425e3f-1326-414f-a906-028c60dc3854	1
3045c409-1a7d-40f2-aa2f-05c974fe8fd3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f4e2c683-9e6a-4837-a711-6c9314bcde02	d163ffe0-f5a1-479e-a2f2-262f072f9238	6
b0bceba4-e175-4676-aec1-ff6b9afbd862	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f4e2c683-9e6a-4837-a711-6c9314bcde02	a667364b-55af-4bb0-9e80-8e35bded0c30	4
67c84db4-7db3-41fa-a73c-1155ec64486f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	2
b922a58d-bbe6-4436-9f7b-b4228d53ad48	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	fe36bf84-3c84-4dc7-85df-313653f69dfc	2
82583042-6d7d-4bfe-995e-137fb03d0742	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	d4f74f76-a1cc-460e-b7e9-914e4e83bc42	2
49d1fe5a-622d-485f-a0bb-c253654198bc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	350a078c-7287-47ba-be4d-cfbcf06cb385	ebb580ca-8b49-42a3-9511-ea27317709ba	8
3d0345ab-d655-47a6-b9ee-549f55550905	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	350a078c-7287-47ba-be4d-cfbcf06cb385	a667364b-55af-4bb0-9e80-8e35bded0c30	6
c0718faa-dfe0-46d4-a6c8-f91106623e3f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	350a078c-7287-47ba-be4d-cfbcf06cb385	d5f6a189-3f0f-49ea-a576-0059f549e5a5	1
23ff737b-f7d8-4b35-98db-bccfb28c14bd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	350a078c-7287-47ba-be4d-cfbcf06cb385	b2dc75dd-d2a5-430d-bd27-a05372041fe9	1
fcba44c8-7d3e-419c-a0f9-85782ded212f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	626c6928-d8a1-4710-b34a-12c314f0ac6f	1
14ab4728-fb34-475e-948a-371bb968accf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	8e483d34-a38d-4ef7-b829-19761ce44cdb	1
625e2304-b4e7-4300-97ac-01cd08c0fefc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	5e5fbf08-b2d5-4430-8ede-5cfd39587444	3
6cf1302f-83cd-44b9-b0c0-b17f3c47b2bc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ede5f914-3c1d-4859-8cf1-4998c0121e50	be080552-9d43-4beb-a46d-0bf21663f8f5	1
bb1a7952-b1ac-4bdb-9fe9-6a700e93a081	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	87ca7295-3b56-4c5c-b0ea-b828dbbf99a5	1
824a07b0-6b4a-4203-8e8d-769a5620b9f6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	1619536f-4247-456e-be6d-15810afaf234	1
79b21f16-19cd-4bd1-9c8f-3c89fca6ef1d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	491c69c0-a918-4d31-96f3-879ea4e83839	1befca0d-e752-4af7-9c96-f4f722d65aff	2
1230af90-1d1d-40d0-b375-16a8c3ba9af7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	3725e3f8-65e1-4cb2-a253-616a351bd41c	2
f8cbbec0-a659-4acf-bfba-2e6664c944fc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	6
bb1c5d45-2755-409f-a405-c82c129ef4f6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4a8a2da7-8b65-490f-921c-fab6fb253f5e	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	12
8daa186c-04d6-4fc3-9e77-752be4b31dc6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4a8a2da7-8b65-490f-921c-fab6fb253f5e	83bb34e7-99de-4ace-a2e3-34a5fcdd6bc2	1
29600cc3-eec6-4bae-b661-dadb3a88d3ac	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4a8a2da7-8b65-490f-921c-fab6fb253f5e	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	1
1ff78183-37b4-41aa-8b29-a9515dbd591c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4a8a2da7-8b65-490f-921c-fab6fb253f5e	ae9f2f48-c47d-4042-a097-571a86c1156e	3
9d9b43c8-05c9-484f-bace-f3c0d29789e4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	1
9521fa23-45ff-460f-be2d-d3acba39be70	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	ebb580ca-8b49-42a3-9511-ea27317709ba	3
791cb4c2-8856-401d-b413-ce5789ff037f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	12
ee352539-f91d-4446-a4fe-5a3cb57a2ff3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	284d1ca8-343b-4e5e-b2f0-5fd7edc2ebe2	2
d9211ba2-2bb2-4386-96dd-efbfa56100a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	626c6928-d8a1-4710-b34a-12c314f0ac6f	1
8f4e5377-1b90-45e1-967d-2c7dfd3d68d3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	1619536f-4247-456e-be6d-15810afaf234	1
084a8165-9b7e-4b65-91c6-8712f130f870	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	8e483d34-a38d-4ef7-b829-19761ce44cdb	1
8326f656-fc94-4302-b2a0-d9234ad2c0a0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	384cd998-1578-4b8f-a953-5fe740c1ef7f	2
afd61e8e-fe4c-4db3-8010-9413ae65c19e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	fe9a669e-4c24-47bf-9c44-c16d626df909	4
5d64eb5c-50f5-4814-8708-30eb725d0384	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	535a5559-e3be-40c7-9210-6124e939a910	a667364b-55af-4bb0-9e80-8e35bded0c30	1
d2607d5c-2c83-43d4-b518-3eea20c961ee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	535a5559-e3be-40c7-9210-6124e939a910	46ca8a6d-4d4a-4a8f-ad73-6aa15ab03000	1
aa0d73e1-ee4e-4e93-9032-c9d706fd7030	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	535a5559-e3be-40c7-9210-6124e939a910	28177117-e857-4b44-808c-1b57dfa04eaa	2
38369822-b94e-426b-a1e2-f71ea10fc22b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	1619536f-4247-456e-be6d-15810afaf234	1
151d6725-c53a-4a95-afc8-d1eac3fd3767	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	93e8b9a8-03e5-4483-8ec9-9a67c579f35c	1
2244a34c-1f15-4c2b-8913-8a336efa736b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7da0a45f-86ef-419b-845f-66fe206790e2	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	1
838f71be-3f53-4b7b-9ae3-c52222813f4c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7da0a45f-86ef-419b-845f-66fe206790e2	5e5fbf08-b2d5-4430-8ede-5cfd39587444	2
86ebf368-01c5-445f-b9a3-a90bac2e3adb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	0a74052f-2cbb-4d78-8630-ea057b9a5ca9	1
14996d25-187d-404a-b6fa-5bad60867f4e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	ebb580ca-8b49-42a3-9511-ea27317709ba	4
d0227562-9a91-48b4-8782-a90e41d9a508	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	7cb40bf9-807a-4c7a-8312-c67a0322c795	1
5c4ed385-df1b-46b9-8d9c-8a694d832e73	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	60b05d1f-9639-4687-bb63-0913c67561fc	2
c92b132a-e1dc-4899-b481-fb2cada31b14	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f7fd2486-a92e-4a7d-9583-218822bfc4e2	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	1
44ff663c-ef6a-42fe-8965-c33075ccc581	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ede5f914-3c1d-4859-8cf1-4998c0121e50	1619536f-4247-456e-be6d-15810afaf234	1
632f5428-8d3f-4879-bc52-bb81928aa1ef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	2
e75222c8-6311-411d-8003-0ea2bc393e7c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	09425e3f-1326-414f-a906-028c60dc3854	1
a7148e8e-8328-4fc9-a735-f29345417ccd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	11bfd1f8-ae9e-4a00-ad33-f11139bb24bb	1
62614dcb-cc50-482c-a754-aa4ee4ba9533	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	e2e47cf1-8905-476e-9df0-fdf6c5c4cda0	2
5093cf7a-2ea7-4e6b-a506-c9c44fbf2e45	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	8
58520bb3-d83a-4977-8b0e-b8031e435f19	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	278dff0f-9189-4929-8fb7-3e9ec31972b3	1
631fbd8e-9f7b-40d0-a2da-b11032d5f662	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b384cc61-449c-4077-b410-adae6ee2dea9	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
c666d14a-fa21-48d4-8dff-0b353458ce19	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b384cc61-449c-4077-b410-adae6ee2dea9	05b0581a-6d67-4323-81f0-ea5d50f53c1a	2
840d578e-17d7-4666-9ec1-fb39a5d8f9ca	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	0bdfdf83-0667-4f3e-a342-1fb45583c5db	a667364b-55af-4bb0-9e80-8e35bded0c30	8
a3fd1b9d-5721-4037-9fb3-bf189572f133	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	0bdfdf83-0667-4f3e-a342-1fb45583c5db	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	1
81698897-e305-4178-8138-76d5ea5bb167	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
98c7603a-f9a2-4a1a-8c09-2795ff3984e7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	5a6a2603-3138-4c7d-aee3-791cdaf6f568	1
b33fe00e-46a2-4120-b66c-27ddc55395a3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	7cb40bf9-807a-4c7a-8312-c67a0322c795	2
435cd37a-2dce-4c18-98b4-7c2b600db739	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	3b79b43f-536d-4e20-81f9-a42bbda7e504	1
9caec23b-fce9-4c26-b799-2402b68de2a0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	2
96d5a5de-8741-49d8-a99b-155d996e4d02	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	ebb580ca-8b49-42a3-9511-ea27317709ba	4
b8aee755-e4e4-416c-9f14-5043116e2211	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	fe36bf84-3c84-4dc7-85df-313653f69dfc	2
af0e7a63-6edb-4f30-97b7-62ca60c1db19	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	3c37b6c5-5339-4702-a2bb-c316ff44813e	1
04f11121-fe5e-40d0-8635-005e6536a021	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	8
15c91c6b-71aa-4833-acd8-cb2e4436b20e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	1
0db387a5-ad57-4608-ae4a-13740cbcb0c3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	fc79fd1a-5504-4b81-a460-548627d93866	2
81e2d5eb-7c32-4538-a9cc-ae62b83faab7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	ebb580ca-8b49-42a3-9511-ea27317709ba	4
683a2861-a58a-4405-999e-9b4e9af4f862	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	56d564b2-f3b6-4dcf-936a-2b3e960fc70b	fc79fd1a-5504-4b81-a460-548627d93866	6
ab7423cd-4d23-4467-af1b-0a938d8314c4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	90cde655-661a-473e-bb6f-5a9a0cf77019	d3248cac-d5b7-4e2b-9f0c-5ac9035258bf	2
a5a3091c-92cf-4a57-965d-f7c08008ca4a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6012b6f0-c7eb-44b4-bc7e-7d776847fb98	278dff0f-9189-4929-8fb7-3e9ec31972b3	1
8d5da6f6-b1c9-4f58-a1ff-3842f4191d7b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6012b6f0-c7eb-44b4-bc7e-7d776847fb98	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	8
5e19f356-8d53-42c0-9b13-91bf835ee789	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	d163ffe0-f5a1-479e-a2f2-262f072f9238	4
23cb2185-3d9c-4ab7-8c01-f69be058e07b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fc759e97-0f99-4ffe-9a20-6455e6aa52ba	a74b0bd1-5666-4be0-819d-d5d0407624d7	12
612ba359-ed8d-44a2-a986-b6329e042011	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fc759e97-0f99-4ffe-9a20-6455e6aa52ba	5a849ff6-56cf-4288-87ff-4653e63e0795	1
31515879-7848-4cab-a0f5-f305289a5e69	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fc759e97-0f99-4ffe-9a20-6455e6aa52ba	93e8b9a8-03e5-4483-8ec9-9a67c579f35c	1
d610cacd-b0ac-409a-a63a-bedff1aaf8b9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fc759e97-0f99-4ffe-9a20-6455e6aa52ba	384cd998-1578-4b8f-a953-5fe740c1ef7f	1
28b50d43-0c4b-4b66-aeda-90adb73f32ec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fc759e97-0f99-4ffe-9a20-6455e6aa52ba	ebb580ca-8b49-42a3-9511-ea27317709ba	4
ec2a1632-502a-496a-b004-e959affc861c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1f1eb8e8-3a75-447e-84fc-c0de7e33075a	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	12
a8452fbd-6855-4232-a2aa-90098ea7c6aa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1f1eb8e8-3a75-447e-84fc-c0de7e33075a	e14c3d2a-ffd7-4894-adb7-e3f491ba008b	1
6389368b-ed8d-4198-a4ed-9b4f156c7b5b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1f1eb8e8-3a75-447e-84fc-c0de7e33075a	6983916d-e2d6-462c-843d-2258bfe9a3dc	2
a0332a55-c7ee-4778-b829-ef694a7ae5e8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1f1eb8e8-3a75-447e-84fc-c0de7e33075a	3725e3f8-65e1-4cb2-a253-616a351bd41c	3
337ece03-c27a-4d11-9a00-cbd49ec4e3ea	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1f1eb8e8-3a75-447e-84fc-c0de7e33075a	ebb580ca-8b49-42a3-9511-ea27317709ba	8
f7df1b4c-da36-49b8-99ab-5c2f4acb3f7c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	1619536f-4247-456e-be6d-15810afaf234	2
37295dc6-a10f-4a96-b16c-31d70cef3f07	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	81f451d2-14e9-4bde-8d46-85c849510cc7	1
ab33e3c5-ab1b-44ee-b453-1ad996e6ff73	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	5a6a2603-3138-4c7d-aee3-791cdaf6f568	2
71a166d0-79e7-4c80-af2c-3aa258ae126f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	8
9929952a-fd03-4b34-b45a-63fc89e3df0b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	347201b2-c401-46e3-aa1e-95bc60da2eec	1
443aa457-5975-45af-a83c-e86874351a04	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f7fd2486-a92e-4a7d-9583-218822bfc4e2	a667364b-55af-4bb0-9e80-8e35bded0c30	4
397c4408-d2ed-4421-ae8b-5fa0057b3bf8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f12cdc98-f777-4c27-8756-cc8403caf8f0	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	4
c6bfb8b2-89a8-4ba9-bd45-49f2fb662139	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6213a22a-4dec-41d5-96cf-1f4718a8f603	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
b7105d98-2ece-44cd-9ea4-5d53a8580cb7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6213a22a-4dec-41d5-96cf-1f4718a8f603	d567e591-d37e-4faa-af2b-464c5dc6321e	2
43fe6dbf-032e-4de2-ba18-9004f45a2919	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
d9339844-0072-45cd-8c6d-3325c435f3eb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	1fd0b54e-df38-4068-870f-d4dfcb037a84	1
492a323d-e6df-4bd8-a798-c329a8e86b7a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	6f070730-01b5-4d59-808a-5d87d1a1bc85	2
0a3bee21-5e9a-4a94-8574-f1dd4de3ee3a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
14600c3f-6a9a-476c-a515-8c1419eb5b3f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	09425e3f-1326-414f-a906-028c60dc3854	1
efe714ab-71aa-4f74-85bf-f7ed354946a0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	7e6a63ff-43a5-4e79-aef3-e02bcb791a25	1
32dd9a63-19fc-4541-82fa-3031dc522f4d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	ebb580ca-8b49-42a3-9511-ea27317709ba	8
75f50bca-f4ed-47c7-944b-4395a5a2b75d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	565e8eac-2b5b-40cd-bc7a-ef0e725d2cae	1
8fa758fa-dcce-4a01-9fb1-2923510cf485	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
bedaeb86-23d7-42b4-b403-514ddeeefead	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	a667364b-55af-4bb0-9e80-8e35bded0c30	4
58611e4a-e3a6-44e2-a495-4bb661f78e5b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	6
355a4b1a-0dab-4576-812c-1bcabe6eeb4e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
06574f69-9275-43c4-b0fc-0ce9d4ffa5c6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	09425e3f-1326-414f-a906-028c60dc3854	1
b1461564-9561-4326-8734-04068cb6af76	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	3017605c-71c0-45b3-989e-bf4aca6a809b	1
9c4aae0a-ec42-4f3c-be5f-b84a40851f12	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	7c07e749-5420-4261-974a-9d79c94ca2d9	1
e8afc99c-fa71-4197-b4ff-d983257d9884	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d810dbfd-af66-406f-872f-bc551c0a5a55	7e6a63ff-43a5-4e79-aef3-e02bcb791a25	1
b2a10fb0-7e84-41d6-911a-8d05ad4d01c6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	e16ff62c-88bf-43ba-b656-f32419b61c84	1
be02cab5-375a-41c5-a572-60dfe727c4c6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	3
8bdb5ab8-ac0d-4d71-94ce-1c7538432c33	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	6983916d-e2d6-462c-843d-2258bfe9a3dc	1
571db34c-5aaf-41ae-912d-6fa789044c15	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5958dbda-7eaa-4735-ac9c-2a00f4591edf	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	1
caa93c25-c9b1-4a29-8a05-6cd52b89a042	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f7fd2486-a92e-4a7d-9583-218822bfc4e2	46f00891-760a-4ba8-9c6b-34f501c59197	2
3cea1a7c-a038-44b5-9d5c-6adf891dd72f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f12cdc98-f777-4c27-8756-cc8403caf8f0	3851c275-5edf-4880-b24b-4a47e9de544c	1
83091435-b446-42ed-8183-054fc7e09af5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	fe36bf84-3c84-4dc7-85df-313653f69dfc	2
df4d79e7-9b67-44b4-ba64-d15fdf1c3804	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	0ef16ecf-5ad7-45bd-b245-161ba662dba7	1
b405791f-b7d6-4ef5-b776-66f022c2fc28	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	a74b0bd1-5666-4be0-819d-d5d0407624d7	8
60cc958b-d1b2-43c6-971e-835d2298920b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	c82637df-1844-49cd-b49e-de578a5336ee	2
a8c8d9e6-d828-4946-9b63-29cd1fc43937	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b384cc61-449c-4077-b410-adae6ee2dea9	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	1
bb01a0ae-35b5-4d26-9dea-b01b8416509d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b384cc61-449c-4077-b410-adae6ee2dea9	29b045d9-28bb-4562-9d86-fee1ea95aafa	1
6995d5fa-cdbb-4872-a158-40470eaf7221	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	0bdfdf83-0667-4f3e-a342-1fb45583c5db	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	1
bdab08aa-7851-48c8-bee1-19d6394d0b80	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	0bdfdf83-0667-4f3e-a342-1fb45583c5db	ae9f2f48-c47d-4042-a097-571a86c1156e	2
4a31d032-0c36-4d8b-819a-aaa07ce6518c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	b7ed22a4-a765-4ee3-b3ca-280e73174330	4
a7ebeb7d-89d2-4bbf-b944-ab0c08f84991	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	2
c818e72a-95e2-4737-90cb-922944f718ea	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	31bde08e-7ba1-40d5-a508-14389ecc010a	2
4d8184d6-63f4-4db0-8f34-05ca2981adc5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	ebb580ca-8b49-42a3-9511-ea27317709ba	8
c3de2b0e-9102-4315-97ee-d737a65cdda3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	5a6a2603-3138-4c7d-aee3-791cdaf6f568	4
6349f121-5cac-4047-b3f5-789e1fe0f102	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	1
90f2a904-9b04-41dd-bdc2-aa2f07e2a933	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	a667364b-55af-4bb0-9e80-8e35bded0c30	4
59316503-bb0a-460b-afb3-1df4026e4d22	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	2
5944c2b4-6dd4-4642-887f-7f3b58d65b14	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	1
c08b61db-7ce3-4307-9fce-e62d06e3b4b1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	09425e3f-1326-414f-a906-028c60dc3854	2
bd97fa70-3b76-4d5c-8558-f5d5557d4ae8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	f54ee6af-808d-4715-995d-1ad30866384b	2
10e0a2be-93ea-4a20-b28e-52a81caa8d41	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	46ca8a6d-4d4a-4a8f-ad73-6aa15ab03000	2
605b3207-6719-4d26-a496-feb2c90c14c6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	d567e591-d37e-4faa-af2b-464c5dc6321e	2
0048aaf5-6d8b-440c-8c4d-ff1f87c3a6b8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
6b4a1f2b-07db-45e8-82dd-15350cbb7aa4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	b2dc75dd-d2a5-430d-bd27-a05372041fe9	1
04da3e0c-0540-4f1a-b05f-5ba8f75171bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	90cde655-661a-473e-bb6f-5a9a0cf77019	a74b0bd1-5666-4be0-819d-d5d0407624d7	4
a50975fd-a328-45bd-8620-bca29ff0e3c9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9400d77b-99b1-4f60-892c-7f897c64847a	1befca0d-e752-4af7-9c96-f4f722d65aff	2
f043ac54-8bd7-4f6f-a05a-47f4a499717c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6012b6f0-c7eb-44b4-bc7e-7d776847fb98	3851c275-5edf-4880-b24b-4a47e9de544c	8
48d719dd-2a8c-4a07-baec-dbbc66b97fda	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5401fe54-7a66-4e7d-bf7f-372a97ec0384	b2dc75dd-d2a5-430d-bd27-a05372041fe9	1
4e50c465-3fe3-4348-b74c-f0533845d4a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5401fe54-7a66-4e7d-bf7f-372a97ec0384	ebb580ca-8b49-42a3-9511-ea27317709ba	4
f2c3c4c5-98de-49aa-a61f-308365a75e81	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5401fe54-7a66-4e7d-bf7f-372a97ec0384	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	2
18f56667-ffb1-46e4-8d22-a6d7242a42cb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	355eb33b-661e-4cf2-a31f-6ee97fbe94d7	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	8
64f7606e-2949-4cfb-a73f-b4c39414c5b6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	355eb33b-661e-4cf2-a31f-6ee97fbe94d7	f54ee6af-808d-4715-995d-1ad30866384b	2
72dbfb2b-7820-4db8-96c8-414a4e5886f1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	355eb33b-661e-4cf2-a31f-6ee97fbe94d7	7cb40bf9-807a-4c7a-8312-c67a0322c795	1
09b81079-99ba-438a-9a51-dca99febddef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6ac36a43-b6ce-4861-940a-82b63c978b66	ebb580ca-8b49-42a3-9511-ea27317709ba	8
ea0ecb6b-a4c1-41a3-9277-2c50e993bdf8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6ac36a43-b6ce-4861-940a-82b63c978b66	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	2
49044e53-dbb8-4b4b-95d3-42559b67c3ba	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6ac36a43-b6ce-4861-940a-82b63c978b66	e66836f4-34bc-44a7-93b2-f3d7fb950b5f	2
c2b5e705-a726-4ee7-b5c4-90c4415b05c1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	ebb580ca-8b49-42a3-9511-ea27317709ba	8
fb1f0631-50e5-488b-9443-db187bb4f456	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	b2dc75dd-d2a5-430d-bd27-a05372041fe9	1
df871fa0-c85b-4aeb-ae2a-30a0d13d9a47	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	1
5f09229a-fb36-4e58-bd99-20230ea0f562	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	1
0519fe8e-c628-4a43-8962-fb94f7cb928d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	a74b0bd1-5666-4be0-819d-d5d0407624d7	6
b09c8d48-9c59-4e0a-b2e6-5c466b5a7deb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	fe9a669e-4c24-47bf-9c44-c16d626df909	6
244fc606-4b3c-4f53-adb8-d1c4c06ca5a0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	3851c275-5edf-4880-b24b-4a47e9de544c	4
c6dd662e-355f-4cc0-a2cd-2c6c98145c05	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	f54ee6af-808d-4715-995d-1ad30866384b	2
05d4f3a9-5d2d-479f-9e83-f7d33cc50081	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	fc79fd1a-5504-4b81-a460-548627d93866	2
0a3152c0-0155-4f24-992a-6aeedde80720	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	5c8f0479-cea1-4f28-86c4-6ad9092f2bb0	1
406fc61d-d09a-421b-a5b0-d94bbf008de6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	a667364b-55af-4bb0-9e80-8e35bded0c30	4
27043183-a81b-41db-a41b-1faf75e113fc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	2e337333-bfce-4664-930a-00b9807aef61	1
5d6d5693-7fa8-417c-8208-e4bf2eda2009	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	1befca0d-e752-4af7-9c96-f4f722d65aff	2
8533d1f0-132a-4ce4-927b-9049172785fb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	2358c5a3-e674-44e2-b0d2-43575462cf05	1
0571e95e-09a1-4f46-9826-34c4c2800ddf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	ebc13ac6-fd51-4a10-939a-10e20cae209a	2
b1990ea0-1895-4122-a47c-f7f20ffa4293	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	fc79fd1a-5504-4b81-a460-548627d93866	1
2812ed44-d943-4b40-9239-66c47c1437a8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	360a3b6a-3424-4561-b669-cb9e7c0eef8a	1befca0d-e752-4af7-9c96-f4f722d65aff	1
68a822ff-de2a-4ede-8b0c-97ea248efcd3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	360a3b6a-3424-4561-b669-cb9e7c0eef8a	749f14cc-2129-4ab0-b4d3-e00125d75834	4
aa373281-1971-4160-a110-e2d1831289a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5a3db429-87b4-4e18-a6f6-0e332aa3e5f0	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	1
a79954e2-a030-49d0-a1ac-253d99390b27	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	33cc1c52-22c1-40a0-9f67-5f79ce7b9752	fc79fd1a-5504-4b81-a460-548627d93866	6
52f06eb0-2f50-4d0a-88b9-3ab90f912889	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9a09b941-c817-4e8d-976f-85dfd138c2f4	66f7bc35-b52b-43d3-a29f-46c11ec03e3b	1
283d57c6-3949-4352-ab93-f26c23d452c2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9a09b941-c817-4e8d-976f-85dfd138c2f4	a667364b-55af-4bb0-9e80-8e35bded0c30	6
03291cc8-dfee-48ca-b4d6-ce5bf1145328	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	06b50260-0dd6-40aa-a7c1-c773edee30d7	cd122b13-e790-425d-8bcd-c402002ff3b5	1
e69e6ade-d0a5-4f57-824a-ef0a4d497bf5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	06b50260-0dd6-40aa-a7c1-c773edee30d7	a667364b-55af-4bb0-9e80-8e35bded0c30	4
d6549b85-9f0e-4a68-93b9-93f59372de34	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	06b50260-0dd6-40aa-a7c1-c773edee30d7	626c6928-d8a1-4710-b34a-12c314f0ac6f	1
586e502a-2fd1-4765-b832-98cbc1f54850	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	48167021-747d-47ae-a307-a74e06e30099	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	8
0dc58901-331f-45c6-8ca5-1d7b7cc33cf8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	48167021-747d-47ae-a307-a74e06e30099	17fe4e93-1c6d-46a6-80b8-199ce103062d	6
e788cd49-f6dc-41d6-8353-14f7549b5a67	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	48167021-747d-47ae-a307-a74e06e30099	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	1
cdf056d0-01e7-44e5-a766-2091e1c0edfc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	48167021-747d-47ae-a307-a74e06e30099	fe36bf84-3c84-4dc7-85df-313653f69dfc	1
4f66e140-a47f-40c9-877d-8f246aa3fa13	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	733bbd75-74df-4287-99e5-5e1e81aa6775	fe36bf84-3c84-4dc7-85df-313653f69dfc	2
ab6d13b3-8978-4cb0-b8ea-157a9dd5529f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	733bbd75-74df-4287-99e5-5e1e81aa6775	03329b2e-53fe-4d02-8133-6263da9206d4	1
ce7a13f6-997b-40b8-a0f2-f7d9b23721e0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	733bbd75-74df-4287-99e5-5e1e81aa6775	e25db10d-2abe-4643-a1e7-a2fc72bc9d95	2
298da80e-6ef7-4a37-946d-7be9739e6e81	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	733bbd75-74df-4287-99e5-5e1e81aa6775	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	1
6d36db31-32a3-41be-90d8-4ce49475d0eb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	75f941e0-3d70-4550-8b38-ab51df9a0813	17fe4e93-1c6d-46a6-80b8-199ce103062d	1
96dd8672-73f8-47d9-bcdd-db8600f5ecc0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	75f941e0-3d70-4550-8b38-ab51df9a0813	11bfd1f8-ae9e-4a00-ad33-f11139bb24bb	1
4a248307-debe-400e-b34e-7c7a03a63341	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	75f941e0-3d70-4550-8b38-ab51df9a0813	8093a396-bd0e-4783-bea4-2c098b5c5a1a	1
9f624bbc-d119-4480-b389-a624e41f2960	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	75f941e0-3d70-4550-8b38-ab51df9a0813	7e6a63ff-43a5-4e79-aef3-e02bcb791a25	1
caac30a7-7cec-45c9-a1cc-9052a26d8d85	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	75f941e0-3d70-4550-8b38-ab51df9a0813	5a6a2603-3138-4c7d-aee3-791cdaf6f568	6
cb8b2df7-7269-45db-9a74-f1d08f104bbb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	12
430a25d3-9317-4713-8f7e-67723fc72b7c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	a667364b-55af-4bb0-9e80-8e35bded0c30	4
caa7743c-b2c9-4655-9938-932cdb51ace4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	4
35bd4db1-688e-41b7-b0f7-c6c03bf082e8	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	957c4c59-e4ff-4418-81c9-4e790cd827d7	cb92f8a4-2ad8-4ed5-a60f-57c234c88d7a	2
c515077d-1617-4092-91fe-7fab9562370c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	957c4c59-e4ff-4418-81c9-4e790cd827d7	35a3f496-e522-4c94-b8a4-b6a5e5a5edd5	1
8f9d6332-357c-4794-902c-8c6693abd368	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	957c4c59-e4ff-4418-81c9-4e790cd827d7	9f20b3c4-326e-41e8-9e50-96eac957adf2	1
90528380-f80a-4c75-bd00-4532ec98fdc9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	5dab5734-67f4-4af7-8fce-0f66c895ceaf	440903c5-8e04-45fd-8ff6-ac15936e0f58	12
f4e88ceb-638f-4e78-9e7e-7eca186af199	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	5dab5734-67f4-4af7-8fce-0f66c895ceaf	bf103c0a-1f01-4743-b4ad-1914c92a1493	3
d9208cab-329d-43b4-9dca-b746de912d19	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	ec509fda-191f-4ba7-bf67-8550d9b03bc3	901f9984-dc8a-48fd-ab4c-31b6082e00ee	1
30774d38-0c8b-4825-af21-5ff8a0e1c69e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	ec509fda-191f-4ba7-bf67-8550d9b03bc3	440903c5-8e04-45fd-8ff6-ac15936e0f58	24
1929368a-c048-4f46-ae38-007afe39c1f4	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	ec509fda-191f-4ba7-bf67-8550d9b03bc3	352138ec-6f4e-4ac6-b752-fd397025b182	1
c209efb6-e35f-41a8-940a-3770d8bc2c65	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	97a4e69b-9cd9-4475-998c-03df0a48d664	cb92f8a4-2ad8-4ed5-a60f-57c234c88d7a	2
9e3c3524-9457-4195-b07f-51ef95215e55	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	97a4e69b-9cd9-4475-998c-03df0a48d664	37817878-eeb8-496f-953c-17f16ed7c93c	1
89eb63e9-f789-464d-b7f8-52f34ac1932f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	0e67a4d0-2249-46e9-b1fe-5f8575f153c1	11b58990-78f6-4f19-9011-934bbc8f0ea7	4
02c42a21-5383-4534-8ddc-f7aed4ca7d3f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	6caa0582-8b82-4abc-bee7-abc8e36f7ada	08da42b8-baaa-450e-9e25-24b37bd0220f	4
5b5e6e5d-0d83-4eba-984a-9d5b1df7417a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	6caa0582-8b82-4abc-bee7-abc8e36f7ada	c029eb56-ab4f-437a-a68a-e8e5f98e3070	1
6a8773f9-85de-4154-93ba-5533c0e5d226	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	3d19ad86-a2a5-409a-a4d6-5585bf5fc571	c10356db-6e3c-4517-a18e-2aae2c2b4dd1	1
d20de04f-8cef-44d1-96da-a3cfd0371338	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	3d19ad86-a2a5-409a-a4d6-5585bf5fc571	11b58990-78f6-4f19-9011-934bbc8f0ea7	4
467636ae-fb20-4435-be05-667cd6bfadb5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	2233293f-fe6b-4416-b544-70e1ce5b20f5	08da42b8-baaa-450e-9e25-24b37bd0220f	4
9667086d-b563-4989-b5e9-e111d11e19be	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	2233293f-fe6b-4416-b544-70e1ce5b20f5	cb92f8a4-2ad8-4ed5-a60f-57c234c88d7a	2
bee5ece2-82ee-4a75-8ddd-336b2596ccf2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	2233293f-fe6b-4416-b544-70e1ce5b20f5	c029eb56-ab4f-437a-a68a-e8e5f98e3070	2
fadbe269-8088-49ec-ba23-e93f15f4dbe5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	94828ff0-b1d5-4548-90ef-15b9d97dcd36	08da42b8-baaa-450e-9e25-24b37bd0220f	4
b78b88ea-3e23-4fc1-a19d-3dad4c6ab718	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	94828ff0-b1d5-4548-90ef-15b9d97dcd36	264b9f7a-597c-459b-a881-05dd0c9bef5f	1
866d0ece-f9f5-4cb8-8391-2e598586629f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	94828ff0-b1d5-4548-90ef-15b9d97dcd36	0e215f55-4340-4d2a-9d54-e9033ce896b6	1
856f6238-d4f5-475b-a291-908ea0428293	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	375f1b3c-dcca-43b1-80ad-1e89cc35c35c	08da42b8-baaa-450e-9e25-24b37bd0220f	4
29fd1af1-d65d-4488-aad2-afa766ab4ed0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	375f1b3c-dcca-43b1-80ad-1e89cc35c35c	c029eb56-ab4f-437a-a68a-e8e5f98e3070	1
dafea32a-7475-4138-9473-8fc77c0fa495	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c7b6d367-f725-4429-8245-5ad52d5daba1	c029eb56-ab4f-437a-a68a-e8e5f98e3070	1
ed9d8ed0-5c5c-487e-ba30-7d259705554f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c7b6d367-f725-4429-8245-5ad52d5daba1	cb92f8a4-2ad8-4ed5-a60f-57c234c88d7a	2
ab7ee6f1-8a18-4001-879a-e8638f01ab1c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c7b6d367-f725-4429-8245-5ad52d5daba1	37817878-eeb8-496f-953c-17f16ed7c93c	1
74e43ee0-778e-4c9d-82e0-6c0d926722b5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c7b6d367-f725-4429-8245-5ad52d5daba1	08da42b8-baaa-450e-9e25-24b37bd0220f	4
c12a25c9-9686-4caf-925f-d4938200e2a9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	5a00dc67-0224-4db3-b14b-325636a7986c	c029eb56-ab4f-437a-a68a-e8e5f98e3070	1
c4302252-1e28-46ec-b555-5f00c4ee7e1d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	5a00dc67-0224-4db3-b14b-325636a7986c	08da42b8-baaa-450e-9e25-24b37bd0220f	4
cbe2fe75-ed0e-4145-91f4-5a7dcab21be0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	44b43ff0-736c-4918-bf0b-bfb26eb5ab65	6383172f-392a-4ffe-b007-ce4897c61548	4
d57482c3-b4b6-4d88-bdfb-e7f02ddf5281	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	44b43ff0-736c-4918-bf0b-bfb26eb5ab65	6b22ce13-cbfd-46c0-844b-b993ba950155	1
535d2826-0fe6-4387-9569-21094cc757b1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	44b43ff0-736c-4918-bf0b-bfb26eb5ab65	63b6dee3-55af-4877-b123-58dfddd950af	1
409285f7-e62a-4b6f-8a42-7453beabd4ed	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	7b2faa07-26d6-4343-91e5-0a494ecccd9f	11b58990-78f6-4f19-9011-934bbc8f0ea7	4
c976ec9b-5ab6-42ef-93db-bc19dedcf6e1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d76f7190-8cfe-489e-8e2b-b5e65e6b1b22	431de095-4789-4b00-b3d7-289a37700347	2
a3e1d5aa-5e93-4602-8db6-7c23bbd31990	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d76f7190-8cfe-489e-8e2b-b5e65e6b1b22	901f9984-dc8a-48fd-ab4c-31b6082e00ee	2
9f7080d6-cf15-4e07-b6a1-6c7ef287e750	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d76f7190-8cfe-489e-8e2b-b5e65e6b1b22	52ffb5b8-e0a7-4bc7-9f76-b0fc8502e9f7	4
ff826db2-f39f-49a2-b491-7949cdb0d9df	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	de0b86d5-84aa-4b02-a3ff-eb2fa3a096e9	cfe4ec28-13fc-4a96-8cb4-ed9115c51cdb	6
01714739-1278-496e-9e66-d4428f455548	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	de0b86d5-84aa-4b02-a3ff-eb2fa3a096e9	a00121ab-c549-4833-af89-76ada69bb1c3	1
557cfb35-b624-4109-b426-ebcd72c38c5e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d1e2591d-0991-4082-9d0e-3f8e2f2792da	c029eb56-ab4f-437a-a68a-e8e5f98e3070	2
3c103070-8965-42e1-a41b-461342d81057	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d1e2591d-0991-4082-9d0e-3f8e2f2792da	9059ac1a-2002-44aa-9ef9-e1bfc669c6e6	1
466da7d4-df29-4378-beab-6de5e73b6fec	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	d1e2591d-0991-4082-9d0e-3f8e2f2792da	6383172f-392a-4ffe-b007-ce4897c61548	8
9c94ef4c-dccf-44eb-877b-8721e5ef6ea2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c713f8ae-e6c2-48f4-be7a-89689ebbaf47	539ce4a5-fd58-4879-a6f3-2997ad5cef2f	1
918d1b74-20ca-4016-8a34-ea838e1e63e9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c713f8ae-e6c2-48f4-be7a-89689ebbaf47	6383172f-392a-4ffe-b007-ce4897c61548	4
f3a083f6-207b-49f9-9921-df6fe6c55e85	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c713f8ae-e6c2-48f4-be7a-89689ebbaf47	5d69a8a7-5fdd-40c9-b182-b9db6e2a89ba	1
4b41c824-db68-47ce-a878-d02a0a444963	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c713f8ae-e6c2-48f4-be7a-89689ebbaf47	94cffe40-dfb4-4676-af7b-6f0602e8dd1c	1
12f0e48a-d278-48b0-8f4c-8ab3ee0b760e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	c713f8ae-e6c2-48f4-be7a-89689ebbaf47	440903c5-8e04-45fd-8ff6-ac15936e0f58	6
5b90cb54-89af-4e1e-bdc9-0a6b26e5fea9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ddde835e-0886-4fd9-a77d-87633d6089e8	1fd0b54e-df38-4068-870f-d4dfcb037a84	6
1924ffc0-d9dd-4517-9317-eff96754bd78	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	12
184545b0-26c8-48c7-9e93-f9e7f60d1b6a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
f7e19af3-7d06-435e-a4dc-f73fdcb231ec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	c82637df-1844-49cd-b49e-de578a5336ee	1
4c99bd1e-b223-4a2a-bfb3-fef94ce2a1e7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	56ca4973-84e7-42db-8866-e3f95a1fda42	1
4943f16d-0363-4236-985e-b1354e999626	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	1
f75f04bc-7b50-4114-a60d-495112f9ae97	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	b92dda62-8f4b-4a56-8a8d-55c2ca198fda	3
07bc0c49-5a44-428d-8cfb-61efe9872e9a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	d163ffe0-f5a1-479e-a2f2-262f072f9238	12
aa5a9a7a-962e-42e9-83dc-de059a049d42	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	1befca0d-e752-4af7-9c96-f4f722d65aff	1
9db2c950-4577-4db2-9b6f-33534a903b49	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	b72fc916-0e53-4f93-a3f9-8b74aaf64334	4
399745a2-f6a1-4629-92c8-c9604276b3d9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	44e1a0e2-87b5-4d9e-8fd7-3895c1100da2	1
0a5def7d-cb8f-451f-a276-bc5d3d4936b4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	a74b0bd1-5666-4be0-819d-d5d0407624d7	12
70f8d778-acbc-486f-9086-c0c4a0257667	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	1
e968a69f-17a3-4437-8f9f-d6ebbf5e638f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	565e8eac-2b5b-40cd-bc7a-ef0e725d2cae	2
e64bba93-c885-48a2-90d3-12fbcd998f62	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	278dff0f-9189-4929-8fb7-3e9ec31972b3	3
ee0f1e4e-f45f-4b4d-b7ec-66d090d85826	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	5a849ff6-56cf-4288-87ff-4653e63e0795	1
363c7ba8-d4a6-43a0-aac7-7b1b639a512d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	755a34e3-3ef1-41e1-a62f-701db399f230	1
e0d5a86f-4131-4fb0-9e56-c6d2cd7a562f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	5a6a2603-3138-4c7d-aee3-791cdaf6f568	1
864de6fa-24e0-4aac-baf8-d1afa1f24f7e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	1
fe0324e1-fc32-4e2e-a896-3efb21ebf11d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	1
af921bae-6a51-4217-826c-d278d70250b8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	0ef16ecf-5ad7-45bd-b245-161ba662dba7	1
bbb590e6-1a86-48bb-8d57-569fc64ee942	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	56ca4973-84e7-42db-8866-e3f95a1fda42	1
c2142633-65de-45af-bbc1-818eb53e82e5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	f54ee6af-808d-4715-995d-1ad30866384b	1
6e6039d9-05fb-44f6-969a-e5c971fc75dc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	be080552-9d43-4beb-a46d-0bf21663f8f5	2
e6899ae4-6fd6-4cb4-a832-fa6ce7c551da	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	1619536f-4247-456e-be6d-15810afaf234	1
60d23c1e-4162-4b89-99be-2b8fb554a4b9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	1befca0d-e752-4af7-9c96-f4f722d65aff	1
bbc68fa4-774e-4e29-bb8d-9c6160cdf7e4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	f1891952-021c-4211-a019-a495141307c4	1
204a2890-8760-432d-8d73-fb3801cf8d80	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
be795d51-9be8-4fbc-b9ae-ea0b302d9e51	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	dc2b5acf-cc66-449b-93e9-4c69c48b34c5	2
6e12155b-0a71-4bd4-bd3d-4da442dc2d7d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	ebb580ca-8b49-42a3-9511-ea27317709ba	2
aefcea43-e552-42d6-b8ca-d5812ec2c975	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	5e5fbf08-b2d5-4430-8ede-5cfd39587444	1
9c03a1b2-c3eb-4990-9e65-138eb433b403	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	a667364b-55af-4bb0-9e80-8e35bded0c30	2
c2f9f45b-0ef5-43c0-b9b3-a72fd176929c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	a0ce3acf-43dc-4379-a062-4a4b699fa9cf	1
36c025cd-fb5a-497a-bd3f-62756a4852b6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	3c37b6c5-5339-4702-a2bb-c316ff44813e	1
70a24dd8-a43b-4876-8163-a66885dac2ee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4b04535e-e0d8-4f43-8fcb-b94523c22045	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	8
a2da6039-4c2b-40db-80bc-552f69ee94b9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4b04535e-e0d8-4f43-8fcb-b94523c22045	f54ee6af-808d-4715-995d-1ad30866384b	2
bd36ac18-ccda-4e10-b0a7-6e589dd739df	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	ebb580ca-8b49-42a3-9511-ea27317709ba	8
03ffbf1d-2818-498f-8bc4-bfbc4a4963c1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	05e33ed2-0bba-4cd4-8674-d531cf15f6f4	1
32af37f0-7337-48dd-b71e-d03cbf0bfd98	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	8e483d34-a38d-4ef7-b829-19761ce44cdb	1
d7a80400-1823-4ca0-bdca-1e0edbe1f016	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	6983916d-e2d6-462c-843d-2258bfe9a3dc	1
197f898d-cf74-4225-bfe3-fcd4af1acf1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	b2dc75dd-d2a5-430d-bd27-a05372041fe9	1
115bd8be-45a7-4760-8b35-73d1a9c35436	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	a667364b-55af-4bb0-9e80-8e35bded0c30	4
f37e0033-b8b8-46d7-960c-c2cc2d86252f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	ebb580ca-8b49-42a3-9511-ea27317709ba	8
132e5d5b-112e-4399-9bd3-ccb94778fe63	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	08f6179c-f1ee-40c7-85aa-146a69959275	1
9403ed15-d6e6-4bc6-8fe5-d5e3aa5a6f8d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	3c37b6c5-5339-4702-a2bb-c316ff44813e	2
c8ed84b7-1c6d-482a-9191-9983efae2352	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	c94c8a3f-9724-4acf-a914-a60ae89cfd16	2
9c3634ee-5ece-4e3f-b8d6-8fe244b2363e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	2e337333-bfce-4664-930a-00b9807aef61	1
b272b23b-0906-4ee4-b9d0-bec39f6a0116	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	b92dda62-8f4b-4a56-8a8d-55c2ca198fda	2
f4e0f423-6fff-4494-b8d8-f8ca2e41cfa3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58593e8c-21c7-4fb4-aee1-750e46f2138a	a667364b-55af-4bb0-9e80-8e35bded0c30	4
e5a159c2-53fd-473e-948e-8b996b481a14	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	3f8ab52c-78a1-47e0-b203-01cf2a560182	10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	4
0794e2fd-41f7-491e-9407-0d16d28d933f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	3f8ab52c-78a1-47e0-b203-01cf2a560182	331344db-1025-4200-b0d5-1753acd5654e	4
ac74abbe-0375-4910-82d3-2566c8d517d0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	3f8ab52c-78a1-47e0-b203-01cf2a560182	14aa485f-c66f-46d7-aadf-915ec4135e43	2
5533c707-bd2c-4ded-b937-67472ad17100	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	216082a6-9da6-4128-8a10-b594d90d9d18	1befca0d-e752-4af7-9c96-f4f722d65aff	1
1e96ac4a-787b-4b8e-b438-4fe9f53af90e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	216082a6-9da6-4128-8a10-b594d90d9d18	fe9a669e-4c24-47bf-9c44-c16d626df909	4
050a092d-4038-4248-82a0-bd1356399808	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	aeeca3d9-4501-4ceb-a339-ef0ca832a913	28177117-e857-4b44-808c-1b57dfa04eaa	1
37cf5958-fabd-4aba-a1ef-04e4b1a96065	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	aeeca3d9-4501-4ceb-a339-ef0ca832a913	fc79fd1a-5504-4b81-a460-548627d93866	2
\.


--
-- Data for Name: clients; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.clients (id, company_id, user_id, company_name, location, address, city, province, postal_code, contact_name, email, phone, roof_ladder_code, notes, selected_months, inactive, next_due, created_at, parent_company_id, bill_with_parent, qbo_customer_id, qbo_parent_customer_id, qbo_sync_token, qbo_last_synced_at) FROM stdin;
af526345-41e6-4c6c-b798-b78e6fd08336	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Caldense Bakery	Vaughan										{1,4,7,10}	f	2026-05-15T00:00:00.000Z	2025-11-14 03:30:30.669621+00	\N	t	\N	\N	\N	\N
7da0a45f-86ef-419b-845f-66fe206790e2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Milestones	Newmarket	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.183807+00	\N	t	\N	\N	\N	\N
6f6595e5-b1c1-42ef-a461-111299e60fee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	DKS Law	Newmarket										{4,10}	f	2025-11-18	2025-11-14 23:44:35.507681+00	\N	t	\N	\N	\N	\N
7b2faa07-26d6-4343-91e5-0a494ecccd9f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Mr puffs Grisham	Oshawa, 2625 simcoe	2625 simcoe st	Oshawa	\N	\N	\N	\N	\N	\N	$325	{0,6}	f	2026-01-15T05:00:00.000Z	2025-11-18 00:21:44.66654+00	\N	t	\N	\N	\N	\N
d29bf555-dfba-4dba-8a74-ff84ce3bf8ab	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Dasha	Toronto										{}	t	9999-12-31T00:00:00.000Z	2025-11-14 23:42:11.327683+00	\N	t	\N	\N	\N	\N
70deb41c-b099-481e-8bd7-672a8030a2dd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	K9 to 5	Newmarket										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-14 23:48:13.713129+00	\N	t	\N	\N	\N	\N
2b7af116-8298-4a71-93eb-eff76f28c588	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	The Manor	King										{4,9}	f	2026-05-15	2025-11-15 19:47:26.838012+00	\N	t	\N	\N	\N	\N
8a387824-9497-49c9-92ac-7fc00b7661d4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Basil Box	Oakville										{2,6,10}	f	2026-07-15T00:00:00.000Z	2025-11-14 03:18:50.212941+00	\N	t	\N	\N	\N	\N
51ec63e6-b16f-4fd8-9fef-eac838e0222f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Meo Group	Bradford										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-15 00:21:55.937739+00	\N	t	\N	\N	\N	\N
c85e0bec-1fb8-4b62-abd9-0cde78c77711	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Milestones	Yonge St (Richmond Hill)										{4,10}	f	2026-05-15T00:00:00.000Z	2025-11-16 16:03:08.105001+00	\N	t	\N	\N	\N	\N
f1646f77-f14c-406e-a4fe-dd7ebb015ba4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kelsey's	Orangeville										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-14 23:53:36.327104+00	\N	t	\N	\N	\N	\N
ede5f914-3c1d-4859-8cf1-4998c0121e50	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2707 (Abraham)	657 University	657 University	Toronto	On	M5G 1X5						{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.127774+00	\N	t	\N	\N	\N	\N
360a3b6a-3424-4561-b669-cb9e7c0eef8a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #3143 (Zoi)	144 Simcoe St										{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.84414+00	\N	t	\N	\N	\N	\N
350a078c-7287-47ba-be4d-cfbcf06cb385	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kelsey's	Aurora										{2,5,8,11}	f	2025-12-05	2025-11-14 23:49:46.742803+00	\N	t	\N	\N	\N	\N
8552fa04-a111-4aa5-bebb-d9de0100f226	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Basil Box	RBC Plaza										{0,4,8}	f	2026-01-15	2025-11-14 03:22:17.588435+00	\N	t	\N	\N	\N	\N
33cc1c52-22c1-40a0-9f67-5f79ce7b9752	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #120812 (Zoi)	Roncesvalles										{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:10.000649+00	\N	t	\N	\N	\N	\N
84aedf96-bace-4700-b66c-33b47a3d3727	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Booster Juice	Upper Canada Mall										{2,5,8,11}	f	2026-03-15T00:00:00.000Z	2025-11-14 23:31:11.252596+00	\N	t	\N	\N	\N	\N
304d8fbb-bd38-48a4-9b11-81cfc72282da	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Booster Juice	Bradford										{2,5,8,11}	f	2026-03-15	2025-11-14 23:29:06.151954+00	\N	t	\N	\N	\N	\N
95764ad3-7315-4a52-9874-1ed560e3d4fd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Red Rooster	Newmarket										{3,10}	f	2026-04-15T00:00:00.000Z	2025-11-16 16:03:10.32001+00	\N	t	\N	\N	\N	\N
58593e8c-21c7-4fb4-aee1-750e46f2138a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Baskin Robbins (UCM)	Newmarket										{2,8}	f	2026-03-15T00:00:00.000Z	2025-11-14 03:25:33.817025+00	\N	t	\N	\N	\N	\N
4a8a2da7-8b65-490f-921c-fab6fb253f5e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kelsey's	Richmond Hill										{0,3,6,9}	f	2026-01-15	2025-11-14 23:59:47.19274+00	\N	t	\N	\N	\N	\N
ab653f30-2e4c-4e0b-90e2-80989d1a7758	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Basil Box	Finch & Yonge										{3,7,11}	f	2026-04-15	2025-11-14 03:15:41.902995+00	\N	t	\N	\N	\N	\N
3f8ab52c-78a1-47e0-b203-01cf2a560182	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Basil Box	Ryerson										{0,4,8}	f	2026-01-15	2025-11-14 03:22:37.950814+00	\N	t	\N	\N	\N	\N
535a5559-e3be-40c7-9210-6124e939a910	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	King Edward's Arms	Markham										{1,4,7,10}	f	2026-02-15	2025-11-15 00:21:07.288623+00	\N	t	\N	\N	\N	\N
6912ddbd-cda7-4594-a29d-d83ebbe633f8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Booster Juice	East Gwillimbury										{0,4,8}	f	2026-01-15	2025-11-14 23:29:43.859436+00	\N	t	\N	\N	\N	\N
6213a22a-4dec-41d5-96cf-1f4718a8f603	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Cobs Bread	Newmarket								Roof 5402		{0,3,6,9}	f	2026-01-15	2025-11-17 13:09:21.296896+00	\N	t	\N	\N	\N	\N
355eb33b-661e-4cf2-a31f-6ee97fbe94d7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Mizzoni)	2 Quarry Ridge (Barrie)										{2,5,8,11}	f	2025-12-17	2025-11-16 16:03:09.648955+00	\N	t	\N	\N	\N	\N
47c29ae3-c19e-4710-910d-f03ba9ed94bd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Cobs Bread	Aurora										{2,5,8,11}	f	2026-03-15	2025-11-14 23:40:27.561612+00	\N	t	\N	\N	\N	\N
60043990-c0e6-467b-a7c6-9020fbe27032	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Booster Juice	Aurora										{0,4,8}	f	2026-01-15	2025-11-14 23:27:11.049468+00	\N	t	\N	\N	\N	\N
c297f301-0f20-4564-bfcd-a372caf32ecd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kelsey's	Brampton										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-14 23:56:31.938658+00	\N	t	\N	\N	\N	\N
0bf22fd9-3e07-4362-988c-b2095d43eaa9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kasparov	Vaughan										{}	t	9999-12-31T00:00:00.000Z	2025-11-16 16:03:08.017113+00	\N	t	\N	\N	\N	\N
1f1eb8e8-3a75-447e-84fc-c0de7e33075a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Milestones	Enterprise Rd Markham	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.065647+00	\N	t	\N	\N	\N	\N
fc759e97-0f99-4ffe-9a20-6455e6aa52ba	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Milestones	150 Park Place (Barrie)	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.144545+00	\N	t	\N	\N	\N	\N
b0bc47a4-6839-4faa-b7c9-3aaf79a478a5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Mr Lube	Aurora	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.381569+00	\N	t	\N	\N	\N	\N
f6287522-2150-40e0-aa0a-544dac06477f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Mr Lube	Barrie	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.421782+00	\N	t	\N	\N	\N	\N
682375b0-86d6-45e3-8cf1-29e1a9447cbc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Mr Lube	Newmarket	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.461311+00	\N	t	\N	\N	\N	\N
4bdca40b-a0ac-486b-9efb-6a3635dfa755	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	Newmarket	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	2025-11-16	2025-11-16 16:03:08.929718+00	\N	t	\N	\N	\N	\N
f7fd2486-a92e-4a7d-9583-218822bfc4e2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Pita Land	Aurora										{}	t	2025-11-16	2025-11-16 16:03:08.578653+00	\N	t	\N	\N	\N	\N
52a701ac-96a4-4ef6-8b1b-a334a765df09	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Kelsey's	Barrie										{1,4,7,10}	f	2025-11-20	2025-11-14 23:51:24.697409+00	\N	t	\N	\N	\N	\N
d810dbfd-af66-406f-872f-bc551c0a5a55	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Moxies	Vaughan										{}	t	2025-11-16	2025-11-16 16:03:08.342147+00	\N	t	\N	\N	\N	\N
5958dbda-7eaa-4735-ac9c-2a00f4591edf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Parlour	642 King Street West										{}	t	2025-11-16	2025-11-16 16:03:08.500857+00	\N	t	\N	\N	\N	\N
491c69c0-a918-4d31-96f3-879ea4e83839	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Petty Cash	Toronto										{3,9}	f	2025-11-16	2025-11-16 16:03:08.539881+00	\N	t	\N	\N	\N	\N
44b64a12-6c69-489c-86a3-786e93646dbf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2773 (Dan)	33 Yonge St										{1,4,7,10}	f	2026-05-15T00:00:00.000Z	2025-11-16 16:03:09.402804+00	\N	t	\N	\N	\N	\N
75f941e0-3d70-4550-8b38-ab51df9a0813	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sultan's Tent	Front St										{10}	t	2026-11-15	2025-11-16 16:03:08.696522+00	\N	t	\N	\N	\N	\N
31a5ff99-432c-478f-bb20-ea822398c420	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	Keswick										{1,4,7,10}	f	2026-05-15T00:00:00.000Z	2025-11-16 16:03:08.85151+00	\N	t	\N	\N	\N	\N
419446aa-e178-4302-a311-8d84d46e0229	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Salt Cave	Bolton										{3,10}	f	2026-04-15T00:00:00.000Z	2025-11-16 16:03:08.65701+00	\N	t	\N	\N	\N	\N
9807087e-a8df-41dc-b06f-0461da6c802f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	3981 Jane										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.28501+00	\N	t	\N	\N	\N	\N
ef3fcc8b-b271-4d14-95be-610582246193	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	1060 Finch Ave										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.205819+00	\N	t	\N	\N	\N	\N
2e5ccc98-73c1-43c7-a7fc-1d16095877de	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #5838 (Vjay)	3685 Keele										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.80584+00	\N	t	\N	\N	\N	\N
7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	2444 Finch										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.324005+00	\N	t	\N	\N	\N	\N
406a1be5-b5eb-457f-a063-0d8d32928206	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #5896 (Dan)	3719 Lakeshore										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.488658+00	\N	t	\N	\N	\N	\N
adef31cb-8384-4130-96d8-9800de6fe574	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #4280 (Dan)	152 North Queen										{2,5,8,11}	f	2026-03-15T00:00:00.000Z	2025-11-16 16:03:09.449834+00	\N	t	\N	\N	\N	\N
b384cc61-449c-4077-b410-adae6ee2dea9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	Aurora										{4,10}	f	2026-05-15	2025-11-16 16:03:08.773697+00	\N	t	\N	\N	\N	\N
90cde655-661a-473e-bb6f-5a9a0cf77019	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2582 (M Yousef)	Spadina / Bloor										{2,5,8,11}	f	2026-03-15	2025-11-16 16:03:09.610546+00	\N	t	\N	\N	\N	\N
5401fe54-7a66-4e7d-bf7f-372a97ec0384	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Mizzoni)	403 Blake (Barrie)										{2,5,8,11}	f	2025-12-17	2025-11-16 16:03:09.687466+00	\N	t	\N	\N	\N	\N
6012b6f0-c7eb-44b4-bc7e-7d776847fb98	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #3065 (M Yousef)	700 University										{2,5,8,11}	f	2026-03-15	2025-11-16 16:03:09.571525+00	\N	t	\N	\N	\N	\N
9400d77b-99b1-4f60-892c-7f897c64847a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #6011 (M Yousef)	150 John St										{2,5,8,11}	f	2026-03-15	2025-11-16 16:03:09.532052+00	\N	t	\N	\N	\N	\N
04243de4-5307-4e32-9f75-c6eb4c549553	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Montana's	Newmarket										{2,5,8,11}	f	2026-06-15T00:00:00.000Z	2025-11-16 16:03:08.223464+00	\N	t	\N	\N	\N	\N
733bbd75-74df-4287-99e5-5e1e81aa6775	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	Bovaird (Brampton)										{0,4,8}	f	2026-01-15	2025-11-16 16:03:08.812689+00	\N	t	\N	\N	\N	\N
54e49509-3454-4b51-bfa9-9a456c888422	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2703 (Vjay)	4211 Keele										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.766297+00	\N	t	\N	\N	\N	\N
adc94337-d765-4da4-a0c9-551375cbbbbd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	4000 Jane	\N	\N	\N	\N	\N	\N	\N	\N	\N	{1,4,7,10}	f	2026-05-15T00:00:00.000Z	2025-11-17 15:30:19.24646+00	\N	t	\N	\N	\N	\N
d8425cbd-bab1-4c6a-8486-2a6bab3bc232	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Swiss Chalet	Mississauga								Security roof access 4168912369		{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:10.399126+00	\N	t	\N	\N	\N	\N
f921231e-6543-44b5-a170-27c78165a725	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	Yorkgate	\N	\N	\N	\N	\N	\N	\N	\N	\N	{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-17 15:30:28.807924+00	\N	t	\N	\N	\N	\N
229fe4c8-f41d-4319-b1ca-749a6d4d9671	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2820 (Zoi)	829 Lakeshore	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	9999-12-31T00:00:00.000Z	2025-11-17 15:57:36.522412+00	\N	t	\N	\N	\N	\N
018fd13a-85d6-4e0b-a67b-bff8d79d5282	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	1600 Steeles Ave										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.246383+00	\N	t	\N	\N	\N	\N
48167021-747d-47ae-a307-a74e06e30099	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	YRCC	Newmarket								352		{3,8}	f	2025-11-16	2025-11-16 16:03:10.282343+00	\N	t	\N	\N	\N	\N
9a09b941-c817-4e8d-976f-85dfd138c2f4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2357 (George)	111 Carlton										{}	t	2025-11-16	2025-11-16 16:03:10.078883+00	\N	t	\N	\N	\N	\N
06b50260-0dd6-40aa-a7c1-c773edee30d7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Toppers Pizza (Robbie)	Newmarket										{}	t	2025-11-16	2025-11-16 16:03:10.243553+00	\N	t	\N	\N	\N	\N
235ea03e-3967-436e-b960-52dbb4763018	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Caldense Bakery	Bradford										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-14 03:26:50.648594+00	\N	t	\N	\N	\N	\N
34645b91-8ae7-4c6c-8791-dc59e98d6d49	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Moxies	Newmarket										{5,10}	f	2026-06-15T00:00:00.000Z	2025-11-16 16:03:10.358701+00	\N	t	\N	\N	\N	\N
c215c81e-c130-4597-80f3-01dc557c1b94	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Montana's	Orangeville										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:08.262141+00	\N	t	\N	\N	\N	\N
58317ede-65e7-4d4d-9f65-9f1034105edd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	Weston Rd										{2,6,10}	f	2026-03-15T00:00:00.000Z	2025-11-16 16:03:08.890331+00	\N	t	\N	\N	\N	\N
f882a557-3caf-483c-9773-2f446a42e675	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	6000 Dufferin	\N	\N	\N	\N	\N	\N	\N	\N	\N	{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-17 15:30:08.346399+00	\N	t	\N	\N	\N	\N
786e0752-2eff-4e49-a257-dcef9f8235ab	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Andraous)	3514 Weston	\N	\N	\N	\N	\N	\N	\N	\N	\N	{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-17 15:30:37.656854+00	\N	t	\N	\N	\N	\N
8c621079-e823-4f35-86bb-f29b85789eb7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Moxies	Mississauga										{7,10}	f	2026-08-15T00:00:00.000Z	2025-11-17 12:55:17.428562+00	\N	t	\N	\N	\N	\N
1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #3235 (Abraham)	200 Bay St	200 Bay St	Toronto	On	M5J2T6						{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.166947+00	\N	t	\N	\N	\N	\N
1344835b-040a-46b5-bf4c-d244437cb961	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #0909 (Abraham)	555 University	555 University	Toronto	On	M5G 1X8						{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.009184+00	\N	t	\N	\N	\N	\N
e54072ef-e02c-4dab-a829-4f270c8c11b4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #3021 (Zoi)	340 Front St										{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.923172+00	\N	t	\N	\N	\N	\N
10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #3297 (Abraham)	595 Bay	595 Bay Street	Toronto	On	M5G 2R3						{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.047071+00	\N	t	\N	\N	\N	\N
5a3db429-87b4-4e18-a6f6-0e332aa3e5f0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #120757 (Zoi)	Queen										{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:10.039719+00	\N	t	\N	\N	\N	\N
4b04535e-e0d8-4f43-8fcb-b94523c22045	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2876 (Stella)	2245 Yonge										{10}	f	2026-11-15T00:00:00.000Z	2025-11-16 16:03:10.120485+00	\N	t	\N	\N	\N	\N
03400d5f-149b-4d12-a0af-b8a9f0ec2447	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Abraham)	218 Yonge										{1,4,5,6,7,10}	f	2026-02-15	2025-11-16 16:03:09.086509+00	\N	t	\N	\N	\N	\N
16f939ca-d9a2-4d92-aab9-9b283c20da45	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #6218 (Stella)	607 Eglinton										{10}	f	2026-11-15	2025-11-16 16:03:10.203041+00	\N	t	\N	\N	\N	\N
d10e838c-ab29-41cb-ba1d-6fc47fb3639c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #1652 (Stella)	Queensway	1569 Queensway									{10}	f	2026-11-15T00:00:00.000Z	2025-11-16 16:03:10.164061+00	\N	t	\N	\N	\N	\N
7235b45d-2c03-49f3-819a-eb9ba79f587d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Caldense Bakery	Finch	\N	\N	\N	\N	\N	\N	\N	\N	\N	{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-17 13:24:32.270485+00	\N	t	\N	\N	\N	\N
ad268884-c03d-41c5-95f8-eb7aee1be738	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Mizzoni)	201 Georgian (Hospital)	\N	\N	\N	\N	\N	\N	\N	\N	\N	{2,5,8,11}	f	2025-12-17	2025-11-17 15:45:48.827828+00	\N	t	\N	\N	\N	\N
56d564b2-f3b6-4dcf-936a-2b3e960fc70b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2253 (Dan)	55 York St										{1,4,5,6,7,10}	f	2026-02-15	2025-11-16 16:03:09.363242+00	\N	t	\N	\N	\N	\N
35e050d1-2dc0-4d8a-899f-e614a823a4fe	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Mizzoni)	 509 Bayfield St (Mall)										{2,5,8,11}	f	2025-12-17	2025-11-17 15:45:12.703017+00	\N	t	\N	\N	\N	\N
957c4c59-e4ff-4418-81c9-4e790cd827d7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Big Bone Newmarket	Newmarket Eagle	\N	\N	\N	\N	LEE	\N	\N	\N	$275	{1,5,9}	f	2026-02-15T05:00:00.000Z	2025-11-17 22:48:36.991133+00	\N	t	\N	\N	\N	\N
d76f7190-8cfe-489e-8e2b-b5e65e6b1b22	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Raja Mr Puffs	Vaughn	Maj Mac and Dufferin	Vaugn							$325	{4,10}	f	2026-05-15T04:00:00.000Z	2025-11-18 00:17:45.924289+00	\N	t	\N	\N	\N	\N
759af418-7fb4-47e3-b40c-2e4077b0d9a6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Chik Fila	 Brampton	\N	Brampton	\N	\N	\N	\N	\N	\N	$675	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-17 22:58:25.330892+00	\N	t	\N	\N	\N	\N
de0b86d5-84aa-4b02-a3ff-eb2fa3a096e9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Rudy	\N	\N	\N	\N	\N	\N	\N	\N	\N	325	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-18 00:27:25.107855+00	\N	t	\N	\N	\N	\N
ec509fda-191f-4ba7-bf67-8550d9b03bc3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Chik Fila	Oshawa		Oshawa							$675	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-17 22:55:39.216748+00	\N	t	\N	\N	\N	\N
d1e2591d-0991-4082-9d0e-3f8e2f2792da	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Mac n Wings	Wellington and 404	\N	Aurora	\N	\N	Vithuna	\N	\N	\N	325	{3,9}	f	2026-04-15T04:00:00.000Z	2025-11-18 00:29:14.19526+00	\N	t	\N	\N	\N	\N
0e67a4d0-2249-46e9-b1fe-5f8575f153c1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Thai Express	Oshawa	\N	Oshawa	\N	\N	\N	\N	\N	\N	$250	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-17 23:01:11.043739+00	\N	t	\N	\N	\N	\N
6caa0582-8b82-4abc-bee7-abc8e36f7ada	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Shelbys Oshawa	Oshawa	\N	Oshawa	\N	\N	\N	\N	\N	\N	$275	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-17 23:02:25.021565+00	\N	t	\N	\N	\N	\N
3d19ad86-a2a5-409a-a4d6-5585bf5fc571	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Mucho Burrito	Oshawa	\N	Oshawa	\N	\N	\N	\N	\N	\N	$275	{0,3,6,9}	f	2026-01-15T05:00:00.000Z	2025-11-17 23:03:37.635257+00	\N	t	\N	\N	\N	\N
9897b0d6-170d-4eee-9f11-f2e096f9d76f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Booster Juice 	Markham road and 16	\N	Markham	\N	\N	\N	\N	\N	\N	$275	{3,7,11}	f	2025-12-15T05:00:00.000Z	2025-11-18 00:30:50.618986+00	\N	t	\N	\N	\N	\N
5dab5734-67f4-4af7-8fce-0f66c895ceaf	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Bombay/Pokeworks/Jimmy Johns	Etobicoke		Etobicoke							$215 each	{1,4,7,10}	f	2025-11-01	2025-11-17 22:51:12.433251+00	\N	t	\N	\N	\N	\N
2233293f-fe6b-4416-b544-70e1ce5b20f5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Zoup	Newmarket 404/davis	\N	Newmarket 404/davis	\N	\N	\N	\N	\N	\N	$200	{1,4,7,10}	f	2025-11-04	2025-11-17 23:06:44.440805+00	\N	t	\N	\N	\N	\N
c713f8ae-e6c2-48f4-be7a-89689ebbaf47	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Chucks Road House Stoufville 	Stoufville	\N	Stoufville	\N	\N	\N	\N	\N	\N	$450	{3,9}	f	2026-04-15T04:00:00.000Z	2025-11-18 01:01:24.654442+00	\N	t	\N	\N	\N	\N
97a4e69b-9cd9-4475-998c-03df0a48d664	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	MELTWICH	Newmarket Davis/404 plaza		newmarket			Raj			1959/1987	$175	{1,4,7,10}	f	2025-11-04	2025-11-17 22:41:45.270738+00	\N	t	\N	\N	\N	\N
94828ff0-b1d5-4548-90ef-15b9d97dcd36	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Bar Burrito	Newmarket Davis/404 plaza		Newmarket 404/davis							$200	{1,4,7,10}	f	2026-02-15T05:00:00.000Z	2025-11-17 23:10:44.980274+00	\N	t	\N	\N	\N	\N
375f1b3c-dcca-43b1-80ad-1e89cc35c35c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Booster Juice	Newmarket Davis/404 plaza	\N	Newmarket 404/davis	\N	\N	\N	\N	\N	\N	$200	{1,4,7,10}	f	2026-02-15T05:00:00.000Z	2025-11-17 23:15:10.58186+00	\N	t	\N	\N	\N	\N
c7b6d367-f725-4429-8245-5ad52d5daba1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Fire House Subs	Newmarket Davis/404 plaza	\N	Newmarket 404/davis	\N	\N	\N	\N	\N	\N	$200	{1,4,7,10}	f	2026-02-15T05:00:00.000Z	2025-11-17 23:18:01.825283+00	\N	t	\N	\N	\N	\N
5a00dc67-0224-4db3-b14b-325636a7986c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Pablo Cheese Cake	Newmarket Davis/404 plaza	\N	Newmarket 404/davis	\N	\N	\N	\N	\N	\N	$175	{1,4,7,10}	f	2026-02-15T05:00:00.000Z	2025-11-17 23:19:20.712114+00	\N	t	\N	\N	\N	\N
44b43ff0-736c-4918-bf0b-bfb26eb5ab65	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	Thai Express	Newmarket 404/Davis		Newmarket 404/davis							$225	{1,4,7,10}	f	2025-11-05	2025-11-17 23:08:00.208567+00	\N	t	\N	\N	\N	\N
ddde835e-0886-4fd9-a77d-87633d6089e8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	IQ Foods	York	\N	\N	\N	\N	\N	\N	\N	\N	\N	{}	t	9999-12-31T00:00:00.000Z	2025-11-18 12:56:51.256617+00	\N	t	\N	\N	\N	\N
f12cdc98-f777-4c27-8756-cc8403caf8f0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Quanto Basta	Toronto										{1,4,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:08.617165+00	\N	t	\N	\N	\N	\N
6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2000 (Zoi)	323 Richmond St										{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:09.883612+00	\N	t	\N	\N	\N	\N
f4e2c683-9e6a-4837-a711-6c9314bcde02	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Hungry Brew Hops	Newmarket										{4,10}	f	2026-05-15	2025-11-14 23:46:31.983424+00	\N	t	\N	\N	\N	\N
0bdfdf83-0667-4f3e-a342-1fb45583c5db	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Sunset Grill	102 Lakeshore (Etobicoke)										{4,10}	f	2026-05-15	2025-11-16 16:03:08.734997+00	\N	t	\N	\N	\N	\N
dc8bfd92-9a14-4086-b1ca-e621e27ef31b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #0023 (Stella)	Sherway Gardens	25 The West Mall	Etobicoke	On	\N	\N	\N	\N	\N	\N	{10}	f	2026-11-15	2025-11-26 16:10:07.8827+00	\N	t	\N	\N	\N	\N
b4de6b16-b7ba-4e7d-b592-3e7053fd0d9f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #1939	610 University	610 University	Toronto	\N	\N	Abraham	\N	\N	\N	\N	{10}	f	2026-11-15T00:00:00.000Z	2025-11-26 16:02:12.706135+00	\N	t	\N	\N	\N	\N
1ed6bdf6-c818-473f-9691-c61dd50342bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Gabby's	(King St)	309 King St W	Toronto	\N	\N	\N	\N	\N	\N	\N	{5,11}	f	2027-06-15T00:00:00.000Z	2025-11-26 16:12:00.87413+00	\N	t	\N	\N	\N	\N
461f3490-92a4-430e-8cac-266c92725885	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #2017 (Abraham)	438 University	438 University	Toronto	On	M5G 2K8						{1,4,5,6,7,10}	f	2026-02-15T00:00:00.000Z	2025-11-16 16:03:08.96862+00	\N	t	\N	\N	\N	\N
9e21484f-a4b5-4ec4-8e82-1be41b828511	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	RBC Plaza	RBC Plaza	200 Bay St	Toronto	On	M5J2T6	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:29:59.997715+00	12d4bd2c-50b2-439d-b0f4-996918151826	t	\N	\N	\N	\N
2ff40e01-1720-4166-ae08-52e09385229b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Ryerson	Ryerson	351 Yonge St	Toronto	On	M5B1S1	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:30:27.577221+00	12d4bd2c-50b2-439d-b0f4-996918151826	t	\N	\N	\N	\N
bf2d8f54-96a4-4e2a-afc4-585327f75f22	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Toronto General Hospital	Toronto General Hospital	200 Elizabeth St	Toronto	On	M5G2C4	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:30:55.683019+00	12d4bd2c-50b2-439d-b0f4-996918151826	t	\N	\N	\N	\N
91dd2e3a-5a32-4d9e-ac51-30b4acaffe35	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Square One	Square One	100 City Centre Drive	Mississauga	On	L5B2C0	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:31:51.655642+00	12d4bd2c-50b2-439d-b0f4-996918151826	f	\N	\N	\N	\N
aeeca3d9-4501-4ceb-a339-ef0ca832a913	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Lettuce Love		2241 Bloor St W	Toronto		M6S 1N7				Need to call tenant for roof access, Oleg 6479715430		{2,5,8,11}	f	2025-12-18	2025-12-03 14:23:59.459662+00	\N	t	\N	\N	\N	\N
1b96df6e-86c5-4431-bfc7-b83de5b1e89e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Hey Lucy	\N	Toronto	On	\N	\N	\N	\N	\N	\N	\N	{5,11}	f	2026-12-15T00:00:00.000Z	2025-11-26 16:13:07.187419+00	\N	t	\N	\N	\N	\N
db4c76a3-5df4-4e7f-91de-fd42d4c932d2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Yonge & Finch	Oakville	5607 Yonge St	Toronto	On	M2M3S9	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:31:24.251537+00	12d4bd2c-50b2-439d-b0f4-996918151826	t	\N	\N	\N	\N
c502142b-98a1-4b2d-9f3f-bb44ca961c6b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Juju Aesthetics	Home	15 Oak Ave	River Drive Park	ON	L9N 1A7	Juliana Elias	nadsamaha@gmail.com	2898942282	5556		{}	t	9999-12-31T00:00:00.000Z	2025-12-07 18:28:33.401887+00	d075941a-bfb3-4d67-8746-56358a2f5c97	t	\N	\N	\N	\N
fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Basil Box	Yonge & Finch	5607 Yonge Street	Toronto	ON	ON M2M 3S9	Peter Chiu					{}	t	9999-12-31T00:00:00.000Z	2025-12-08 12:29:22.417929+00	12d4bd2c-50b2-439d-b0f4-996918151826	t	\N	\N	\N	\N
6ac36a43-b6ce-4861-940a-82b63c978b66	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH (Mizzoni)	533 Bayfield (Barrie)										{2,5,8,11}	f	2025-12-17	2025-11-16 16:03:09.727614+00	\N	t	\N	\N	\N	\N
b54c29af-0e21-4631-b5fa-233a52e7180c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Juliana's asthetics	Juliana's asthetics	15 Oak Ave	River Drive Park	ON	L9N 1A7	Juliana Elias	service@samcor.ca	9053928228			{}	t	9999-12-31T00:00:00.000Z	2025-12-07 17:40:55.792221+00	2fe5dc64-c96b-4a0e-8739-a217c44e6163	t	\N	\N	\N	\N
9ccd993a-92c7-4294-8850-4700578261b6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Gabby's	(Sherbourne)	556 Sherbourne	Toronto	On							{5,11}	f	2026-06-15	2025-11-26 16:12:32.108417+00	\N	t	\N	\N	\N	\N
b853e990-e5d5-4019-85d0-4b955f060e50	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Numbered company	Apples	15 Oak Ave	River Drive Park	Ontario	L9N 1A7	\N	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:26:07.445891+00	e51cecdb-1806-445c-b0e0-118d5106b71f	t	\N	\N	\N	\N
95eed99a-3e8e-4708-b174-9dee967d83c2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	tomato	tomato	296 alex	River Drive Park	ON	L9N 1A7	\N	nadsamaha@gmail.com	2898942282	555	\N	{}	f	9999-12-31T00:00:00.000Z	2025-12-08 12:26:41.513582+00	e51cecdb-1806-445c-b0e0-118d5106b71f	t	\N	\N	\N	\N
216082a6-9da6-4128-8a10-b594d90d9d18	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Yolks		2243 Bloor Street West	Toronto	On	M6S 1N8		lisakjohnston@hotmail.com				{2,5,8,11}	f	2025-12-18	2025-12-03 14:21:34.457436+00	\N	t	\N	\N	\N	\N
9fbbd9ef-224a-4a5b-aaff-271c1e7e5ec6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	TH #5792 (Zoi)	589 King St										{1,4,5,6,7,10}	f	2026-02-15	2025-11-16 16:03:09.961939+00	\N	t	\N	\N	\N	\N
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.companies (id, name, address, city, province_state, postal_code, email, phone, trial_ends_at, subscription_status, subscription_plan, billing_interval, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, created_at, tax_name, default_tax_rate) FROM stdin;
3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	faboutanos@hotmail.com's Company	\N	\N	\N	\N	\N	\N	\N	trial	\N	\N	\N	f	\N	\N	2025-11-20 22:58:18.52	HST	13
a641fb6a-a9ad-4133-93c0-5797f3980aea	nadsamaha@gmail.com's Company	\N	\N	\N	\N	\N	\N	\N	active	enterprise	\N	\N	f	\N	\N	2025-11-20 22:58:18.296	HST	13
25b87fb2-7dc7-489b-a6aa-e99da73f4824	service@samcor.ca's Company	\N	\N	\N	\N	\N	\N	\N	active	enterprise	\N	\N	f	\N	\N	2025-11-20 22:58:18.628	HST	13
da832c38-414f-4ca0-8e50-cd910c6d3724	dannysabbouh@gmail.com's Company	\N	\N	\N	\N	\N	\N	\N	active	silver	\N	\N	f	\N	\N	2025-11-20 22:58:18.412	HST	13
22fee856-dce2-46e0-b035-bb16b2a0aeda	nadsamaha's Company	\N	\N	\N	\N	\N	\N	\N	trial	\N	\N	\N	f	\N	\N	2025-11-21 04:20:52.188	HST	13
\.


--
-- Data for Name: company_audit_logs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.company_audit_logs (id, company_id, user_id, action, entity, entity_id, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: company_counters; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.company_counters (id, company_id, next_job_number, next_invoice_number) FROM stdin;
49787a1b-a709-4850-a4e1-e555668b0aab	da832c38-414f-4ca0-8e50-cd910c6d3724	10004	1001
4da61ec5-b487-4c79-b1ff-11e01766bde9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	10186	1004
\.


--
-- Data for Name: company_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.company_settings (id, company_id, user_id, company_name, address, city, province_state, postal_code, email, phone, calendar_start_hour, updated_at) FROM stdin;
7d93a8e8-dc1c-44d8-9f65-bba5c2a3f5fd	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	SABB 							8	2025-11-14 02:36:56.281477+00
9af187c6-db58-459a-bf69-a48f77386ac1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	Samcor Mechanical Inc.	15 Oak Ave	River Drive Park	Ontario	L9N 1A7	service@samcor.ca	9053928228	7	2025-12-10 03:50:40.427093+00
\.


--
-- Data for Name: customer_companies; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customer_companies (id, company_id, name, legal_name, phone, email, billing_street, billing_city, billing_province, billing_postal_code, billing_country, is_active, qbo_customer_id, qbo_sync_token, qbo_last_synced_at, created_at, updated_at) FROM stdin;
2fe5dc64-c96b-4a0e-8739-a217c44e6163	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Juliana's asthetics	juju booju	\N	\N	\N	\N	\N	\N	Canada	t	\N	\N	\N	2025-12-07 17:40:55.792221	\N
d075941a-bfb3-4d67-8746-56358a2f5c97	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Juju	\N	\N	\N	\N	\N	\N	\N	Canada	t	\N	\N	\N	2025-12-07 18:28:33.401887	\N
e51cecdb-1806-445c-b0e0-118d5106b71f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Numbered company	apples	9053928228	service@samcor.ca	15 Oak Ave	River Drive Park	Ontario	L9N 1A7	Canada	t	\N	\N	\N	2025-12-08 12:26:07.445891	\N
12d4bd2c-50b2-439d-b0f4-996918151826	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Basil Box	Basil Box	\N	\N	5607 Yonge Street	Toronto	ON	ON M2M 3S9	Canada	t	\N	\N	\N	2025-12-08 12:29:22.417929	\N
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.equipment (id, company_id, user_id, client_id, name, type, model_number, serial_number, location, notes, created_at) FROM stdin;
f683ba14-5a61-4ee0-8fc9-07910c753a22	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	RTU Lennox	\N	\N	5613C06290	\N	\N	2025-11-17 15:07:55.986515+00
12331722-b437-4147-93c6-f0675693d1c8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	RTU Lennox	\N	\N	5613C01373	\N	\N	2025-11-17 15:07:55.988822+00
9b5d3f47-bdd7-4aca-b47f-a7d6c0d75425	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	Ice Machine	\N	\N	C09765	\N	\N	2025-11-17 15:07:56.092515+00
2274d0e0-44de-43bf-a79f-595d2b981c10	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	RTU\tLennox	TGA180S2	\N	5605H06310	\N	\N	2025-11-19 15:49:18.505656+00
8a76096b-ef2d-48c6-83c2-76078093ad4a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	RTU\tLennox	TGA180S2	\N	\N	\N	\N	2025-11-19 15:49:18.509114+00
6a65c18f-21a2-48f5-9ef6-3dca6f0c03ab	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	RTU\tLennox	GCS16-060-75	\N	5605L03285	\N	\N	2025-11-19 15:49:18.603478+00
3ed6e875-3fd1-437c-af01-f8cc8e14643c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	Ice Machine	CME1356RS-32F	\N	05121320013829	\N	\N	2025-11-19 15:49:18.604463+00
b47e8fba-0cb4-4500-8362-e539f35c8336	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	RTU Lennox	LGC120S2BS2J	\N	5604H01213	\N	\N	2025-11-20 18:02:00.29029+00
8b33b797-fdc1-44a4-933f-234dada0bc8b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	RTU Lennox	LGH120H4BM4J	\N	5620A05910	\N	\N	2025-11-20 18:02:00.291888+00
\.


--
-- Data for Name: feedback; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.feedback (id, company_id, user_id, user_email, category, message, created_at, status, archived) FROM stdin;
\.


--
-- Data for Name: invitation_tokens; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invitation_tokens (id, company_id, created_by_user_id, token, email, role, expires_at, used_at, used_by_user_id, created_at) FROM stdin;
83aa04bf-7167-4554-86a6-1174bfb7cf1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f614c9d279c8cc06f2978b4068e91e553121664bf7bc223e96efe5993536e65b	nadsamaha@gmail.com	technician	2025-11-28 03:09:32.611	\N	\N	2025-11-21 03:09:32.631
396badaf-38ed-4aed-9f63-32c90101273a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	3764a7a8ba22c9d18fcf9d5084fd99bfde31352333a6dee4ad8686db5fb24fd5	nadsamaha@gmail.com	technician	2025-11-28 03:20:56.957	\N	\N	2025-11-21 03:20:56.977
8f4572ff-9f3f-4873-ab72-ed80c3b0d7d3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	fab475bed7be2e001db992bec8a40524dbfc69bd1200ca38d5421f2c72329ef4	nadsamaha@gmail.com	technician	2025-11-28 03:46:00.458	\N	\N	2025-11-21 03:46:00.482
b33987ce-9414-4bbb-9493-c9be1bea09a9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ec14e768d819f85f6cc1479f4e0ae25ec1ed88375b549bce188ea66b9b96395e	nadsamaha@gmail.com	technician	2025-11-28 03:59:22.924	\N	\N	2025-11-21 03:59:22.943
56934e56-f7af-4c65-b4a8-3b5c46d09668	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8bd65820eaa15131195c678274d28ef10d73c2061210550fd67a7ae9f1080dc4	nadsamaha@gmail.com	technician	2025-11-28 04:18:40.204	\N	\N	2025-11-21 04:18:40.224
6e925c1e-70d6-4212-8871-55bdc74d68e8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	29613b9c87762b532e537d9b687313a879343a6fe758701e97f0be8a81dad843	nadsamaha@gmail.com	technician	2025-11-28 04:37:20.487	\N	\N	2025-11-21 04:37:20.507
d63456bf-e405-407f-9451-6624e0c0622d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	781525a0631a4ee4cbbeaedf9095346176aff41982d789a5d7ca10a69803de82	nadsamaha@gmail.com	technician	2025-11-28 04:38:24.87	\N	\N	2025-11-21 04:38:24.89
8144aab0-51bc-4ce3-82c1-1f943d31c343	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9f9314282f76a0b6c21328a133aa03419e912454b3e258ad679b291927421f65	freezeflowai@gmail.com	technician	2025-11-28 04:40:51.44	2025-11-21 04:42:04.928	e43b044b-2a32-4ad7-979c-82d6bbb3627d	2025-11-21 04:40:51.461
\.


--
-- Data for Name: invitations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invitations (id, company_id, email, role, token, status, expires_at, accepted_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoice_lines (id, invoice_id, line_number, description, quantity, unit_price, line_subtotal, tax_code, qbo_item_ref_id, qbo_tax_code_ref_id, metadata, created_at, updated_at, line_item_type, date, technician_id, tax_rate, job_line_item_id, unit_cost) FROM stdin;
2dc3672b-7415-4974-839e-30ba9749047d	35b32981-bdcf-47d4-beda-5a5f55ef71d5	1	Labour (Includes Travel)	1	90.00	90.00	\N	\N	\N	\N	2025-12-13 17:03:16.553478	\N	material	\N	\N	0.13	3f12e85a-f8cf-4e3a-b6dc-ef70ae639880	0
916457f2-aa49-459e-8fee-c4f39400b7b9	35b32981-bdcf-47d4-beda-5a5f55ef71d5	2	Compressor	1	0	0.00	\N	\N	\N	\N	2025-12-13 17:03:16.634799	\N	material	\N	\N	0.13	173e9c8f-cd5d-43ee-9ca9-5bf97b0d2a41	0
675acf46-bb39-4a3d-a93a-ea9825491f7f	35b32981-bdcf-47d4-beda-5a5f55ef71d5	3	Equipment/Supply	1	135	135.00	\N	\N	\N	\N	2025-12-13 17:03:16.707062	\N	material	\N	\N	0.13	993803d7-3b62-42ce-b607-ad5bd7755d72	0
a6c497bf-7892-462b-a295-74d55b0f5a10	35b32981-bdcf-47d4-beda-5a5f55ef71d5	4	Filter Drier	1	65	65.00	\N	\N	\N	\N	2025-12-13 17:03:16.779831	\N	material	\N	\N	0.13	412c16d1-3613-4872-881b-d538fd95bb78	0
00944fb3-1fc3-4900-b43d-74fdd1ca2223	35b32981-bdcf-47d4-beda-5a5f55ef71d5	5	Refrigerant	1	50	50.00	\N	\N	\N	\N	2025-12-13 17:03:16.85212	\N	material	\N	\N	0.13	14e65048-1c5d-4834-9102-f9db47bcbed5	0
39bc1131-a1ba-4d51-b568-999262578929	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	1	Labour (Includes Travel)	2	90.00	180.00	\N	\N	\N	\N	2025-12-16 22:35:41.937575	\N	material	\N	\N	0.13	efd7d1b3-60ae-418c-94e5-22e97819cfff	0
4aa274cc-2b43-4940-972a-bed318a9ace3	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	2	Truck Charge	1	45	45.00	\N	\N	\N	\N	2025-12-16 22:35:42.031233	\N	material	\N	\N	0.13	80472f29-0484-421b-ad82-5e902322c57e	0
5d3b6fd1-d0ea-4d90-bee0-d539f5a90f11	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	1	Labour (Includes Travel)	2	90.00	180.00	\N	\N	\N	\N	2025-12-16 22:37:43.512058	\N	material	\N	\N	0.13	efd7d1b3-60ae-418c-94e5-22e97819cfff	0
36b4a9f3-1086-4276-b91b-0a31a2b6e532	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	2	Belt 3L190	1	55	55.00	\N	\N	\N	\N	2025-12-16 22:37:43.586811	\N	material	\N	\N	0.13	27884682-53d7-490a-b2e5-b6ba9c4fe487	22
865531ac-6e26-43a4-8006-287212d6c54a	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	3	Truck Charge	1	45	45.00	\N	\N	\N	\N	2025-12-16 22:37:43.660689	\N	material	\N	\N	0.13	80472f29-0484-421b-ad82-5e902322c57e	0
ad15b090-4cab-4803-8a05-9b96138fb59f	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	1	Labour (Includes Travel)	2	90.00	180.00	\N	\N	\N	\N	2025-12-16 22:38:28.279756	\N	material	\N	\N	0.13	efd7d1b3-60ae-418c-94e5-22e97819cfff	0
ff246c3b-f160-43ad-b81b-0ed4655e7185	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	2	Belt 3L190	1	55	55.00	\N	\N	\N	\N	2025-12-16 22:38:28.356977	\N	material	\N	\N	0.13	27884682-53d7-490a-b2e5-b6ba9c4fe487	22
4afe5606-188d-4543-8a5c-d5ed7499e0fe	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	3	Truck Charge	1	45	45.00	\N	\N	\N	\N	2025-12-16 22:38:28.429963	\N	material	\N	\N	0.13	80472f29-0484-421b-ad82-5e902322c57e	0
9da083c6-0951-4c5e-bf83-c5b4b4c28155	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	1	Labour (Includes Travel)	2	90.00	180.00	\N	\N	\N	\N	2025-12-16 22:38:41.608029	\N	material	\N	\N	0.13	efd7d1b3-60ae-418c-94e5-22e97819cfff	0
ef7d0700-4832-4518-a579-1e2d1b4e4d86	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	2	Belt 3L190	1	55	55.00	\N	\N	\N	\N	2025-12-16 22:38:41.681446	\N	material	\N	\N	0.13	27884682-53d7-490a-b2e5-b6ba9c4fe487	22
284630b1-cbaf-4a4b-a190-9abc643416bd	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	3	Truck Charge	1	45	45.00	\N	\N	\N	\N	2025-12-16 22:38:41.754919	\N	material	\N	\N	0.13	80472f29-0484-421b-ad82-5e902322c57e	0
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoices (id, company_id, location_id, customer_company_id, invoice_number, status, issue_date, due_date, currency, subtotal, tax_total, total, notes_internal, notes_customer, qbo_invoice_id, qbo_sync_token, qbo_last_synced_at, qbo_doc_number, is_active, created_at, updated_at, amount_paid, balance, job_id, sent_at, viewed_at, work_description, client_message, show_quantity, show_unit_price, show_line_totals, show_line_items, show_balance, dirty) FROM stdin;
35b32981-bdcf-47d4-beda-5a5f55ef71d5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	b54c29af-0e21-4631-b5fa-233a52e7180c	2fe5dc64-c96b-4a0e-8739-a217c44e6163	1002	draft	2025-12-13	2026-01-12	CAD	340.00	44.20	384.20	\N	\N	\N	\N	\N	\N	t	2025-12-13 17:03:16.256309	2025-12-13 17:03:16.89	0	384.20	222cd49d-8058-48e5-9009-8f69c9fc80ed	\N	\N	- Safety & Recovery: Power was safely disconnected, and all old refrigerant was professionally and environmentally recovered from the system.\n- The faulty compressor and the old liquid line filter/drier were safely removed and prepared for disposal.\n- A new, correctly matched compressor and a new filter/drier were installed.\n- All connecting pipes were soldered (brazed) with an inert nitrogen purge to prevent contamination and scale from entering the system.\n- A deep, high-vacuum process was performed to completely remove all moisture and air from the internal components.\n- The system was charged with the precise manufacturer-specified weight of new refrigerant.\n- The unit was started, and all operating pressures, temperatures, and electrical readings were checked and adjusted to confirm the new compressor is running at peak performance and efficiency. All joints were checked for leaks.	\N	t	t	t	t	t	f
c061cb02-0d6e-4237-a6f0-f0d756ea04d5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	58593e8c-21c7-4fb4-aee1-750e46f2138a	\N	1003	draft	2025-12-16	2026-01-15	CAD	280.00	36.40	316.40	\N	\N	\N	\N	\N	\N	t	2025-12-16 22:35:41.482615	2025-12-16 22:38:41.795	0	316.40	41332fdf-f004-4b9c-aa6a-0b3df0f1b283	\N	\N	\N	\N	t	t	t	t	t	f
\.


--
-- Data for Name: job_equipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_equipment (id, job_id, equipment_id, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: job_notes; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_notes (id, company_id, assignment_id, user_id, note_text, image_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: job_parts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_parts (id, job_id, product_id, equipment_id, description, quantity, unit_price, source, equipment_label, is_active, created_at, updated_at, unit_cost, sort_order) FROM stdin;
8dacd328-d394-45fa-b7b9-4a7c05302780	53d6a370-fa35-4219-845e-702beadc5a23	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	f	2025-12-11 18:30:38.134269	2025-12-11 18:49:04.368	\N	2
d4f6183d-5ad6-40b2-a7a7-7b2feb6f8f76	c4932432-d0d1-473c-b73c-d62ec2e87519	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	Belt 3L190	1	0	manual	\N	f	2025-12-10 03:21:49.921263	2025-12-10 03:21:52.791	\N	0
04fd1bcf-0895-4520-8ee2-b086c36b6c3f	c4932432-d0d1-473c-b73c-d62ec2e87519	37f3e58c-d24b-4061-810f-353b9785ff11	\N	Labour	1	90	manual	\N	f	2025-12-10 03:21:38.199552	2025-12-10 03:21:54.972	\N	0
6b2cce24-b0dd-4591-b381-af3610d03146	c4932432-d0d1-473c-b73c-d62ec2e87519	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	dsafds	1	0	manual	\N	f	2025-12-10 00:27:46.485465	2025-12-10 03:21:57.045	\N	0
871d3cb9-7ffa-4d22-847c-d08280f116a9	c4932432-d0d1-473c-b73c-d62ec2e87519	f4e18fa8-e221-46fa-a818-3e0423e0b696	\N	sdfa	1	0	manual	\N	f	2025-12-10 00:27:52.645407	2025-12-10 03:21:59.797	\N	0
b27f1360-ee02-4b1f-ba5d-ae68f9775141	c4932432-d0d1-473c-b73c-d62ec2e87519	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	belt	1	87	manual	\N	f	2025-12-09 23:58:03.946249	2025-12-10 03:22:02.088	\N	0
f3847b66-8e28-44fa-899c-df9b1fc274d9	bfba1b26-1b37-4770-bed5-53ccaca5a644	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	Belt 3L190	1	550	manual	\N	t	2025-12-10 21:11:47.502648	\N	\N	0
3e77366b-ea39-4695-be51-fa2859ac7d59	bfba1b26-1b37-4770-bed5-53ccaca5a644	f4e18fa8-e221-46fa-a818-3e0423e0b696	\N	Belt 3L220	1	44	manual	\N	t	2025-12-10 21:11:56.10282	\N	\N	0
ae7e1d71-dadc-42c1-ac07-410e762fd9e6	bfba1b26-1b37-4770-bed5-53ccaca5a644	6789b99d-b4b5-4abf-bd2e-2acd36e6e9c8	\N	Belt A18	1	77	manual	\N	t	2025-12-10 21:12:06.654801	\N	\N	0
5e40f0ed-b81e-420e-84c8-b40fab485d4b	c6443278-6651-4037-96b5-adf76e6fc2ec	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	f	2025-12-11 17:28:05.791637	2025-12-11 17:28:20.42	\N	0
af8018c9-59a0-402f-86bd-65473c1bcbeb	c6443278-6651-4037-96b5-adf76e6fc2ec	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-11 17:28:05.86621	2025-12-11 17:28:22.889	\N	0
9145c85e-bfae-4e2f-95c8-2546a9b6ffa2	c6443278-6651-4037-96b5-adf76e6fc2ec	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	t	2025-12-11 17:37:47.758037	\N	\N	0
a41d9346-974c-441e-8447-941451213265	c6443278-6651-4037-96b5-adf76e6fc2ec	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	t	2025-12-11 17:37:47.837127	\N	\N	0
600885d9-9ec6-44a6-b20e-a44f6203b81b	c6443278-6651-4037-96b5-adf76e6fc2ec	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	t	2025-12-11 17:37:47.914637	\N	\N	0
b14cd889-17b0-49b6-87ea-b3452757ee6e	c6443278-6651-4037-96b5-adf76e6fc2ec	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	t	2025-12-11 17:37:47.98826	\N	\N	0
151f7205-7db6-4018-9f2a-1934588ff4d2	c6443278-6651-4037-96b5-adf76e6fc2ec	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	t	2025-12-11 17:37:48.062431	\N	\N	0
bc47ab34-d794-4d82-a2fb-d63a8a2f7f97	c6443278-6651-4037-96b5-adf76e6fc2ec	321426eb-b19e-42c2-b644-06b5b8955f96	\N	Labour (After Hours)	1	135	manual	\N	f	2025-12-11 17:28:12.092165	2025-12-11 17:37:52.508	\N	0
a3d1f090-7cb6-47f8-8cac-cbd14b675d75	c6443278-6651-4037-96b5-adf76e6fc2ec	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-11 17:28:12.164087	2025-12-11 17:37:55.036	\N	0
6ff57fd9-c512-4ed0-8da7-27e09f72c390	c6443278-6651-4037-96b5-adf76e6fc2ec	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	t	2025-12-11 18:43:22.019546	\N	\N	5
40285707-09ec-4b56-b543-787a02466a74	c6443278-6651-4037-96b5-adf76e6fc2ec	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	t	2025-12-11 18:43:22.134925	\N	\N	6
8c199367-1a78-48fd-ae49-3d1462a08857	c6443278-6651-4037-96b5-adf76e6fc2ec	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	t	2025-12-11 18:43:22.208986	\N	\N	7
e2fd09ee-3cb5-41af-adb3-2f41cb9c0110	c6443278-6651-4037-96b5-adf76e6fc2ec	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	t	2025-12-11 18:43:22.28952	\N	\N	8
abaec886-1fcc-4434-bd46-9d28c5730cc3	c6443278-6651-4037-96b5-adf76e6fc2ec	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	t	2025-12-11 18:43:22.363071	\N	\N	9
91c0bbc2-827f-43f0-9d2a-df298317337d	53d6a370-fa35-4219-845e-702beadc5a23	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	f	2025-12-11 18:30:37.98499	2025-12-11 18:49:03.408	\N	0
8c5c345e-615e-43fe-8cfc-fd76c9ab7ddb	53d6a370-fa35-4219-845e-702beadc5a23	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	f	2025-12-11 18:30:38.061252	2025-12-11 18:49:03.889	\N	1
d381d222-d93e-4694-a45b-00574ae62210	53d6a370-fa35-4219-845e-702beadc5a23	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	f	2025-12-11 18:30:38.208461	2025-12-11 18:49:04.853	\N	3
087adfbd-db69-4c3f-b3f4-7cbfc50ed6de	53d6a370-fa35-4219-845e-702beadc5a23	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	f	2025-12-11 18:30:38.282974	2025-12-11 18:49:05.339	\N	4
560cd255-99dd-4e91-8074-04c10ff7b112	53d6a370-fa35-4219-845e-702beadc5a23	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	2	90.00	manual	\N	f	2025-12-11 18:49:06.159642	2025-12-11 19:48:32.779	\N	0
8f1099fa-e6f3-4656-a086-21152f827dff	53d6a370-fa35-4219-845e-702beadc5a23	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-11 18:49:06.236978	2025-12-11 19:48:33.257	\N	1
6f2b6e78-4af2-43a9-ade2-6e9e859da44b	53d6a370-fa35-4219-845e-702beadc5a23	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	2	90.00	manual	\N	f	2025-12-11 19:48:34.153606	2025-12-11 19:48:40.467	\N	0
9644b7ac-82c0-4cb5-a647-a54f6d41acf8	53d6a370-fa35-4219-845e-702beadc5a23	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-11 19:48:34.231952	2025-12-11 19:48:40.951	\N	1
503f59b2-342b-4db7-a3c3-693162ac47a0	53d6a370-fa35-4219-845e-702beadc5a23	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	f	2025-12-11 19:48:41.864855	2025-12-11 19:48:46.472	\N	0
5bead1af-d9cf-439a-b40c-acacc08a6fdd	53d6a370-fa35-4219-845e-702beadc5a23	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	f	2025-12-11 19:48:41.944826	2025-12-11 19:48:46.935	\N	1
390b79bf-33c5-4f72-b0be-7feea55a48f8	53d6a370-fa35-4219-845e-702beadc5a23	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	f	2025-12-11 19:48:42.021273	2025-12-11 19:48:47.42	\N	2
ef31b672-f5ad-43fc-9baa-9ba0ba3b7334	53d6a370-fa35-4219-845e-702beadc5a23	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	f	2025-12-11 19:48:42.098844	2025-12-11 19:48:47.909	\N	3
d6ff61bd-54b5-4680-80fb-1693be8bfae3	53d6a370-fa35-4219-845e-702beadc5a23	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	f	2025-12-11 19:48:42.177772	2025-12-11 19:48:48.398	\N	4
81ec2e0c-1675-4e36-b5c8-2108eda8f7f1	53d6a370-fa35-4219-845e-702beadc5a23	321426eb-b19e-42c2-b644-06b5b8955f96	\N	Labour (After Hours)	1	135	manual	\N	f	2025-12-11 19:48:49.306479	2025-12-11 21:34:59.428	\N	0
5ededdf2-c25b-4994-a0a9-dad68bdc58b8	53d6a370-fa35-4219-845e-702beadc5a23	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-11 19:48:49.381779	2025-12-11 21:34:59.918	\N	1
08a92664-8562-487c-8116-ffa72fc8c841	53d6a370-fa35-4219-845e-702beadc5a23	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	t	2025-12-11 21:35:00.907525	\N	\N	0
f2d9af35-b16b-41aa-b4f5-1f5558e62f84	53d6a370-fa35-4219-845e-702beadc5a23	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	t	2025-12-11 21:35:01.063474	\N	\N	2
0a9f6988-a4f0-4bad-89ab-0083aa270412	53d6a370-fa35-4219-845e-702beadc5a23	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	t	2025-12-11 21:35:01.13795	\N	\N	3
42fb1e8f-274c-40fc-8ccb-328239262533	53d6a370-fa35-4219-845e-702beadc5a23	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	t	2025-12-11 21:35:01.214512	\N	\N	4
da847aa0-86fd-4baf-91a3-c2c629ac00bc	53d6a370-fa35-4219-845e-702beadc5a23	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	1000	manual	\N	t	2025-12-11 21:35:00.988447	2025-12-11 21:35:22.511	0	1
f98f366f-0e79-4a63-a463-42643d512764	281d3853-d0cf-4381-a4ea-762d9ed71705	321426eb-b19e-42c2-b644-06b5b8955f96	\N	Labour (After Hours)	1	135	manual	\N	t	2025-12-13 16:55:41.136901	\N	\N	0
f58262f2-1906-42a6-bcfa-d1b4785cbdfc	281d3853-d0cf-4381-a4ea-762d9ed71705	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	t	2025-12-13 16:55:41.212604	\N	\N	1
4be6158a-11c9-4a52-b3d0-1d9bddcae8dc	222cd49d-8058-48e5-9009-8f69c9fc80ed	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	f	2025-12-13 17:01:55.650598	2025-12-13 17:02:16.086	\N	0
8454e4b2-9ba7-44ff-9586-e240951f7b4a	222cd49d-8058-48e5-9009-8f69c9fc80ed	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	f	2025-12-13 17:01:55.724969	2025-12-13 17:02:16.576	\N	1
e5305d84-a944-4e69-8c9e-3991890d3e64	222cd49d-8058-48e5-9009-8f69c9fc80ed	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	f	2025-12-13 17:01:55.799602	2025-12-13 17:02:17.065	\N	2
e60bcc72-6fe0-4997-94fd-516d2b62fd30	222cd49d-8058-48e5-9009-8f69c9fc80ed	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	f	2025-12-13 17:01:55.874252	2025-12-13 17:02:17.57	\N	3
49c485e4-87b3-4a5f-8d33-8f142bd5e732	222cd49d-8058-48e5-9009-8f69c9fc80ed	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	f	2025-12-13 17:01:55.948353	2025-12-13 17:02:18.053	\N	4
04a75f70-f320-4a2a-ad76-e7acae53df65	222cd49d-8058-48e5-9009-8f69c9fc80ed	321426eb-b19e-42c2-b644-06b5b8955f96	\N	Labour (After Hours)	1	135	manual	\N	f	2025-12-13 17:02:18.927296	2025-12-13 17:02:27.67	\N	0
ee8886dd-61f3-472a-95a5-bdda8ee90032	222cd49d-8058-48e5-9009-8f69c9fc80ed	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	f	2025-12-13 17:02:19.000497	2025-12-13 17:02:28.143	\N	1
3f12e85a-f8cf-4e3a-b6dc-ef70ae639880	222cd49d-8058-48e5-9009-8f69c9fc80ed	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	1	90.00	manual	\N	t	2025-12-13 17:02:29.03042	\N	\N	0
173e9c8f-cd5d-43ee-9ca9-5bf97b0d2a41	222cd49d-8058-48e5-9009-8f69c9fc80ed	a082b8a4-e21a-4a30-9981-f414907beefb	\N	Compressor	1	0	manual	\N	t	2025-12-13 17:02:29.102501	\N	\N	1
993803d7-3b62-42ce-b607-ad5bd7755d72	222cd49d-8058-48e5-9009-8f69c9fc80ed	6e8de89e-400f-455f-ae3b-02df93649238	\N	Equipment/Supply	1	135	manual	\N	t	2025-12-13 17:02:29.174382	\N	\N	2
412c16d1-3613-4872-881b-d538fd95bb78	222cd49d-8058-48e5-9009-8f69c9fc80ed	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	Filter Drier	1	65	manual	\N	t	2025-12-13 17:02:29.246299	\N	\N	3
14e65048-1c5d-4834-9102-f9db47bcbed5	222cd49d-8058-48e5-9009-8f69c9fc80ed	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	Refrigerant	1	50	manual	\N	t	2025-12-13 17:02:29.318385	\N	\N	4
81850969-fdff-493b-bb82-8c97155336f3	222cd49d-8058-48e5-9009-8f69c9fc80ed	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	Belt 3L190	1	0	manual	\N	t	2025-12-13 17:05:17.952629	\N	0	0
efd7d1b3-60ae-418c-94e5-22e97819cfff	41332fdf-f004-4b9c-aa6a-0b3df0f1b283	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	Labour (Includes Travel)	2	90.00	manual	\N	t	2025-12-16 22:35:07.509314	\N	\N	0
80472f29-0484-421b-ad82-5e902322c57e	41332fdf-f004-4b9c-aa6a-0b3df0f1b283	ab40704e-a423-4aba-afcd-40649e965394	\N	Truck Charge	1	45	manual	\N	t	2025-12-16 22:35:07.585379	\N	\N	1
27884682-53d7-490a-b2e5-b6ba9c4fe487	41332fdf-f004-4b9c-aa6a-0b3df0f1b283	62bb9763-f6a2-45f4-8f0a-1378a13f88a4	\N	Belt 3L190	1	55	manual	\N	t	2025-12-16 22:37:25.31693	2025-12-16 22:37:35.761	22	0
\.


--
-- Data for Name: job_template_line_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_template_line_items (id, template_id, product_id, description_override, quantity, unit_price_override, sort_order, created_at) FROM stdin;
f1bdd758-6898-4964-94ef-6d3743140d95	62c6f84c-e89c-440c-a97a-d0292e55b851	321426eb-b19e-42c2-b644-06b5b8955f96	\N	1	135	0	2025-12-11 17:27:00.802774
424d34eb-e5ff-456e-9a36-c437e823e6f3	62c6f84c-e89c-440c-a97a-d0292e55b851	ab40704e-a423-4aba-afcd-40649e965394	\N	1	45	1	2025-12-11 17:27:00.802774
b43951f4-571d-4d69-a575-ec8c6a383756	23f73959-6d07-41fa-aa61-9162fb5799e1	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	1	90.00	0	2025-12-11 17:40:34.309001
aaa38351-a0a9-4a18-bbfb-46b6c04403e3	23f73959-6d07-41fa-aa61-9162fb5799e1	a082b8a4-e21a-4a30-9981-f414907beefb	\N	1	\N	1	2025-12-11 17:40:34.309001
019e38ae-d62e-4f55-bfdd-8a2a0f7a82e3	23f73959-6d07-41fa-aa61-9162fb5799e1	6e8de89e-400f-455f-ae3b-02df93649238	\N	1	135	2	2025-12-11 17:40:34.309001
3e9d2939-5472-4170-a8ba-835ad83b4f90	23f73959-6d07-41fa-aa61-9162fb5799e1	333c46b8-0bbe-435a-a9e9-49e82c8670ce	\N	1	65	3	2025-12-11 17:40:34.309001
5f6e1236-b2a8-4701-99c0-8f6c4bd70ce4	23f73959-6d07-41fa-aa61-9162fb5799e1	82fda6b6-514b-47ab-b89b-9e816df8eea8	\N	1	50	4	2025-12-11 17:40:34.309001
321a39fd-8186-480d-861b-f9d2421c44d2	90cdde49-dd2a-4829-8358-e59a08654b62	29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	\N	2	90.00	0	2025-12-11 18:06:02.583367
a3fb92e8-67e0-48e8-8690-9669d49fd99e	90cdde49-dd2a-4829-8358-e59a08654b62	ab40704e-a423-4aba-afcd-40649e965394	\N	1	45	1	2025-12-11 18:06:02.583367
\.


--
-- Data for Name: job_templates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_templates (id, company_id, name, job_type, description, is_default_for_job_type, is_active, created_at, updated_at) FROM stdin;
62c6f84c-e89c-440c-a97a-d0292e55b851	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Service Call (After Hours)	service_call	\N	f	t	2025-12-11 17:26:07.383002	2025-12-11 17:27:00.62
23f73959-6d07-41fa-aa61-9162fb5799e1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Compressor Replacement	repair	- Safety & Recovery: Power was safely disconnected, and all old refrigerant was professionally and environmentally recovered from the system.\n- The faulty compressor and the old liquid line filter/drier were safely removed and prepared for disposal.\n- A new, correctly matched compressor and a new filter/drier were installed.\n- All connecting pipes were soldered (brazed) with an inert nitrogen purge to prevent contamination and scale from entering the system.\n- A deep, high-vacuum process was performed to completely remove all moisture and air from the internal components.\n- The system was charged with the precise manufacturer-specified weight of new refrigerant.\n- The unit was started, and all operating pressures, temperatures, and electrical readings were checked and adjusted to confirm the new compressor is running at peak performance and efficiency. All joints were checked for leaks.	f	t	2025-12-11 17:37:18.614098	2025-12-11 17:40:34.127
90cdde49-dd2a-4829-8358-e59a08654b62	25b87fb2-7dc7-489b-a6aa-e99da73f4824	Service Call	service_call	\N	t	t	2025-12-11 17:26:01.816553	2025-12-11 18:06:02.397
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.jobs (id, company_id, location_id, job_number, primary_technician_id, assigned_technician_ids, status, priority, job_type, summary, description, access_instructions, scheduled_start, scheduled_end, actual_start, actual_end, invoice_id, qbo_invoice_id, billing_notes, recurring_series_id, calendar_assignment_id, is_active, created_at, updated_at) FROM stdin;
c4932432-d0d1-473c-b73c-d62ec2e87519	25b87fb2-7dc7-489b-a6aa-e99da73f4824	c502142b-98a1-4b2d-9f3f-bb44ca961c6b	10134	\N	\N	scheduled	low	maintenance	remove ladder from mud room 222222	description data	access instructions	\N	\N	\N	\N	\N	\N	quoted 500	\N	\N	f	2025-12-08 00:35:15.118485	2025-12-10 03:22:06.63
c6443278-6651-4037-96b5-adf76e6fc2ec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	c502142b-98a1-4b2d-9f3f-bb44ca961c6b	10164	e43b044b-2a32-4ad7-979c-82d6bbb3627d	\N	scheduled	medium	emergency	Template test	- Safety & Recovery: Power was safely disconnected, and all old refrigerant was professionally and environmentally recovered from the system.\n- The faulty compressor and the old liquid line filter/drier were safely removed and prepared for disposal.\n- A new, correctly matched compressor and a new filter/drier were installed.\n- All connecting pipes were soldered (brazed) with an inert nitrogen purge to prevent contamination and scale from entering the system.\n- A deep, high-vacuum process was performed to completely remove all moisture and air from the internal components.\n- The system was charged with the precise manufacturer-specified weight of new refrigerant.\n- The unit was started, and all operating pressures, temperatures, and electrical readings were checked and adjusted to confirm the new compressor is running at peak performance and efficiency. All joints were checked for leaks.	\N	2025-12-11 12:27:00	\N	\N	\N	\N	\N	\N	\N	\N	f	2025-12-11 17:27:52.416176	2025-12-13 16:56:21.973
bfba1b26-1b37-4770-bed5-53ccaca5a644	25b87fb2-7dc7-489b-a6aa-e99da73f4824	c502142b-98a1-4b2d-9f3f-bb44ca961c6b	10133	\N	\N	completed	medium	emergency	remove ladder from mud room	\N	roof code 3333	2025-12-07 19:09:00	\N	\N	\N	\N	\N	\N	\N	\N	f	2025-12-08 00:09:58.756406	2025-12-13 16:56:27.386
578e1eb5-088d-4cca-bdb8-608940cfa53c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	10135	\N	\N	scheduled	medium	maintenance	Preventive Maintenance	\N	\N	2025-12-03 09:00:00	\N	\N	\N	\N	\N	\N	\N	\N	f	2025-12-08 12:40:09.384054	2025-12-13 16:56:34.568
e7525b5a-29fe-49a8-bb36-fa92554cdfd9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	10161	\N	\N	scheduled	medium	maintenance	PM Visit - December 2025 - Basil Box	\N	\N	2025-12-03 00:00:00	\N	\N	\N	\N	\N	\N	\N	\N	f	2025-12-08 13:38:43.671115	2025-12-13 16:56:42.753
281d3853-d0cf-4381-a4ea-762d9ed71705	25b87fb2-7dc7-489b-a6aa-e99da73f4824	b54c29af-0e21-4631-b5fa-233a52e7180c	10166	e43b044b-2a32-4ad7-979c-82d6bbb3627d	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	scheduled	medium	maintenance	Preventive Maintenance	\N	Charm	2025-12-13 11:54:00	2025-12-13 11:54:00	\N	\N	\N	\N	Can't charge for this	\N	\N	f	2025-12-13 16:55:16.724378	2025-12-13 16:56:03.082
53d6a370-fa35-4219-845e-702beadc5a23	25b87fb2-7dc7-489b-a6aa-e99da73f4824	c502142b-98a1-4b2d-9f3f-bb44ca961c6b	10165	e43b044b-2a32-4ad7-979c-82d6bbb3627d	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	invoiced	medium	installation	Makeuup install	- Safety & Recovery: Power was safely disconnected, and all old refrigerant was professionally and environmentally recovered from the system.\n- The faulty compressor and the old liquid line filter/drier were safely removed and prepared for disposal.\n- A new, correctly matched compressor and a new filter/drier were installed.\n- All connecting pipes were soldered (brazed) with an inert nitrogen purge to prevent contamination and scale from entering the system.\n- A deep, high-vacuum process was performed to completely remove all moisture and air from the internal components.\n- The system was charged with the precise manufacturer-specified weight of new refrigerant.\n- The unit was started, and all operating pressures, temperatures, and electrical readings were checked and adjusted to confirm the new compressor is running at peak performance and efficiency. All joints were checked for leaks.	\N	2025-12-11 13:04:00	\N	\N	\N	\N	\N	\N	\N	\N	f	2025-12-11 18:04:54.190381	2025-12-13 16:56:14.069
222cd49d-8058-48e5-9009-8f69c9fc80ed	25b87fb2-7dc7-489b-a6aa-e99da73f4824	b54c29af-0e21-4631-b5fa-233a52e7180c	10167	e43b044b-2a32-4ad7-979c-82d6bbb3627d	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	completed	medium	emergency	Help with her plumbing	- Safety & Recovery: Power was safely disconnected, and all old refrigerant was professionally and environmentally recovered from the system.\n- The faulty compressor and the old liquid line filter/drier were safely removed and prepared for disposal.\n- A new, correctly matched compressor and a new filter/drier were installed.\n- All connecting pipes were soldered (brazed) with an inert nitrogen purge to prevent contamination and scale from entering the system.\n- A deep, high-vacuum process was performed to completely remove all moisture and air from the internal components.\n- The system was charged with the precise manufacturer-specified weight of new refrigerant.\n- The unit was started, and all operating pressures, temperatures, and electrical readings were checked and adjusted to confirm the new compressor is running at peak performance and efficiency. All joints were checked for leaks.	Charm	2025-12-13 17:59:00	\N	\N	\N	35b32981-bdcf-47d4-beda-5a5f55ef71d5	\N	Can't charge	\N	\N	t	2025-12-13 17:00:02.45464	2025-12-13 17:03:16.298
41332fdf-f004-4b9c-aa6a-0b3df0f1b283	25b87fb2-7dc7-489b-a6aa-e99da73f4824	58593e8c-21c7-4fb4-aee1-750e46f2138a	10169	e43b044b-2a32-4ad7-979c-82d6bbb3627d	{e43b044b-2a32-4ad7-979c-82d6bbb3627d}	completed	medium	maintenance	Preventive Maintenance	\N	\N	\N	\N	\N	\N	c061cb02-0d6e-4237-a6f0-f0d756ea04d5	\N	\N	\N	\N	t	2025-12-16 22:34:51.088373	2025-12-16 22:35:41.075
\.


--
-- Data for Name: labor_entries; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.labor_entries (id, company_id, technician_id, job_id, minutes, note, created_at) FROM stdin;
\.


--
-- Data for Name: location_equipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.location_equipment (id, location_id, name, equipment_type, manufacturer, model_number, serial_number, tag_number, install_date, warranty_expiry, notes, is_active, created_at, updated_at) FROM stdin;
e827eee2-80ec-4d15-8ec3-0ae261ede0ac	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	Dining HVAC	rtu	Lennox	LGA	556	\N	\N	\N	\N	t	2025-12-08 12:38:00.6416	\N
\.


--
-- Data for Name: location_pm_part_templates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.location_pm_part_templates (id, location_id, product_id, equipment_id, description_override, quantity_per_visit, equipment_label, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: location_pm_plans; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.location_pm_plans (id, location_id, has_pm, pm_type, pm_jan, pm_feb, pm_mar, pm_apr, pm_may, pm_jun, pm_jul, pm_aug, pm_sep, pm_oct, pm_nov, pm_dec, notes, recurring_series_id, is_active, created_at, updated_at) FROM stdin;
fe7414c2-a071-4d02-91e8-5b2f7762def3	fdc8a6dc-53ff-47dd-aab0-cbc16b6331ac	t	\N	f	f	t	f	f	f	t	f	f	f	f	t	\N	\N	t	2025-12-08 12:38:17.09312	\N
\.


--
-- Data for Name: maintenance_records; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.maintenance_records (id, company_id, user_id, client_id, due_date, completed_at) FROM stdin;
4f86df31-825b-4b53-852c-1ecb261fd704	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f921231e-6543-44b5-a170-27c78165a725	2025-11-03T00:00:00.000Z	2025-11-17T19:18:52.367Z
e3b81e56-cfb5-4783-8652-d7ae9d21fc5e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	2025-11-03T00:00:00.000Z	2025-11-17T19:18:52.903Z
60c43cf8-ac94-4b0f-9f9d-1e40553c6c26	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	2025-11-04T00:00:00.000Z	2025-11-17T19:18:58.985Z
8271bc65-c572-4a15-babe-e3b61655a346	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	2025-11-04T00:00:00.000Z	2025-11-17T19:19:04.638Z
9a8f79d4-d733-4d02-ad5f-5c983baf802e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	2025-11-12T00:00:00.000Z	2025-11-17T19:19:17.098Z
39f991f2-9e08-402b-8596-2165def18e81	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	2025-11-13T00:00:00.000Z	2025-11-17T19:19:17.615Z
70a0e846-1302-4c7d-ad12-6d6dc5d7062e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2b7af116-8298-4a71-93eb-eff76f28c588	2025-11-30T00:00:00.000Z	\N
b9077ef3-518e-4c55-816e-a73f6a74fbc4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	2025-11-21T05:00:00.000Z	\N
1d39231b-dc62-4e4b-896f-f8527cea0c56	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f4e2c683-9e6a-4837-a711-6c9314bcde02	2025-11-19T05:00:00.000Z	\N
8908ff70-7bab-4f73-8d83-c1bd1b9507d9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	2025-11-20T05:00:00.000Z	\N
21042205-5458-4b4b-a96e-db85dcc24478	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	2025-11-07T00:00:00.000Z	\N
db07e0e1-3bf8-4fe3-9439-8714ebf3bae2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	2025-11-12T00:00:00.000Z	\N
74ae9776-a73b-4987-8262-8deddda8965f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	2025-11-07	\N
67969e06-1645-4827-8b18-0837a1cc433f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	2025-11-13T00:00:00.000Z	\N
ff6efbb5-a29b-4f7e-92c6-387515194861	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	2025-11-16T00:00:00.000Z	\N
71152290-0a07-4b68-8a28-e800303fe88d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	2025-11-16T00:00:00.000Z	\N
3130ee75-bf43-47ef-888c-fdf4346ac1cb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	2026-05-15T00:00:00.000Z	\N
996f5e2c-5b73-4a41-8270-a7fe07110196	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	535a5559-e3be-40c7-9210-6124e939a910	2026-02-15T00:00:00.000Z	\N
f9f136b5-3bed-473d-8959-07c5ea08749d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	2025-11-19T00:00:00.000Z	\N
8b1c6689-876a-41be-8c20-bd6a8810483b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	2026-02-15T00:00:00.000Z	\N
70fa8b8d-ee50-41bb-82ae-5b098f356dbd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	2026-02-15T00:00:00.000Z	2025-11-17T19:18:57.896Z
020c2106-8e50-417c-b646-9def6ebada2c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	2025-11-03T00:00:00.000Z	2025-11-17T19:18:58.396Z
0fe4cd52-971a-4261-aeb0-5be696ba844b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	2025-11-18T00:00:00.000Z	\N
565f7290-afbc-45ec-84ff-444bd636602f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	2025-11-16T00:00:00.000Z	\N
65c75925-4935-43a0-9d85-bd942e0ddcdd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	2025-11-16T00:00:00.000Z	\N
420a17a6-3147-4189-8bea-1379c0ecd627	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ef3fcc8b-b271-4d14-95be-610582246193	2025-11-16T00:00:00.000Z	\N
06bb9225-9d73-493d-b710-415bbf44c21d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7e3e39c4-fd6f-4dca-95c9-9fccc8e3ff14	2025-11-16T00:00:00.000Z	\N
4860d8ac-1434-4348-a3df-02e4725fcad4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	2025-11-04T00:00:00.000Z	\N
253b3557-2003-4080-a7e3-6595e50389fe	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	2026-02-15T00:00:00.000Z	\N
49427289-7169-4244-b924-52d52efdb163	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9807087e-a8df-41dc-b06f-0461da6c802f	2025-11-16T00:00:00.000Z	\N
20e6a003-b6b5-4edb-b076-2ca6237f86d8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f882a557-3caf-483c-9773-2f446a42e675	2026-02-15T05:00:00.000Z	\N
ae46f35c-cea0-4f85-9454-8500f8d5ebd3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f921231e-6543-44b5-a170-27c78165a725	2026-02-15T05:00:00.000Z	\N
8a25743c-885a-4e02-a657-004c7c84dec1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	2025-11-16T00:00:00.000Z	\N
26ed4436-6b2d-4747-9066-a151a13edfd5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	2025-11-16T00:00:00.000Z	\N
312c4a1c-17f4-4ee0-b9dd-fcabd64401f1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	2025-11-29T00:00:00.000Z	\N
8d9ab8ab-3628-4982-a0d4-15784049a633	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	786e0752-2eff-4e49-a257-dcef9f8235ab	2025-11-03T00:00:00.000Z	2025-11-17T19:18:51.818Z
991cbae0-b886-48ac-925e-d50aa3cdc720	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	2025-11-16T00:00:00.000Z	\N
832a087e-5f79-463f-8504-4166fcc999b9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	2025-11-20T00:00:00.000Z	\N
269dc42a-3396-4b5e-b982-4435b7b8d08e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	2025-11-16T00:00:00.000Z	\N
01703679-1953-445a-8ceb-227794e54205	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	2025-11-16T00:00:00.000Z	\N
1e6f4f18-aa38-4399-8836-09e3872fcb3f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	2025-11-16T00:00:00.000Z	\N
653ef5bd-b907-4088-b60c-ba2dda77ae77	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	406a1be5-b5eb-457f-a063-0d8d32928206	2025-11-13T00:00:00.000Z	2025-11-17T19:12:00.788Z
390fe47b-f83c-464b-93e7-427e96c7aa50	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	786e0752-2eff-4e49-a257-dcef9f8235ab	2026-02-15T05:00:00.000Z	\N
3932c554-3d2f-4cb5-b7fd-10185e369332	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adc94337-d765-4da4-a0c9-551375cbbbbd	2026-02-15T05:00:00.000Z	\N
f91b4b3b-03b3-4d80-a54e-e60814f8aabe	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c297f301-0f20-4564-bfcd-a372caf32ecd	2025-11-11T00:00:00.000Z	2025-11-17T19:11:43.175Z
84456cfe-29e1-4edb-a6e3-ea5c9390f952	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	54e49509-3454-4b51-bfa9-9a456c888422	2025-11-12T00:00:00.000Z	2025-11-17T19:11:48.130Z
1aba650c-a28b-4a45-80dc-cdebbcaa4ced	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	2e5ccc98-73c1-43c7-a7fc-1d16095877de	2025-11-12T00:00:00.000Z	2025-11-17T19:11:51.344Z
b6bab06e-f60f-40bc-a53c-69f59e7d3eef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	235ea03e-3967-436e-b960-52dbb4763018	2025-11-13T00:00:00.000Z	2025-11-17T19:11:52.361Z
579e16cf-1f20-468b-9d6f-0a097ce454ee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d8425cbd-bab1-4c6a-8486-2a6bab3bc232	2025-11-17T00:00:00.000Z	2025-11-17T19:11:55.680Z
6d35e00e-eede-4dc8-842a-5a7070e1116c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	419446aa-e178-4302-a311-8d84d46e0229	2025-11-13T00:00:00.000Z	2025-11-17T19:12:05.454Z
63a154e3-ae3d-4a13-b482-2fb379ed123c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8c621079-e823-4f35-86bb-f29b85789eb7	2025-11-17T00:00:00.000Z	2025-11-17T19:12:09.679Z
79008ec2-ba1d-40cd-8c6d-14e8186543ce	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f882a557-3caf-483c-9773-2f446a42e675	2025-11-04T00:00:00.000Z	2025-11-17T19:19:03.550Z
ec0c201a-24e6-431b-b600-26e65e7010dc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	018fd13a-85d6-4e0b-a67b-bff8d79d5282	2025-11-04T00:00:00.000Z	2025-11-17T19:19:04.072Z
0d9d9305-1f1d-4328-8499-1180c062f601	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	2025-11-04T00:00:00.000Z	2025-11-17T19:19:09.324Z
1b7923c9-10be-494a-9b50-5d91d9ae3211	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c85e0bec-1fb8-4b62-abd9-0cde78c77711	2025-11-07T00:00:00.000Z	2025-11-17T19:19:09.824Z
4b714ce0-27a7-487a-9fb3-61c0f9ffa60a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	2025-11-08T00:00:00.000Z	2025-11-17T19:19:10.439Z
efa090ba-a8a2-4258-9cd6-9340a5b8fac6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	44b64a12-6c69-489c-86a3-786e93646dbf	2026-02-15T00:00:00.000Z	2025-11-17T19:19:12.956Z
6d35e14f-6877-41aa-a586-9dc6bcf0a7d8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	2026-02-15T00:00:00.000Z	2025-11-17T19:19:13.481Z
9c9aed22-17cd-41fd-b451-e5053188dd24	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	2025-11-10T00:00:00.000Z	2025-11-17T19:19:14.042Z
7ceedacc-72db-4c24-ac80-7c4f6a24c87c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	af526345-41e6-4c6c-b798-b78e6fd08336	2026-02-15T00:00:00.000Z	2025-11-17T19:19:16.578Z
bfddd58b-7c61-41fe-ba8e-11034259867b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	31a5ff99-432c-478f-bb20-ea822398c420	2026-02-15T00:00:00.000Z	2025-11-17T19:19:19.964Z
a14625cf-ebef-4302-a54a-9eb0bf771240	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	8a387824-9497-49c9-92ac-7fc00b7661d4	2026-03-15T00:00:00.000Z	2025-11-17T19:19:20.503Z
f2d25881-ca81-4a9f-99ce-7ac27d4c8e88	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58317ede-65e7-4d4d-9f65-9f1034105edd	2025-11-12T00:00:00.000Z	2025-11-17T19:21:14.119Z
c2c44f7d-7bfa-4e5b-b71e-da55b2730d39	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7235b45d-2c03-49f3-819a-eb9ba79f587d	2025-11-18T00:00:00.000Z	\N
5fb34e49-9289-4511-b11f-313c9735228e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6f6595e5-b1c1-42ef-a461-111299e60fee	2025-11-19T00:00:00.000Z	2025-11-19T02:36:18.559Z
23ca675c-01d9-4ff7-85b0-d78d80b513dc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	2026-02-15T00:00:00.000Z	\N
ea82b84e-ed99-4885-b04a-f5fc98cf6dd0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	70deb41c-b099-481e-8bd7-672a8030a2dd	2025-11-18T00:00:00.000Z	2025-11-19T03:07:28.381Z
194c9e1f-9df2-4894-bdb3-820d7353fc10	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	34645b91-8ae7-4c6c-8791-dc59e98d6d49	2025-11-19T00:00:00.000Z	2025-11-19T20:43:23.175Z
7e497791-8c7e-4a0d-9659-219de5a76d8d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	c215c81e-c130-4597-80f3-01dc557c1b94	2025-11-19T00:00:00.000Z	2025-11-19T20:43:24.238Z
98931f2f-d872-4d59-b20a-694cd1cc8c43	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f1646f77-f14c-406e-a4fe-dd7ebb015ba4	2025-11-19T00:00:00.000Z	2025-11-19T20:43:25.561Z
7ed463c5-5edc-47c3-bf8e-60dbc913b8e9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	f12cdc98-f777-4c27-8756-cc8403caf8f0	2025-11-20T00:00:00.000Z	2025-11-20T21:07:50.111Z
aa4de428-a157-42f7-b8a2-50d19c338d8e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	51ec63e6-b16f-4fd8-9fef-eac838e0222f	2025-11-20T00:00:00.000Z	2025-11-20T21:07:55.850Z
9b646ce1-9eba-4076-89ee-b4c5786e8a9f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	52a701ac-96a4-4ef6-8b1b-a334a765df09	2025-11-20T00:00:00.000Z	2025-11-20T21:07:58.286Z
338a8c6e-4277-4058-a641-8d19786d103e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	5a3db429-87b4-4e18-a6f6-0e332aa3e5f0	2025-11-25T00:00:00.000Z	2025-11-26T16:16:00.771Z
c477628d-ddf9-46be-9871-762cca271a38	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	33cc1c52-22c1-40a0-9f67-5f79ce7b9752	2025-11-25T00:00:00.000Z	2025-11-26T16:16:04.164Z
fb751126-66fb-4810-9d0e-7c85cf6ff176	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	b4de6b16-b7ba-4e7d-b592-3e7053fd0d9f	2025-11-25T00:00:00.000Z	2025-11-26T16:16:07.236Z
430ead49-c005-45b6-bbd9-804bafe1d3d0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	e54072ef-e02c-4dab-a829-4f270c8c11b4	2025-11-25T00:00:00.000Z	2025-11-26T16:16:18.189Z
f49944e8-91ac-4f6e-9332-cbcf9ce70e5a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1344835b-040a-46b5-bf4c-d244437cb961	2025-11-26T00:00:00.000Z	2025-11-27T13:09:05.993Z
52b28655-dbe7-49fb-a44f-9b9340602eea	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	6b84ac5a-c361-4ece-a899-4ffa6d6c0b3b	2025-11-25T00:00:00.000Z	2025-11-26T16:16:10.094Z
472a7ca3-9417-44b3-be49-795af3559715	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	461f3490-92a4-430e-8cac-266c92725885	2025-11-25T00:00:00.000Z	2025-11-26T16:16:12.770Z
e7304e58-4d08-47b2-a990-3eb9069b73f5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ede5f914-3c1d-4859-8cf1-4998c0121e50	2025-11-25T00:00:00.000Z	2025-11-26T16:16:15.375Z
761a6d44-877e-4ddd-a221-1ed613198cb1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	360a3b6a-3424-4561-b669-cb9e7c0eef8a	2025-11-25T00:00:00.000Z	2025-11-26T16:16:21.118Z
9957c53d-2419-4bc2-b85f-d4800464d361	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	2025-11-26T00:00:00.000Z	\N
08920d4e-8f7b-4a2b-8e32-33528f171fc7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	10abe1db-f7f0-4e67-b7ed-fbda1e0040ae	2025-11-26T00:00:00.000Z	2025-11-27T13:09:13.368Z
f5b6b2a8-01a5-436e-b322-ea59f9ed654e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	7235b45d-2c03-49f3-819a-eb9ba79f587d	2025-11-24T00:00:00.000Z	2025-11-27T15:25:57.161Z
b7c66563-10ba-4f85-8c2a-eaadaefffe22	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	16f939ca-d9a2-4d92-aab9-9b283c20da45	2025-11-28	2025-12-02T11:58:33.083Z
b40934cc-f71d-411e-a040-ae3c484e9365	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	adef31cb-8384-4130-96d8-9800de6fe574	2025-12-01T00:00:00.000Z	2025-12-02T11:59:51.371Z
6441da18-ad4f-489a-8b0d-3981fbd8e853	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	dc8bfd92-9a14-4086-b1ca-e621e27ef31b	2025-11-29	2025-12-02T12:00:32.058Z
ccc0301c-575b-4e48-aff5-169bbf776567	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	d10e838c-ab29-41cb-ba1d-6fc47fb3639c	2025-11-15	2025-12-02T12:00:49.960Z
3f7e4d3c-bbd8-4392-9d86-81171c6648e6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	4b04535e-e0d8-4f43-8fcb-b94523c22045	2025-11-15	2025-12-02T12:01:00.925Z
4e73ca54-9d6a-4e9c-9216-6ecc51603da3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	03400d5f-149b-4d12-a0af-b8a9f0ec2447	2025-11-28	2025-12-02T12:01:11.148Z
c504e7cc-c39e-41f2-ad4b-11cc09cf3d00	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1e783e4f-ffcf-414d-bfb3-f1d4aecfea93	2025-11-15	2025-12-02T12:01:20.711Z
b85fb824-b743-48c3-b3b2-2271e1b81498	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	58593e8c-21c7-4fb4-aee1-750e46f2138a	2025-12-03T00:00:00.000Z	2025-12-04T13:25:19.070Z
14206a74-7293-4f19-a389-bb05e98d8c51	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	84aedf96-bace-4700-b66c-33b47a3d3727	2025-12-03T00:00:00.000Z	2025-12-04T13:25:59.946Z
e14afa1e-fd32-4f19-b2bf-9c9fb561f086	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	304d8fbb-bd38-48a4-9b11-81cfc72282da	2025-12-04	2025-12-06T21:34:57.531Z
dc1cf976-9efa-4c8f-aa39-5a356488bfc8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	ab653f30-2e4c-4e0b-90e2-80989d1a7758	2025-12-03	2025-12-06T21:35:13.587Z
2a1bcbc7-7d67-497c-8b8b-6104b07fa1ec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	9ccd993a-92c7-4294-8850-4700578261b6	2025-12-05	2025-12-06T21:36:19.264Z
704a97f1-d2cd-45c3-8afa-272650b5bf98	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	95764ad3-7315-4a52-9874-1ed560e3d4fd	2025-11-15	2025-12-17T02:57:13.020Z
8c8f9892-54e7-4021-acbd-6fafdde6c754	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1ed6bdf6-c818-473f-9691-c61dd50342bf	2026-06-15T00:00:00.000Z	2025-12-17T02:57:21.757Z
9d5fd40e-8186-4c48-abe2-00fb677f8629	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1b96df6e-86c5-4431-bfc7-b83de5b1e89e	2026-06-15T00:00:00.000Z	2025-12-17T02:57:26.334Z
e5627d8f-1a81-4413-89b3-a70a200a1460	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	04243de4-5307-4e32-9f75-c6eb4c549553	2026-03-15T00:00:00.000Z	2025-12-17T02:57:32.303Z
554732e0-551e-457f-9b95-c5f375884a3f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	1ed6bdf6-c818-473f-9691-c61dd50342bf	2026-12-15T00:00:00.000Z	2025-12-17T16:42:10.825Z
\.


--
-- Data for Name: parts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.parts (id, company_id, user_id, type, filter_type, belt_type, size, name, description, created_at, cost, unit_price, tax_exempt, sku, markup_percent, is_taxable, tax_code, category, is_active, qbo_item_id, qbo_sync_token, updated_at) FROM stdin;
37f3e58c-d24b-4061-810f-353b9785ff11	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	service	\N	\N	\N	Labour	\N	2025-12-10 02:47:22.022965+00	0.00	90	f	\N	\N	t	\N	\N	t	\N	\N	\N
29b4d32e-9b7f-4e3f-ae7b-317b6bbe20bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	service	\N	\N	\N	Labour (Includes Travel)	\N	2025-12-11 16:44:48.776738+00	\N	90.00	f	\N	\N	t	\N	Other	t	\N	\N	\N
ab40704e-a423-4aba-afcd-40649e965394	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	\N	\N	Truck Charge	\N	2025-12-11 17:22:59.090332+00	\N	45	f	\N	\N	t	\N	\N	t	\N	\N	\N
321426eb-b19e-42c2-b644-06b5b8955f96	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	service	\N	\N	\N	Labour (After Hours)	\N	2025-12-11 17:26:56.988363+00	\N	135	f	\N	\N	t	\N	\N	t	\N	\N	\N
a082b8a4-e21a-4a30-9981-f414907beefb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	\N	\N	Compressor	\N	2025-12-11 17:35:38.60192+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6e8de89e-400f-455f-ae3b-02df93649238	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	\N	\N	Equipment/Supply	\N	2025-12-11 17:35:58.40303+00	\N	135	f	\N	\N	t	\N	\N	t	\N	\N	\N
333c46b8-0bbe-435a-a9e9-49e82c8670ce	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	\N	\N	Filter Drier	\N	2025-12-11 17:36:14.094806+00	\N	65	f	\N	\N	t	\N	\N	t	\N	\N	\N
82fda6b6-514b-47ab-b89b-9e816df8eea8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	\N	\N	Refrigerant	\N	2025-12-11 17:36:35.574818+00	\N	50	f	\N	\N	t	\N	\N	t	\N	\N	\N
1fd0b54e-df38-4068-870f-d4dfcb037a84	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x20x1	P Filter 14x20x1	\N	2025-11-13 02:02:24.16508+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
46ca8a6d-4d4a-4a8f-ad73-6aa15ab03000	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x20x2	P Filter 14x20x2	\N	2025-11-13 02:02:24.237479+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1edd2514-6a27-4581-9d0b-6b000cb8f91d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x24x1	P Filter 14x24x1	\N	2025-11-13 02:02:24.308067+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9814d8f8-ef7c-45ab-813f-f049c3e69f51	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x24x2	P Filter 14x24x2	\N	2025-11-13 02:02:24.379075+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ebc13ac6-fd51-4a10-939a-10e20cae209a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x25x1	P Filter 14x25x1	\N	2025-11-13 02:02:24.450433+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fe36bf84-3c84-4dc7-85df-313653f69dfc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	14x25x2	P Filter 14x25x2	\N	2025-11-13 02:02:24.52132+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
163d09e4-e9c8-43b7-9e50-74510790b55b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	15x20x1	P Filter 15x20x1	\N	2025-11-13 02:02:24.593259+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1ff38ccf-da9c-49f7-84ef-e7620f790460	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	15x20x2	P Filter 15x20x2	\N	2025-11-13 02:02:24.666038+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2b2371e5-e065-49e5-a298-3d7b79317ac6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x16x1	P Filter 16x16x1	\N	2025-11-13 02:02:24.736208+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fe9a669e-4c24-47bf-9c44-c16d626df909	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x16x2	P Filter 16x16x2	\N	2025-11-13 02:02:24.805855+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
17fe4e93-1c6d-46a6-80b8-199ce103062d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x20x1	P Filter 16x20x1	\N	2025-11-13 02:02:24.897442+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a667364b-55af-4bb0-9e80-8e35bded0c30	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x20x2	P Filter 16x20x2	\N	2025-11-13 02:02:24.968499+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f1d2d9e4-9063-4e99-b719-c5cfd7969588	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x24x1	P Filter 16x24x1	\N	2025-11-13 02:02:25.040129+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b7ed22a4-a765-4ee3-b3ca-280e73174330	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x24x2	P Filter 16x24x2	\N	2025-11-13 02:02:25.112052+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fc79fd1a-5504-4b81-a460-548627d93866	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x25x1	P Filter 16x25x1	\N	2025-11-13 02:02:25.183046+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dc2b5acf-cc66-449b-93e9-4c69c48b34c5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x25x2	P Filter 16x25x2	\N	2025-11-13 02:02:25.254476+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6f41794a-0fa3-48a1-8b8f-ae88716fe4fe	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x30x1	P Filter 16x30x1	\N	2025-11-13 02:02:25.325713+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eca3d4c8-31d5-49a4-922e-41a25848615c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	16x30x2	P Filter 16x30x2	\N	2025-11-13 02:02:25.396517+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
87b7d77c-fd33-4fac-b8a7-44de481dfb8c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x18x1	P Filter 18x18x1	\N	2025-11-13 02:02:25.468226+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
860b8055-630c-4663-8a9d-593c62ffa7c1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x18x2	P Filter 18x18x2	\N	2025-11-13 02:02:25.539308+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
749f14cc-2129-4ab0-b4d3-e00125d75834	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x24x1	P Filter 18x24x1	\N	2025-11-13 02:02:25.609069+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
10bb89dd-ff7d-43ec-8a46-cf5c4da483aa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x24x2	P Filter 18x24x2	\N	2025-11-13 02:02:25.684134+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e8077fc1-acde-4445-93fd-7ad1fa254708	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x25x1	P Filter 18x25x1	\N	2025-11-13 02:02:25.756066+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
75d382b9-4689-486d-83af-7851cfb18b1f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	18x25x2	P Filter 18x25x2	\N	2025-11-13 02:02:25.826811+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d567e591-d37e-4faa-af2b-464c5dc6321e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x20x1	P Filter 20x20x1	\N	2025-11-13 02:02:25.898527+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a74b0bd1-5666-4be0-819d-d5d0407624d7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x20x2	P Filter 20x20x2	\N	2025-11-13 02:02:25.969733+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
11bfd1f8-ae9e-4a00-ad33-f11139bb24bb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x24x1	P Filter 20x24x1	\N	2025-11-13 02:02:26.040873+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5a6a2603-3138-4c7d-aee3-791cdaf6f568	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x24x2	P Filter 20x24x2	\N	2025-11-13 02:02:26.11213+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1befca0d-e752-4af7-9c96-f4f722d65aff	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x25x1	P Filter 20x25x1	\N	2025-11-13 02:02:26.184227+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ebb580ca-8b49-42a3-9511-ea27317709ba	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x25x2	P Filter 20x25x2	\N	2025-11-13 02:02:26.254526+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f45a7184-6f70-4dfb-b337-42b44adb3d62	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x30x1	P Filter 20x30x1	\N	2025-11-13 02:02:26.326299+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e25db10d-2abe-4643-a1e7-a2fc72bc9d95	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x30x2	P Filter 20x30x2	\N	2025-11-13 02:02:26.39723+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2358c5a3-e674-44e2-b0d2-43575462cf05	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	24x24x1	P Filter 24x24x1	\N	2025-11-13 02:02:26.468101+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d163ffe0-f5a1-479e-a2f2-262f072f9238	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	24x24x2	P Filter 24x24x2	\N	2025-11-13 02:02:26.540259+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
009cac11-1a6c-4090-9576-9aae07e6fcf7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	24x30x1	P Filter 24x30x1	\N	2025-11-13 02:02:26.611754+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8f923b17-e98b-49f6-bda6-4900ba055300	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	24x30x2	P Filter 24x30x2	\N	2025-11-13 02:02:26.684216+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8d9d386c-72db-4a4e-a256-33a9fe25b36b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	25x25x1	P Filter 25x25x1	\N	2025-11-13 02:02:26.757098+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f9c0004b-9159-4231-ade6-c36ff6156a41	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	25x25x2	P Filter 25x25x2	\N	2025-11-13 02:02:26.829741+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
11a5ca64-2ee4-4347-a190-319f4f21253c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	10x10x1	T Filter 10x10x1	\N	2025-11-13 02:02:26.900047+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
16ea949e-ccc6-4b22-8d54-9f8224392c2f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	10x10x2	T Filter 10x10x2	\N	2025-11-13 02:02:26.971057+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
08c7c36c-0be4-477e-b945-25135b15e2f0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	10x20x1	T Filter 10x20x1	\N	2025-11-13 02:02:27.04172+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a3c4bf36-55e8-43a3-902a-8a02e2598792	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	10x20x2	T Filter 10x20x2	\N	2025-11-13 02:02:27.112554+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a7694d84-3fa3-4a3b-9d00-2aa0938b747c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	12x12x1	T Filter 12x12x1	\N	2025-11-13 02:02:27.184085+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5eb43eb7-ea26-4831-b826-981eb3ffb142	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	12x12x2	T Filter 12x12x2	\N	2025-11-13 02:02:27.255323+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
76888adf-c04d-4aaf-93a3-d8b2bf328932	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	12x24x1	T Filter 12x24x1	\N	2025-11-13 02:02:27.327984+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
804577c9-358a-4b95-b228-b405c677f47a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	12x24x2	T Filter 12x24x2	\N	2025-11-13 02:02:27.399424+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
22c0f39c-52f1-4707-bdec-1ece0d7d0780	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x20x1	T Filter 14x20x1	\N	2025-11-13 02:02:27.47046+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b69d7866-f6a3-4855-8e0d-0c99a603aa04	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x20x2	T Filter 14x20x2	\N	2025-11-13 02:02:27.541527+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f3e7cc77-4982-416b-a4d7-7e535b4c6859	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x24x1	T Filter 14x24x1	\N	2025-11-13 02:02:27.614291+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
76fc6a21-5305-452d-a23f-83bd6f4182a0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x24x2	T Filter 14x24x2	\N	2025-11-13 02:02:27.685067+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
783ed780-28b7-4e19-b8a4-83a53c66e1e9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x25x1	T Filter 14x25x1	\N	2025-11-13 02:02:27.756117+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28816e87-d04c-432f-bd51-c92caa2785e4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	14x25x2	T Filter 14x25x2	\N	2025-11-13 02:02:27.827988+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
efe57e27-3a64-47bd-a2d7-365908d1aaa9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	15x20x1	T Filter 15x20x1	\N	2025-11-13 02:02:27.900167+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e5b8b36d-814b-4097-8b08-f32e29f74df7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	15x20x2	T Filter 15x20x2	\N	2025-11-13 02:02:27.970621+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1097600a-95db-479d-bf47-79359afd27eb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x16x1	T Filter 16x16x1	\N	2025-11-13 02:02:28.04166+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
17aa6e5d-726e-4355-b459-cd72dee36d5d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x16x2	T Filter 16x16x2	\N	2025-11-13 02:02:28.112505+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
16ed311d-1485-47a5-a9e8-90b352f93ae9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x20x1	T Filter 16x20x1	\N	2025-11-13 02:02:28.184299+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
37603559-135d-495e-9a70-e4dcc4301bcb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x20x2	T Filter 16x20x2	\N	2025-11-13 02:02:28.257873+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5a5e08d5-476d-4b14-a665-02d3040f95b6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x24x1	T Filter 16x24x1	\N	2025-11-13 02:02:28.328585+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
99277342-5867-4208-8f39-e25bd83ccd32	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x24x2	T Filter 16x24x2	\N	2025-11-13 02:02:28.398893+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8e4efc92-74b0-4ced-9364-8fcbd981dc7c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x25x1	T Filter 16x25x1	\N	2025-11-13 02:02:28.469579+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
58fa770b-2f4c-4c98-bf06-9055cd164b41	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x25x2	T Filter 16x25x2	\N	2025-11-13 02:02:28.539991+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
27904292-8353-4d6a-8799-1ef383bc96b5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x30x1	T Filter 16x30x1	\N	2025-11-13 02:02:28.610747+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
077369e6-d56d-4cf6-82e5-6db706df6f02	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	16x30x2	T Filter 16x30x2	\N	2025-11-13 02:02:28.682222+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ab611af9-b092-4629-9d1c-40a00df1cfef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x18x1	T Filter 18x18x1	\N	2025-11-13 02:02:28.753111+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
423ecb84-aa40-4d96-95e0-21bfeb102553	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x18x2	T Filter 18x18x2	\N	2025-11-13 02:02:28.824853+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
471e3e89-5522-425c-9cfa-db3adcf304d8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x24x1	T Filter 18x24x1	\N	2025-11-13 02:02:28.896029+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
60e16d0d-f129-4ed1-a277-b3a71a495299	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x24x2	T Filter 18x24x2	\N	2025-11-13 02:02:28.969312+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ba3ad619-5ae1-4b81-8ecd-ae42c33f0e2a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x25x1	T Filter 18x25x1	\N	2025-11-13 02:02:29.040941+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
96b523f7-b377-49a0-9616-9a9ea49d65f2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	18x25x2	T Filter 18x25x2	\N	2025-11-13 02:02:29.112407+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7a66b284-027e-46a5-b9c8-9d7a5ba5674b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x20x1	T Filter 20x20x1	\N	2025-11-13 02:02:29.184021+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c86fd779-9806-426a-9ac2-a2fedb62ee51	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x20x2	T Filter 20x20x2	\N	2025-11-13 02:02:29.254468+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a29fc848-4282-47da-8bf9-270bc82434a4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x24x1	T Filter 20x24x1	\N	2025-11-13 02:02:29.326111+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ffbeaa28-d6c7-4dfe-8ec7-ca5cf59651a4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x24x2	T Filter 20x24x2	\N	2025-11-13 02:02:29.397189+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f406a170-1678-4639-b966-35926516455a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x25x1	T Filter 20x25x1	\N	2025-11-13 02:02:29.468581+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4b1b12af-f57e-436a-aef4-359db0c49dde	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x25x2	T Filter 20x25x2	\N	2025-11-13 02:02:29.539486+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c0621e7d-bf40-444c-80ba-5c33533c32ef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x30x1	T Filter 20x30x1	\N	2025-11-13 02:02:29.608848+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4f065c3d-035a-49c4-b6ad-7e7bdd4ed65c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	20x30x2	T Filter 20x30x2	\N	2025-11-13 02:02:29.680186+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2f05ca0c-7ab7-4894-9d85-f6abc2e160a8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	24x24x1	T Filter 24x24x1	\N	2025-11-13 02:02:29.751658+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
76191aff-d8d3-4d08-935e-ecaf54b96f42	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	24x24x2	T Filter 24x24x2	\N	2025-11-13 02:02:29.822809+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4e7b9314-5fe1-45e5-97d0-ddb459a5ea99	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	24x30x1	T Filter 24x30x1	\N	2025-11-13 02:02:29.894072+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d8ed45e5-9569-4b08-9f8d-d3f7e06e726e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	24x30x2	T Filter 24x30x2	\N	2025-11-13 02:02:29.965692+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6a7804a5-2cb2-40ce-833e-a85e16e7c73d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	25x25x1	T Filter 25x25x1	\N	2025-11-13 02:02:30.036958+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8342a072-86ee-43ed-ba90-c053e345d16c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Throwaway	\N	25x25x2	T Filter 25x25x2	\N	2025-11-13 02:02:30.107954+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b251e510-7233-41cd-8d90-888fef459cd3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	10x10x1	M Filter 10x10x1	\N	2025-11-14 02:35:58.30516+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b93bea3b-09d7-4938-a5ea-0f35521c58dc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	10x10x2	M Filter 10x10x2	\N	2025-11-14 02:35:58.368704+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4e3d73d7-85c5-46d2-ab63-0daae3a99cbc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	10x20x1	M Filter 10x20x1	\N	2025-11-14 02:35:58.432521+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0031cac9-c509-496d-9467-54c115d10dfc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	10x20x2	M Filter 10x20x2	\N	2025-11-14 02:35:58.500379+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e29c1c6b-daf0-40dd-bbf3-bf8016628856	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	12x12x1	M Filter 12x12x1	\N	2025-11-14 02:35:58.564134+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eff100e2-a37a-4616-97a6-5851f735d4b7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	12x12x2	M Filter 12x12x2	\N	2025-11-14 02:35:58.627159+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
19c34410-cf04-4173-b79f-5a7a96da6e99	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	12x24x1	M Filter 12x24x1	\N	2025-11-14 02:35:58.691238+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
173d812a-37e0-4528-999b-aaeab19218ab	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	12x24x2	M Filter 12x24x2	\N	2025-11-14 02:35:58.754893+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
35caad30-5ea8-4c97-aeb7-ab80ed301690	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x20x1	M Filter 14x20x1	\N	2025-11-14 02:35:58.819217+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
83c5325f-5b66-4ccd-a7ac-54f6bb28efee	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x20x2	M Filter 14x20x2	\N	2025-11-14 02:35:58.88293+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7cf546be-540d-4aec-8235-457b6e7d2255	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x24x1	M Filter 14x24x1	\N	2025-11-14 02:35:58.946019+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b071aa43-ee04-462c-b72f-257852dc9f55	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x24x2	M Filter 14x24x2	\N	2025-11-14 02:35:59.00935+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bbb078e4-7310-4bbf-a939-fd575af65acc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x25x1	M Filter 14x25x1	\N	2025-11-14 02:35:59.072422+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c9e00e80-64b0-4e14-81ad-24dc7f84c199	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	14x25x2	M Filter 14x25x2	\N	2025-11-14 02:35:59.135659+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7ba35113-fe9c-4b47-98a6-4b2996b4c417	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	15x20x1	M Filter 15x20x1	\N	2025-11-14 02:35:59.202458+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cfc4f4d3-118a-420a-a1a4-0d397e3c0540	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	15x20x2	M Filter 15x20x2	\N	2025-11-14 02:35:59.284083+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
93796c35-7017-42ab-8848-51c13bd3086b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x16x1	M Filter 16x16x1	\N	2025-11-14 02:35:59.347937+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
756066fe-2bf8-4a2b-b606-75dd5d1e6667	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x16x2	M Filter 16x16x2	\N	2025-11-14 02:35:59.411459+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f088731d-d8c8-4fed-8296-f3374a05ed71	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x20x1	M Filter 16x20x1	\N	2025-11-14 02:35:59.475135+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
622a94a6-07b8-48b3-b5a7-dde1e15f149c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x20x2	M Filter 16x20x2	\N	2025-11-14 02:35:59.538216+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ae894115-8d94-4ac7-9d04-fd3171e29b38	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x24x1	M Filter 16x24x1	\N	2025-11-14 02:35:59.606056+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dac7e3e6-fdf9-40d6-8e5e-cbfe3c2f43b0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x24x2	M Filter 16x24x2	\N	2025-11-14 02:35:59.671874+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d53f43e8-4eee-4f3c-9bb0-38185ea70635	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x25x1	M Filter 16x25x1	\N	2025-11-14 02:35:59.734873+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
34b2fc20-eb61-4892-9318-3369b334189d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x25x2	M Filter 16x25x2	\N	2025-11-14 02:35:59.797964+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
db918e0f-28cb-40c2-8d6a-2f3ca5ffd51d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x30x1	M Filter 16x30x1	\N	2025-11-14 02:35:59.861554+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3c8709c6-b8ef-4daf-a8f6-78a82ead075b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	16x30x2	M Filter 16x30x2	\N	2025-11-14 02:35:59.92483+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7fac285c-b46a-4682-9b60-3f0039053715	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x18x1	M Filter 18x18x1	\N	2025-11-14 02:35:59.988504+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cc2acb2f-0ba9-468a-a08c-19347b28059a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x18x2	M Filter 18x18x2	\N	2025-11-14 02:36:00.055086+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b250215e-f2ed-4a71-be3d-56ac96e37460	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x24x1	M Filter 18x24x1	\N	2025-11-14 02:36:00.118327+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3f7965f6-c34a-4a5c-a813-bd1b1e0d61d3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x24x2	M Filter 18x24x2	\N	2025-11-14 02:36:00.181988+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b01891ec-322d-4032-8eaf-5471a0e44c1c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x25x1	M Filter 18x25x1	\N	2025-11-14 02:36:00.245313+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
deb4c55d-d4dd-40c6-a627-e583019336f5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	18x25x2	M Filter 18x25x2	\N	2025-11-14 02:36:00.310594+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2f5e617a-9fe2-424c-beb0-b38867a5b0ed	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x20x1	M Filter 20x20x1	\N	2025-11-14 02:36:00.374676+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a5e37265-8788-4244-9774-3706cab0623d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x20x2	M Filter 20x20x2	\N	2025-11-14 02:36:00.437317+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cb12f9de-ec8b-4c7c-b22c-a3b9e5a85da4	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x24x1	M Filter 20x24x1	\N	2025-11-14 02:36:00.5002+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
27e89eec-bc70-4d9f-843e-0cf4f64f5fc1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x24x2	M Filter 20x24x2	\N	2025-11-14 02:36:00.5629+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
528704ae-1507-472f-b07f-9d8edebd2425	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x25x1	M Filter 20x25x1	\N	2025-11-14 02:36:00.626632+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0ba3d2de-cd03-4ec1-83f7-bd287a2e4529	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x25x2	M Filter 20x25x2	\N	2025-11-14 02:36:00.690056+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c542cfd6-82a2-46ca-9875-b3bc7e8f3aef	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x30x1	M Filter 20x30x1	\N	2025-11-14 02:36:00.753795+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9d69b219-a7c0-4d29-af05-ed99f403fcaf	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	20x30x2	M Filter 20x30x2	\N	2025-11-14 02:36:00.816724+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fc5c84d6-e434-4ffc-95b0-64463717cd0a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	24x24x1	M Filter 24x24x1	\N	2025-11-14 02:36:00.878689+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
49bb05a5-87b6-43f8-9b6c-3603dbe29e07	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	24x24x2	M Filter 24x24x2	\N	2025-11-14 02:36:00.940661+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
870ea51f-0ea8-4bdb-b194-13ae8b987bd3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	24x30x1	M Filter 24x30x1	\N	2025-11-14 02:36:01.003345+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8792b572-62f6-42f6-9fe5-ac6c8b83c5bc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	24x30x2	M Filter 24x30x2	\N	2025-11-14 02:36:01.066215+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b049c53d-07ef-44ab-ab3c-4f7bd3112e42	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	25x25x1	M Filter 25x25x1	\N	2025-11-14 02:36:01.130197+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7e1e8c52-bf38-4b41-8302-a2b01912f717	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Media	\N	25x25x2	M Filter 25x25x2	\N	2025-11-14 02:36:01.193288+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fddc3510-f8d0-4242-bc79-b3e21baef034	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	10x10x1	P Filter 10x10x1	\N	2025-11-14 02:36:01.257428+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e9133fa6-5bd6-4d1e-8b99-e6f9a60fc0c8	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	10x10x2	P Filter 10x10x2	\N	2025-11-14 02:36:01.320722+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
54cd4424-57de-4010-bf67-8a9494d265d9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	10x20x1	P Filter 10x20x1	\N	2025-11-14 02:36:01.384044+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8659aa46-a73a-452c-85a9-e30275f2eaa2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	10x20x2	P Filter 10x20x2	\N	2025-11-14 02:36:01.447294+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eab49c3e-b06d-4bb0-a019-6a05c6882c98	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	12x12x1	P Filter 12x12x1	\N	2025-11-14 02:36:01.511272+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1da0cbd0-02fc-432c-a5ec-ced252f30149	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	12x12x2	P Filter 12x12x2	\N	2025-11-14 02:36:01.575897+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
79e4e980-8fa1-4c59-b81d-78ee85d9340d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	12x24x1	P Filter 12x24x1	\N	2025-11-14 02:36:01.6416+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
27b6f746-26b3-43ec-9869-42c20159c0ed	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	12x24x2	P Filter 12x24x2	\N	2025-11-14 02:36:01.704581+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a31dcdce-e501-46fc-93e7-a20d355f5303	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x20x1	P Filter 14x20x1	\N	2025-11-14 02:36:01.767813+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e32fec5d-d14f-47a4-b87d-7353f496492f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x20x2	P Filter 14x20x2	\N	2025-11-14 02:36:01.831545+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b90a531b-f129-4c3c-9e11-4a7e976ddba6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x24x1	P Filter 14x24x1	\N	2025-11-14 02:36:01.89511+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c8f6220b-fa78-4970-bef3-8d051b603162	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x24x2	P Filter 14x24x2	\N	2025-11-14 02:36:01.958942+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f1a14af1-0c32-44e8-a078-e0ab206aaa17	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x25x1	P Filter 14x25x1	\N	2025-11-14 02:36:02.022294+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3adc9e13-a57d-4afd-ad84-989e6bca29ee	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	14x25x2	P Filter 14x25x2	\N	2025-11-14 02:36:02.085881+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
52ffb5b8-e0a7-4bc7-9f76-b0fc8502e9f7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	15x20x1	P Filter 15x20x1	\N	2025-11-14 02:36:02.149146+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eb34aa51-693d-4dae-8552-cfab9791090f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	15x20x2	P Filter 15x20x2	\N	2025-11-14 02:36:02.211914+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f16f5ac4-5564-480b-9fc8-172d41ca77c1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x16x1	P Filter 16x16x1	\N	2025-11-14 02:36:02.275778+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6dcd9d62-fa0d-47dc-bea9-cc6ddb315921	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x16x2	P Filter 16x16x2	\N	2025-11-14 02:36:02.339937+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ae388fae-9f99-43ab-8dd3-7eba7b8b1810	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x20x1	P Filter 16x20x1	\N	2025-11-14 02:36:02.404533+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fff53965-c24b-47e5-8c96-eb1178c61f5d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x20x2	P Filter 16x20x2	\N	2025-11-14 02:36:02.467622+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9e816c73-6e00-468a-8a7c-6420af86064c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x24x1	P Filter 16x24x1	\N	2025-11-14 02:36:02.532519+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2a103136-6e68-4a0d-8df1-44c4b2e1a382	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x24x2	P Filter 16x24x2	\N	2025-11-14 02:36:02.595468+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
574b4988-503e-4b2b-b8e1-52bd1c97986e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x25x1	P Filter 16x25x1	\N	2025-11-14 02:36:02.658755+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6bb61791-cc21-48be-a76f-2365c83ae11a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x25x2	P Filter 16x25x2	\N	2025-11-14 02:36:02.722201+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
976eb252-0047-42f2-b5d4-79e5234c3196	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x30x1	P Filter 16x30x1	\N	2025-11-14 02:36:02.785663+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cd2512f8-8f9e-445e-a8a2-03ef4b5f1bbe	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	16x30x2	P Filter 16x30x2	\N	2025-11-14 02:36:02.848671+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a301ee93-db8e-4b9a-843b-270efd7257d7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x18x1	P Filter 18x18x1	\N	2025-11-14 02:36:02.911923+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
986a6fc9-405b-4863-8f69-459e86f67ef2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x18x2	P Filter 18x18x2	\N	2025-11-14 02:36:02.97381+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3c586dfd-e2ba-4524-924a-262c409ad7d2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x24x1	P Filter 18x24x1	\N	2025-11-14 02:36:03.041019+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f20f6b12-df06-40ae-8d56-39d451b24bae	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x24x2	P Filter 18x24x2	\N	2025-11-14 02:36:03.10491+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
96f88bc8-5d83-4f85-8561-2ad8ab560732	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x25x1	P Filter 18x25x1	\N	2025-11-14 02:36:03.169008+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4aac95ce-093d-4f09-a030-ba5196b3149e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	18x25x2	P Filter 18x25x2	\N	2025-11-14 02:36:03.231788+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f80ea2e8-908e-4fb2-bb38-40a7a42d8e07	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x20x1	P Filter 20x20x1	\N	2025-11-14 02:36:03.294401+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6e23ba06-255c-493f-9025-955b58d6c6b5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x20x2	P Filter 20x20x2	\N	2025-11-14 02:36:03.357596+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8660aed7-55f8-49c8-8a86-143b68e49ee0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x24x1	P Filter 20x24x1	\N	2025-11-14 02:36:03.420304+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c6fb3eeb-e105-46d9-b083-068f04c4e162	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x24x2	P Filter 20x24x2	\N	2025-11-14 02:36:03.483063+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
71437d03-b4b2-4a8d-a628-fba0ac3ea4df	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x25x1	P Filter 20x25x1	\N	2025-11-14 02:36:03.54516+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1610411a-75ad-4609-9313-3225b650eadc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x25x2	P Filter 20x25x2	\N	2025-11-14 02:36:03.608175+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dc505739-7574-4dd5-9e71-0924fddb467b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x30x1	P Filter 20x30x1	\N	2025-11-14 02:36:03.670004+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5294109b-ec41-4381-883f-c464b06f532a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	20x30x2	P Filter 20x30x2	\N	2025-11-14 02:36:03.736945+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
10391252-bb67-4c20-8b2c-2d4148a64233	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	24x24x1	P Filter 24x24x1	\N	2025-11-14 02:36:03.800756+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
902f64ac-2f52-43a5-af14-9b464a14d50c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	24x24x2	P Filter 24x24x2	\N	2025-11-14 02:36:03.863691+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b721e997-abec-4815-a2dc-3ea6fdd34ba2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	24x30x1	P Filter 24x30x1	\N	2025-11-14 02:36:03.926595+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
757b8daf-46c0-4c18-8d3b-9caa4338aff1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	24x30x2	P Filter 24x30x2	\N	2025-11-14 02:36:03.990447+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
681ecd2e-e277-4081-8e75-e93194e68af6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	25x25x1	P Filter 25x25x1	\N	2025-11-14 02:36:04.054595+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
47abd959-0a85-40b8-a3c7-675f3bd2f11c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Pleated	\N	25x25x2	P Filter 25x25x2	\N	2025-11-14 02:36:04.120038+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
23b97dec-2c5c-4428-baba-537c46098845	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	10x10x1	T Filter 10x10x1	\N	2025-11-14 02:36:04.183641+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
65a3c15b-6eec-4fcf-b173-3c4e25dd7aff	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	10x10x2	T Filter 10x10x2	\N	2025-11-14 02:36:04.246608+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
09c26163-0c2a-424c-8470-a26e13422e48	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	10x20x1	T Filter 10x20x1	\N	2025-11-14 02:36:04.308673+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
de441de0-eefe-4553-9bca-7fc55619239e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	10x20x2	T Filter 10x20x2	\N	2025-11-14 02:36:04.370691+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8df63cc6-1fdf-4823-9eb7-14518eb1cf4f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	12x12x1	T Filter 12x12x1	\N	2025-11-14 02:36:04.434067+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
923173ec-0d05-45f6-b4ab-3c9e52842b80	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	12x12x2	T Filter 12x12x2	\N	2025-11-14 02:36:04.495691+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4f8bf232-26f6-4b58-82d1-8cb03ca08eea	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	12x24x1	T Filter 12x24x1	\N	2025-11-14 02:36:04.562125+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cc784464-a008-42f5-907c-f016fee9c31c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	12x24x2	T Filter 12x24x2	\N	2025-11-14 02:36:04.624806+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
68242a47-d2f9-4cd5-b3e2-c492e684dc87	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x20x1	T Filter 14x20x1	\N	2025-11-14 02:36:04.687819+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1e0ba8a7-4ce3-4954-946e-cf803fd473d1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x20x2	T Filter 14x20x2	\N	2025-11-14 02:36:04.751525+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3d979ce6-e753-49a1-990a-1dbe40f4b378	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x24x1	T Filter 14x24x1	\N	2025-11-14 02:36:04.814616+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7f8a318f-4f88-41c6-99fe-0e7e04466c38	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x24x2	T Filter 14x24x2	\N	2025-11-14 02:36:04.878177+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
431de095-4789-4b00-b3d7-289a37700347	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x25x1	T Filter 14x25x1	\N	2025-11-14 02:36:04.941574+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2b9891aa-8ddf-430f-8618-b67d8b033c50	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	14x25x2	T Filter 14x25x2	\N	2025-11-14 02:36:05.004739+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eb5b87ab-0be4-41ef-9d96-85670232d5f8	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	15x20x1	T Filter 15x20x1	\N	2025-11-14 02:36:05.071182+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4d05e655-5b54-4ad8-aaaa-5d8cca546047	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	15x20x2	T Filter 15x20x2	\N	2025-11-14 02:36:05.134827+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
63bea81f-2da0-4260-80d4-72a2d73a7997	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x16x1	T Filter 16x16x1	\N	2025-11-14 02:36:05.201792+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
08da42b8-baaa-450e-9e25-24b37bd0220f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x16x2	T Filter 16x16x2	\N	2025-11-14 02:36:05.263656+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dd292411-dc55-4726-88f7-a4b30c7f5fa6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x20x1	T Filter 16x20x1	\N	2025-11-14 02:36:05.325676+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6383172f-392a-4ffe-b007-ce4897c61548	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x20x2	T Filter 16x20x2	\N	2025-11-14 02:36:05.388808+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4280257e-6895-4b8e-88cd-b261b8ea2ad2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x24x1	T Filter 16x24x1	\N	2025-11-14 02:36:05.451726+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
96c963a7-fa07-4897-aecc-010c18fad615	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x24x2	T Filter 16x24x2	\N	2025-11-14 02:36:05.514352+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1515c94c-bbc7-43d8-b37d-d45ef9acacb3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x25x1	T Filter 16x25x1	\N	2025-11-14 02:36:05.576126+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cb92f8a4-2ad8-4ed5-a60f-57c234c88d7a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x25x2	T Filter 16x25x2	\N	2025-11-14 02:36:05.638782+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
017ce0f4-f781-4667-96aa-e91cb159f29b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x30x1	T Filter 16x30x1	\N	2025-11-14 02:36:05.702325+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
34b879ee-e58a-47c0-a30c-6be31e931a47	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	16x30x2	T Filter 16x30x2	\N	2025-11-14 02:36:05.76523+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
885eff5f-03fc-4766-8657-af698bcfc9b5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x18x1	T Filter 18x18x1	\N	2025-11-14 02:36:05.826651+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d7269cc1-b1df-4df6-b5f0-880df59bb19f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x18x2	T Filter 18x18x2	\N	2025-11-14 02:36:05.889411+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9b403479-4475-4ea5-bb2c-bd33e7ef2ab1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x24x1	T Filter 18x24x1	\N	2025-11-14 02:36:05.952263+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cee3e461-8bda-4f62-8e81-660608bddee7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x24x2	T Filter 18x24x2	\N	2025-11-14 02:36:06.013623+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b06135c3-b45f-4fe7-a34e-41d07252e290	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x25x1	T Filter 18x25x1	\N	2025-11-14 02:36:06.076252+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c3cd167e-9fe8-4179-aba1-d52e0aa42ed4	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	18x25x2	T Filter 18x25x2	\N	2025-11-14 02:36:06.138624+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3c1178d6-289b-4c52-9625-cc38b4def4ff	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x20x1	T Filter 20x20x1	\N	2025-11-14 02:36:06.201402+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
11b58990-78f6-4f19-9011-934bbc8f0ea7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x20x2	T Filter 20x20x2	\N	2025-11-14 02:36:06.26409+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0505a7bb-9606-4be3-a853-76549e537d26	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x24x1	T Filter 20x24x1	\N	2025-11-14 02:36:06.326815+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cfe4ec28-13fc-4a96-8cb4-ed9115c51cdb	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x24x2	T Filter 20x24x2	\N	2025-11-14 02:36:06.389909+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
996b9f92-52a7-4ecd-b45d-7623e969f4d9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x25x1	T Filter 20x25x1	\N	2025-11-14 02:36:06.453198+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
440903c5-8e04-45fd-8ff6-ac15936e0f58	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x25x2	T Filter 20x25x2	\N	2025-11-14 02:36:06.515139+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b4c47848-d510-4f56-90b9-14aa0ba37858	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x30x1	T Filter 20x30x1	\N	2025-11-14 02:36:06.578006+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3cb7613f-873d-4140-a111-b1d21d64a684	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	20x30x2	T Filter 20x30x2	\N	2025-11-14 02:36:06.640911+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
88c5cbc3-6632-46dc-a67a-a351bf4e63af	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	24x24x1	T Filter 24x24x1	\N	2025-11-14 02:36:06.706827+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1ced1b31-2bd8-454b-b044-aa2119ce2356	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	24x24x2	T Filter 24x24x2	\N	2025-11-14 02:36:06.769655+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f8fe0e86-5d69-4af8-9aea-1199295fc53b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	24x30x1	T Filter 24x30x1	\N	2025-11-14 02:36:06.833596+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1156da25-deca-4fc0-b8b1-18ddcade8a81	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	24x30x2	T Filter 24x30x2	\N	2025-11-14 02:36:06.897125+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a06f8a73-3e9b-4abb-8dc0-fd425fd8f4ca	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	25x25x1	T Filter 25x25x1	\N	2025-11-14 02:36:06.960408+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5c24c030-05ca-4dd7-b9db-cca30ffee7ce	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	Throwaway	\N	25x25x2	T Filter 25x25x2	\N	2025-11-14 02:36:07.023104+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28ef2fa0-f202-4912-84d3-c8a658d7e246	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	25x25x1	M Filter 25x25x1	\N	2025-11-14 03:12:34.32151+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
19fae781-c4be-42ec-8ae8-8b1b24dc46b0	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	25x25x2	M Filter 25x25x2	\N	2025-11-14 03:12:34.388653+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5b689fab-f34e-4523-b721-4cd7852cebfc	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	10x10x1	P Filter 10x10x1	\N	2025-11-14 03:12:34.459551+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
322ee972-9ab6-414b-ab28-643c93480254	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	10x10x2	P Filter 10x10x2	\N	2025-11-14 03:12:34.524942+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8b035295-f214-4034-9cce-4899b3ad6bec	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	10x20x1	P Filter 10x20x1	\N	2025-11-14 03:12:34.591396+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0dfce71a-ba65-409e-8403-93abd90ff4d7	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	10x20x2	P Filter 10x20x2	\N	2025-11-14 03:12:34.65804+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d71a70ec-323a-498f-8eb5-0626cebd7564	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	12x12x1	P Filter 12x12x1	\N	2025-11-14 03:12:34.72457+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
390b4102-6e39-4392-aa2d-bd58ec949bf0	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	12x12x2	P Filter 12x12x2	\N	2025-11-14 03:12:34.790708+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e73d8cc9-18a7-4d51-b6a9-58c60869706e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	12x24x1	P Filter 12x24x1	\N	2025-11-14 03:12:34.856927+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0e0b7fff-0f19-45bf-945c-045cc6c67a24	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	12x24x2	P Filter 12x24x2	\N	2025-11-14 03:12:34.923239+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6767e54c-4085-45c5-a4c8-d7d868be80c3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x20x1	P Filter 14x20x1	\N	2025-11-14 03:12:34.98896+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ef13ec8c-9bfb-4d9c-93d2-36bfc9bddc5a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x20x2	P Filter 14x20x2	\N	2025-11-14 03:12:35.061463+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f75bd96e-186d-4fa4-b584-fbb100ce159a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x24x1	P Filter 14x24x1	\N	2025-11-14 03:12:35.126974+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e6529216-2eaf-4fb8-b9a2-1aa9b54a7169	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x24x2	P Filter 14x24x2	\N	2025-11-14 03:12:35.193451+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9ce52ab5-c1bf-4870-826c-558e9dbc91bf	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x25x1	P Filter 14x25x1	\N	2025-11-14 03:12:35.259927+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4cb188be-0769-4d03-a098-96e5ad142e5c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	14x25x2	P Filter 14x25x2	\N	2025-11-14 03:12:35.327517+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
519c531d-96e5-453c-bebb-0749ba89b64e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	15x20x1	P Filter 15x20x1	\N	2025-11-14 03:12:35.394264+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8e62c625-3937-48c6-8927-29cd7a1d1222	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	15x20x2	P Filter 15x20x2	\N	2025-11-14 03:12:35.460871+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28962b89-ea7d-410a-a6b6-b59dce2bf1ee	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x16x1	P Filter 16x16x1	\N	2025-11-14 03:12:35.527532+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e3fd9a53-29ba-4c6a-8fcb-f5f03b1551de	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x16x2	P Filter 16x16x2	\N	2025-11-14 03:12:35.593939+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a296736b-9be5-4234-a196-ea65f25515f9	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x20x1	P Filter 16x20x1	\N	2025-11-14 03:12:35.660221+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dae7883d-149c-4589-8518-c7646ef0cd7a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	10x10x1	M Filter 10x10x1	\N	2025-11-14 03:12:31.346421+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
641a6ee6-d420-40f6-a020-b2e05cf9bc67	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	10x10x2	M Filter 10x10x2	\N	2025-11-14 03:12:31.422317+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
12e8bd04-5374-4866-a3cc-c890356e428b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	10x20x1	M Filter 10x20x1	\N	2025-11-14 03:12:31.490959+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a68464f3-5a52-4bde-8522-9e4299bef6b5	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	10x20x2	M Filter 10x20x2	\N	2025-11-14 03:12:31.558796+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
456e9aba-6048-4150-9dc5-5a2d2110282e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	12x12x1	M Filter 12x12x1	\N	2025-11-14 03:12:31.630281+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e29c64c5-9bd4-4d3a-9f76-931a00d18d46	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	12x12x2	M Filter 12x12x2	\N	2025-11-14 03:12:31.698991+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ab2ad12f-32f1-4763-ac50-1e4edf879d1b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	12x24x1	M Filter 12x24x1	\N	2025-11-14 03:12:31.765382+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
09f62976-4ccd-441e-8a7d-a1856e1887b1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	12x24x2	M Filter 12x24x2	\N	2025-11-14 03:12:31.833633+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
59668593-1adb-4fe9-8854-b2b1427ee9e6	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x20x1	M Filter 14x20x1	\N	2025-11-14 03:12:31.900855+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5ee9abd4-176d-453f-b91a-648022577d4f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x20x2	M Filter 14x20x2	\N	2025-11-14 03:12:31.96768+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
986ce3a6-54b3-4e86-a8e9-db7264215083	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x24x1	M Filter 14x24x1	\N	2025-11-14 03:12:32.034097+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b08a5528-86e8-4c54-83bd-597996975b16	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x24x2	M Filter 14x24x2	\N	2025-11-14 03:12:32.100285+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
59aab0cd-c4bc-42b5-9426-4d5634b1d5e6	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x25x1	M Filter 14x25x1	\N	2025-11-14 03:12:32.166919+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2dca9fc1-42cd-480d-9d19-d951b86695a1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	14x25x2	M Filter 14x25x2	\N	2025-11-14 03:12:32.23339+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e7efd2b8-fdc5-46e4-b7b0-f68a1e59435d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	15x20x1	M Filter 15x20x1	\N	2025-11-14 03:12:32.301546+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1b7d2dcf-41a6-4e74-ae85-ec71e5606bfc	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	15x20x2	M Filter 15x20x2	\N	2025-11-14 03:12:32.371792+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
978cf92c-857a-489b-bf1d-b5a4798eeafb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x16x1	M Filter 16x16x1	\N	2025-11-14 03:12:32.438614+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
235bf92f-bd45-41f2-8883-979a65660b58	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x16x2	M Filter 16x16x2	\N	2025-11-14 03:12:32.50372+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
39e0c40a-f0c0-427b-9b8e-001bdab0eade	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x20x1	M Filter 16x20x1	\N	2025-11-14 03:12:32.570514+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
89fcefaa-4aa3-48e3-80e5-e9d8dfbb956c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x20x2	M Filter 16x20x2	\N	2025-11-14 03:12:32.637781+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7fe52084-ea7f-437a-a781-c2cf921bd631	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x24x1	M Filter 16x24x1	\N	2025-11-14 03:12:32.707762+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7638f2db-d2a7-458e-aeff-5dc5dda9dd86	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x24x2	M Filter 16x24x2	\N	2025-11-14 03:12:32.775497+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3f361fac-560b-4383-aca7-bf3e0fcfa75d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x25x1	M Filter 16x25x1	\N	2025-11-14 03:12:32.84286+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ae484ec2-9b86-4d56-a164-7c4c02d56847	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x25x2	M Filter 16x25x2	\N	2025-11-14 03:12:32.909417+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c39e3f88-8a85-4269-9949-d5e6fad792ef	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x30x1	M Filter 16x30x1	\N	2025-11-14 03:12:32.976726+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c48f6409-2f17-4126-865b-1a7406efab53	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	16x30x2	M Filter 16x30x2	\N	2025-11-14 03:12:33.043494+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2736fb2d-2de4-4fd6-b996-c2ce6d5a8198	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x18x1	M Filter 18x18x1	\N	2025-11-14 03:12:33.110829+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
98e4010a-b132-4cba-9595-2a5ac71cd16b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x18x2	M Filter 18x18x2	\N	2025-11-14 03:12:33.177434+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ab3293a4-8661-4f3b-b984-52305443218c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x24x1	M Filter 18x24x1	\N	2025-11-14 03:12:33.244085+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
26de0099-7145-4d35-9c5b-105e026ef6bf	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x24x2	M Filter 18x24x2	\N	2025-11-14 03:12:33.310622+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
da18c952-82fd-41ec-b91b-94b453d0ba0b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x25x1	M Filter 18x25x1	\N	2025-11-14 03:12:33.377847+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
38299c35-86ec-490d-ace7-7d700f225176	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	18x25x2	M Filter 18x25x2	\N	2025-11-14 03:12:33.443168+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6789b99d-b4b5-4abf-bd2e-2acd36e6e9c8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	18	Belt A18	\N	2025-11-13 02:02:30.178754+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fe8bd207-90b7-47e0-bb37-0d6ccce369ed	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	18	Belt B18	\N	2025-11-13 02:02:30.251183+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dfabb512-493f-421e-865b-55762ce59b1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	19	Belt A19	\N	2025-11-13 02:02:30.322336+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b5bee6f1-3393-4120-b001-eb897ed58a76	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	19	Belt B19	\N	2025-11-13 02:02:30.394534+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
08f6179c-f1ee-40c7-85aa-146a69959275	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	20	Belt A20	\N	2025-11-13 02:02:30.466595+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a7bc9bd4-7d45-41a1-b730-66c438eb0068	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	20	Belt B20	\N	2025-11-13 02:02:30.537877+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ee751c1f-43ad-4306-b888-c6f2be48d089	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	21	Belt A21	\N	2025-11-13 02:02:30.608677+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
04e84cd8-249f-4127-a7af-7a92cb83e136	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	21	Belt B21	\N	2025-11-13 02:02:30.679583+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
83bb34e7-99de-4ace-a2e3-34a5fcdd6bc2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	22	Belt A22	\N	2025-11-13 02:02:30.753399+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c3011e0b-5595-411c-8a5e-2b2cbb5764ec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	22	Belt B22	\N	2025-11-13 02:02:30.824473+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5c5406ed-e069-4564-aedb-d698abef3f11	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	23	Belt A23	\N	2025-11-13 02:02:30.895572+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7bb4a361-c5e9-4b92-98ae-b1613bd025e8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	23	Belt B23	\N	2025-11-13 02:02:30.9667+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
278dff0f-9189-4929-8fb7-3e9ec31972b3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	24	Belt A24	\N	2025-11-13 02:02:31.038926+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
60f8316f-8112-485a-8299-658db66d3a8b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	24	Belt B24	\N	2025-11-13 02:02:31.110443+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
626c6928-d8a1-4710-b34a-12c314f0ac6f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	25	Belt A25	\N	2025-11-13 02:02:31.181792+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c94c8a3f-9724-4acf-a914-a60ae89cfd16	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	25	Belt B25	\N	2025-11-13 02:02:31.25269+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e66836f4-34bc-44a7-93b2-f3d7fb950b5f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	26	Belt A26	\N	2025-11-13 02:02:31.324106+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7192c0f5-d966-4345-b587-d04f78908c94	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	26	Belt B26	\N	2025-11-13 02:02:31.39524+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8e483d34-a38d-4ef7-b829-19761ce44cdb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	27	Belt A27	\N	2025-11-13 02:02:31.465313+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
920fa6a5-58f1-4da1-a58e-ffd044271813	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	27	Belt B27	\N	2025-11-13 02:02:31.536783+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
56ca4973-84e7-42db-8866-e3f95a1fda42	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	28	Belt A28	\N	2025-11-13 02:02:31.607842+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e2e47cf1-8905-476e-9df0-fdf6c5c4cda0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	28	Belt B28	\N	2025-11-13 02:02:31.678523+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6f070730-01b5-4d59-808a-5d87d1a1bc85	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	29	Belt A29	\N	2025-11-13 02:02:31.749115+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
03329b2e-53fe-4d02-8133-6263da9206d4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	29	Belt B29	\N	2025-11-13 02:02:31.820307+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7cb40bf9-807a-4c7a-8312-c67a0322c795	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	30	Belt A30	\N	2025-11-13 02:02:31.892577+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
46f00891-760a-4ba8-9c6b-34f501c59197	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	30	Belt B30	\N	2025-11-13 02:02:31.963438+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
44e1a0e2-87b5-4d9e-8fd7-3895c1100da2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	31	Belt A31	\N	2025-11-13 02:02:32.035575+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
542fdca2-3b91-4483-a244-fa6ad1b3987a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	31	Belt B31	\N	2025-11-13 02:02:32.108281+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0ef16ecf-5ad7-45bd-b245-161ba662dba7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	32	Belt A32	\N	2025-11-13 02:02:32.179728+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
05b0581a-6d67-4323-81f0-ea5d50f53c1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	32	Belt B32	\N	2025-11-13 02:02:32.250584+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
05e33ed2-0bba-4cd4-8674-d531cf15f6f4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	33	Belt A33	\N	2025-11-13 02:02:32.32191+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0932f008-648c-47da-911e-3d616412715d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	33	Belt B33	\N	2025-11-13 02:02:32.393001+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e14c3d2a-ffd7-4894-adb7-e3f491ba008b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	34	Belt A34	\N	2025-11-13 02:02:32.468908+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
732d4ab2-ed86-4633-b7a2-fe26ab9b6a0f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	34	Belt B34	\N	2025-11-13 02:02:32.541691+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d4f74f76-a1cc-460e-b7e9-914e4e83bc42	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	35	Belt A35	\N	2025-11-13 02:02:32.612289+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
75dd96f7-670b-481f-9b50-f1b2f026964d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	35	Belt B35	\N	2025-11-13 02:02:32.683868+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
09425e3f-1326-414f-a906-028c60dc3854	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	36	Belt A36	\N	2025-11-13 02:02:32.754649+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9c0cc80f-63cc-42a9-b2d7-478b127c2573	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	36	Belt B36	\N	2025-11-13 02:02:32.825377+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3725e3f8-65e1-4cb2-a253-616a351bd41c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	37	Belt A37	\N	2025-11-13 02:02:32.896581+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28177117-e857-4b44-808c-1b57dfa04eaa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	37	Belt B37	\N	2025-11-13 02:02:32.967714+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1619536f-4247-456e-be6d-15810afaf234	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	38	Belt A38	\N	2025-11-13 02:02:33.038513+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
530b5a51-c245-4925-8824-29ad38b552fd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	38	Belt B38	\N	2025-11-13 02:02:33.109669+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c82637df-1844-49cd-b49e-de578a5336ee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	39	Belt A39	\N	2025-11-13 02:02:33.181687+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8b2a4d6d-7166-4170-9788-34283e4d43af	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	39	Belt B39	\N	2025-11-13 02:02:33.252834+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2e337333-bfce-4664-930a-00b9807aef61	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	40	Belt A40	\N	2025-11-13 02:02:33.323428+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
294f146a-86ba-47cf-ac78-5e3bb30b971b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	40	Belt B40	\N	2025-11-13 02:02:33.393864+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5c8f0479-cea1-4f28-86c4-6ad9092f2bb0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	41	Belt A41	\N	2025-11-13 02:02:33.464414+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
120dd7ce-8ff3-49f4-abf9-d5203039251b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	41	Belt B41	\N	2025-11-13 02:02:33.535681+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
60b05d1f-9639-4687-bb63-0913c67561fc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	42	Belt A42	\N	2025-11-13 02:02:33.607149+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5e3e548a-6193-4971-8107-311b1ad9e95e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	42	Belt B42	\N	2025-11-13 02:02:33.677765+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f1891952-021c-4211-a019-a495141307c4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	43	Belt A43	\N	2025-11-13 02:02:33.748786+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d3248cac-d5b7-4e2b-9f0c-5ac9035258bf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	43	Belt B43	\N	2025-11-13 02:02:33.819226+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cd122b13-e790-425d-8bcd-c402002ff3b5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	44	Belt A44	\N	2025-11-13 02:02:33.889771+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
31539897-2a51-4a49-809a-132f29f2795e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	44	Belt B44	\N	2025-11-13 02:02:33.961101+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
799e12d9-e7c3-4be7-a613-2d5c8d764f65	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	45	Belt A45	\N	2025-11-13 02:02:34.032756+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
14aa485f-c66f-46d7-aadf-915ec4135e43	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	45	Belt B45	\N	2025-11-13 02:02:34.104223+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ae9f2f48-c47d-4042-a097-571a86c1156e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	46	Belt A46	\N	2025-11-13 02:02:34.175864+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8b0ff9f3-24c0-4033-a4b1-18c942199233	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	46	Belt B46	\N	2025-11-13 02:02:34.247614+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f54ee6af-808d-4715-995d-1ad30866384b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	47	Belt A47	\N	2025-11-13 02:02:34.318666+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
398d8a4e-8f72-4557-96af-1e504a0ca2a4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	47	Belt B47	\N	2025-11-13 02:02:34.390001+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3851c275-5edf-4880-b24b-4a47e9de544c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	48	Belt A48	\N	2025-11-13 02:02:34.461421+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7e6a63ff-43a5-4e79-aef3-e02bcb791a25	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	48	Belt B48	\N	2025-11-13 02:02:34.532256+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e5436bc8-a2f0-46b7-9e2b-3d403d415e5c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	49	Belt A49	\N	2025-11-13 02:02:34.603364+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e589a6ed-f4fc-44b0-91f4-63dbbb5afaa8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	49	Belt B49	\N	2025-11-13 02:02:34.67663+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
29b045d9-28bb-4562-9d86-fee1ea95aafa	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	50	Belt A50	\N	2025-11-13 02:02:34.747689+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
565e8eac-2b5b-40cd-bc7a-ef0e725d2cae	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	50	Belt B50	\N	2025-11-13 02:02:34.818255+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5e5fbf08-b2d5-4430-8ede-5cfd39587444	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	51	Belt A51	\N	2025-11-13 02:02:34.888758+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
93e8b9a8-03e5-4483-8ec9-9a67c579f35c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	51	Belt B51	\N	2025-11-13 02:02:34.95982+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3b79b43f-536d-4e20-81f9-a42bbda7e504	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	52	Belt A52	\N	2025-11-13 02:02:35.031549+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dc7781d6-8e85-41a2-9623-de8ddb5bacf8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	52	Belt B52	\N	2025-11-13 02:02:35.102762+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
755a34e3-3ef1-41e1-a62f-701db399f230	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	53	Belt A53	\N	2025-11-13 02:02:35.173726+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
347201b2-c401-46e3-aa1e-95bc60da2eec	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	53	Belt B53	\N	2025-11-13 02:02:35.245921+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a0ce3acf-43dc-4379-a062-4a4b699fa9cf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	54	Belt A54	\N	2025-11-13 02:02:35.316439+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b72fc916-0e53-4f93-a3f9-8b74aaf64334	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	54	Belt B54	\N	2025-11-13 02:02:35.38811+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3c37b6c5-5339-4702-a2bb-c316ff44813e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	55	Belt A55	\N	2025-11-13 02:02:35.461449+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b92dda62-8f4b-4a56-8a8d-55c2ca198fda	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	55	Belt B55	\N	2025-11-13 02:02:35.532955+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
284d1ca8-343b-4e5e-b2f0-5fd7edc2ebe2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	56	Belt A56	\N	2025-11-13 02:02:35.604219+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c2660253-de7b-4bb4-8b47-b5d00da09353	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	56	Belt B56	\N	2025-11-13 02:02:35.676887+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8093a396-bd0e-4783-bea4-2c098b5c5a1a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	57	Belt A57	\N	2025-11-13 02:02:35.748091+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6983916d-e2d6-462c-843d-2258bfe9a3dc	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	57	Belt B57	\N	2025-11-13 02:02:35.81911+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b2dc75dd-d2a5-430d-bd27-a05372041fe9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	58	Belt A58	\N	2025-11-13 02:02:35.890134+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2e0601dc-b4d7-40d1-80e5-71405947a66b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	58	Belt B58	\N	2025-11-13 02:02:35.960866+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c624143c-1a6d-4a5f-a1ba-a254c3ec8b19	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	59	Belt A59	\N	2025-11-13 02:02:36.032186+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
384cd998-1578-4b8f-a953-5fe740c1ef7f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	59	Belt B59	\N	2025-11-13 02:02:36.105071+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a151f70f-16b4-4230-b3ea-67b9f5181dd6	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	60	Belt A60	\N	2025-11-13 02:02:36.176419+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d5f6a189-3f0f-49ea-a576-0059f549e5a5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	60	Belt B60	\N	2025-11-13 02:02:36.248258+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
84d12dbc-c5cd-4bbd-9d74-e557540510dd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	61	Belt A61	\N	2025-11-13 02:02:36.319804+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9a275bad-1487-4221-af86-ecce62d047b9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	61	Belt B61	\N	2025-11-13 02:02:36.392873+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e16ff62c-88bf-43ba-b656-f32419b61c84	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	62	Belt A62	\N	2025-11-13 02:02:36.464079+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
87ca7295-3b56-4c5c-b0ea-b828dbbf99a5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	62	Belt B62	\N	2025-11-13 02:02:36.535172+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
daada64f-99f6-4d9d-b663-0cf4cf2f6a61	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	63	Belt A63	\N	2025-11-13 02:02:36.606396+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8f18bcb4-e0e6-4122-82b5-bfe7a50d242d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	63	Belt B63	\N	2025-11-13 02:02:36.677431+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
341455a5-bb76-4d0a-83e9-658561711287	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	64	Belt A64	\N	2025-11-13 02:02:36.7492+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
97646ef0-8229-49f0-a088-43bc596cf9d2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	64	Belt B64	\N	2025-11-13 02:02:36.8208+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a639f1c3-8f41-4c00-a4a0-4e19a4a9c75e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	65	Belt A65	\N	2025-11-13 02:02:36.890882+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
06425d2d-7f7c-4939-a1cb-5e110086862b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	65	Belt B65	\N	2025-11-13 02:02:36.961626+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cba7f33c-2d5d-44a1-887e-4443a24cbb68	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	66	Belt A66	\N	2025-11-13 02:02:37.032352+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fedca8b0-4eb3-44d0-9a0c-53c9a98d14a3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	66	Belt B66	\N	2025-11-13 02:02:37.103748+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8c4698ce-d8ee-4b32-8847-7ce1244e03ef	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	67	Belt A67	\N	2025-11-13 02:02:37.175293+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7c07e749-5420-4261-974a-9d79c94ca2d9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	67	Belt B67	\N	2025-11-13 02:02:37.246353+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
71c52731-8f7a-41b8-80aa-42a8a2e055c2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	68	Belt A68	\N	2025-11-13 02:02:37.317282+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9bed2aaa-02b2-49ff-8d0a-75157b59aa7a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	68	Belt B68	\N	2025-11-13 02:02:37.388351+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
733cb550-ddf3-4f78-8a93-830e694f24d0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	69	Belt A69	\N	2025-11-13 02:02:37.46124+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a9c644da-7fae-429b-b3d2-b3f01c6ac8e8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	69	Belt B69	\N	2025-11-13 02:02:37.532501+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9287ab23-36bc-47a5-84a1-ed2c3de8250f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	A	70	Belt A70	\N	2025-11-13 02:02:37.603836+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
63536da1-2ded-4e34-9e5b-a02fbc30f841	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	70	Belt B70	\N	2025-11-13 02:02:37.675256+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5ce2e97d-485e-4730-a733-37fa5d271492	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	18	Belt A18	\N	2025-11-14 02:36:07.085893+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0a60ae20-47f6-41db-b438-d8232413037c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	18	Belt B18	\N	2025-11-14 02:36:07.148855+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c3746853-0193-4752-be19-cbb80e8f5658	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	19	Belt A19	\N	2025-11-14 02:36:07.210707+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9c534e6f-f2c8-4f46-bdb8-b447830db3ab	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	19	Belt B19	\N	2025-11-14 02:36:07.274909+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0e215f55-4340-4d2a-9d54-e9033ce896b6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	20	Belt A20	\N	2025-11-14 02:36:07.336862+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
afdbd949-f285-4914-ae7d-320e4a5ab176	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	20	Belt B20	\N	2025-11-14 02:36:07.399856+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3fe8eb6e-437d-44d9-a67f-49813b438b5e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	21	Belt A21	\N	2025-11-14 02:36:07.462792+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ec2506ad-5baa-4728-8980-24386ae18838	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	21	Belt B21	\N	2025-11-14 02:36:07.525255+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8c646860-89cd-40d6-ad2f-d54b4821bf7c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	22	Belt A22	\N	2025-11-14 02:36:07.590644+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
082a30c5-10c4-416f-8071-885f667b8117	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	22	Belt B22	\N	2025-11-14 02:36:07.6537+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a0c286b8-aea8-4418-9bf6-c1a0a9cc9d33	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	23	Belt A23	\N	2025-11-14 02:36:07.717479+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a315b053-f000-490f-a749-20438f147c14	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	23	Belt B23	\N	2025-11-14 02:36:07.780446+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e386ba05-ff7f-433c-8e55-e90fe26cdfd7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	24	Belt A24	\N	2025-11-14 02:36:07.843089+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c23f44b5-0694-48e0-8a1b-36d95e058019	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	24	Belt B24	\N	2025-11-14 02:36:07.905653+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
973818a2-5eb0-4d45-868f-fd597f269e4b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	25	Belt A25	\N	2025-11-14 02:36:07.968186+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
48c15025-af76-4557-b1d4-efce2e3c9d41	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	25	Belt B25	\N	2025-11-14 02:36:08.030988+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9059ac1a-2002-44aa-9ef9-e1bfc669c6e6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	26	Belt A26	\N	2025-11-14 02:36:08.094851+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
79c0425f-5f07-404d-ba86-fdded4de5302	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	26	Belt B26	\N	2025-11-14 02:36:08.157642+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ff80292e-169d-47c8-b510-0d1f044b9630	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	27	Belt A27	\N	2025-11-14 02:36:08.220485+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f1137eea-704c-4eef-98f9-f1f0847a753e	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	27	Belt B27	\N	2025-11-14 02:36:08.283186+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
35a3f496-e522-4c94-b8a4-b6a5e5a5edd5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	28	Belt A28	\N	2025-11-14 02:36:08.347107+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f698a3ec-298e-47bc-a0c1-390a12c640f0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	28	Belt B28	\N	2025-11-14 02:36:08.41029+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
92939c93-e174-41a7-9b99-50fd73b78c7a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	29	Belt A29	\N	2025-11-14 02:36:08.473407+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e078d880-fbee-4417-8c02-9b599126eb76	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	29	Belt B29	\N	2025-11-14 02:36:08.538714+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
cd8ab97e-acc3-4e2c-9bdf-48c5d3284913	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	30	Belt A30	\N	2025-11-14 02:36:08.602826+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
34ee2620-b88d-4710-b06e-7960b6cff2ec	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	30	Belt B30	\N	2025-11-14 02:36:08.665616+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d7ec9fca-6b4a-41bf-8bb4-2e99136265cc	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	31	Belt A31	\N	2025-11-14 02:36:08.735622+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
afb0cbd1-a6a1-4a76-9122-3b723930403d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	31	Belt B31	\N	2025-11-14 02:36:08.798402+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
42ef5aa5-23f4-498a-a175-fa9f1adb362f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	32	Belt A32	\N	2025-11-14 02:36:08.860935+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3e1d1c44-7fb6-4a41-8e76-730563d3d4d3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	32	Belt B32	\N	2025-11-14 02:36:08.923898+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
96d19cc1-6385-4752-9ff5-c3be46d1a975	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	33	Belt A33	\N	2025-11-14 02:36:08.985686+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3deaf6a9-6ac9-4491-9f54-3e43c04cba15	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	33	Belt B33	\N	2025-11-14 02:36:09.048419+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
98673e5d-fead-4add-84de-5c9532f6c8b8	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	34	Belt A34	\N	2025-11-14 02:36:09.110111+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28e7f4cb-6cda-4329-bed4-1db40265ce89	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	34	Belt B34	\N	2025-11-14 02:36:09.17324+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
352138ec-6f4e-4ac6-b752-fd397025b182	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	35	Belt A35	\N	2025-11-14 02:36:09.235613+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
609dca4d-7a46-40ae-975b-4d624b8dc8c7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	35	Belt B35	\N	2025-11-14 02:36:09.298348+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
901f9984-dc8a-48fd-ab4c-31b6082e00ee	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	36	Belt A36	\N	2025-11-14 02:36:09.362079+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
585839c3-c70f-4309-bcfa-4d6c8a351bfb	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	36	Belt B36	\N	2025-11-14 02:36:09.424581+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4aedf44c-3c4f-4d39-b5cd-7b55771993ff	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	37	Belt A37	\N	2025-11-14 02:36:09.487118+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
600bb148-f11f-4d95-8949-d85b10f58562	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	37	Belt B37	\N	2025-11-14 02:36:09.550595+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9f20b3c4-326e-41e8-9e50-96eac957adf2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	38	Belt A38	\N	2025-11-14 02:36:09.61319+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
94791eed-7722-42e4-8d0c-813b10575444	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	38	Belt B38	\N	2025-11-14 02:36:09.676113+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c029eb56-ab4f-437a-a68a-e8e5f98e3070	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	39	Belt A39	\N	2025-11-14 02:36:09.738334+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f39ec3d5-daab-453a-a355-ad9d66b5b332	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	39	Belt B39	\N	2025-11-14 02:36:09.798572+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
37817878-eeb8-496f-953c-17f16ed7c93c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	40	Belt A40	\N	2025-11-14 02:36:09.861378+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6b22ce13-cbfd-46c0-844b-b993ba950155	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	40	Belt B40	\N	2025-11-14 02:36:09.926566+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
321e0f3c-e415-4c02-9e76-7db4068a3b1d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	41	Belt A41	\N	2025-11-14 02:36:09.989626+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
53c4edeb-893a-4fdd-9bd8-10f97db79862	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	41	Belt B41	\N	2025-11-14 02:36:10.05303+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
264b9f7a-597c-459b-a881-05dd0c9bef5f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	42	Belt A42	\N	2025-11-14 02:36:10.11464+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1197d2ef-461a-4a91-a048-848722cb0539	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	42	Belt B42	\N	2025-11-14 02:36:10.177572+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e0a528f1-d7b5-4e04-881b-7c6c0333c9b7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	43	Belt A43	\N	2025-11-14 02:36:10.240214+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7dbcb6b5-99d0-45c1-87ca-c0ecc0661911	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	43	Belt B43	\N	2025-11-14 02:36:10.302752+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dba677b1-6fcd-4231-bc74-73676dcf24e2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	44	Belt A44	\N	2025-11-14 02:36:10.365686+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5d69a8a7-5fdd-40c9-b182-b9db6e2a89ba	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	44	Belt B44	\N	2025-11-14 02:36:10.427759+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0016b47f-394d-4765-8edd-b341791ad4c5	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	45	Belt A45	\N	2025-11-14 02:36:10.491264+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
539ce4a5-fd58-4879-a6f3-2997ad5cef2f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	45	Belt B45	\N	2025-11-14 02:36:10.554502+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5967ff79-cd4d-44e8-9d62-a08da5d88f7f	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	46	Belt A46	\N	2025-11-14 02:36:10.618696+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6a5ff8e2-e979-4f3f-912c-07f57fe4e345	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	46	Belt B46	\N	2025-11-14 02:36:10.681573+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
337ae75c-de76-42d8-8cb8-ae9a5e6acfe8	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	47	Belt A47	\N	2025-11-14 02:36:10.744494+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
df406c63-d455-41b1-8c7b-78ffc8e22c20	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	47	Belt B47	\N	2025-11-14 02:36:10.807898+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c10356db-6e3c-4517-a18e-2aae2c2b4dd1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	48	Belt A48	\N	2025-11-14 02:36:10.869764+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dec68c18-b94a-46ae-b3ef-c0b71cb9d099	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	48	Belt B48	\N	2025-11-14 02:36:10.932683+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
37072146-9777-4853-b837-641d6c6b1b0c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	49	Belt A49	\N	2025-11-14 02:36:10.996614+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
57339fdf-6ac8-4bc7-b1fc-bdcfcf105399	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	49	Belt B49	\N	2025-11-14 02:36:11.059139+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
63b6dee3-55af-4877-b123-58dfddd950af	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	50	Belt A50	\N	2025-11-14 02:36:11.121703+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
33556a8a-16a1-4e50-b6bc-b8e254a9ed0c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	50	Belt B50	\N	2025-11-14 02:36:11.185626+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9a7542c6-9f9a-425d-9c18-d8e79035ace2	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	51	Belt A51	\N	2025-11-14 02:36:11.24768+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7bbefedc-2ae3-4665-ba0c-8e0dd1ba9649	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	51	Belt B51	\N	2025-11-14 02:36:11.311321+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
94cffe40-dfb4-4676-af7b-6f0602e8dd1c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	52	Belt A52	\N	2025-11-14 02:36:11.374781+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3b583d15-75de-4932-a527-1785660a9998	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	52	Belt B52	\N	2025-11-14 02:36:11.436648+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
479d6056-09c3-4426-9c07-f8c2336c6854	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	53	Belt A53	\N	2025-11-14 02:36:11.499537+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
596dcf1c-7a90-4963-832e-df20dd273730	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	53	Belt B53	\N	2025-11-14 02:36:11.562602+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
97ec2ef4-6dea-4713-b843-efb926190d19	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	54	Belt A54	\N	2025-11-14 02:36:11.627845+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e41cb202-a1a1-4bda-b93c-722fbcf06e71	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	54	Belt B54	\N	2025-11-14 02:36:11.690261+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e292ae37-f53b-414b-91c2-ecba72b5f884	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	55	Belt A55	\N	2025-11-14 02:36:11.753178+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
79cda05b-fb0a-4250-8d54-ac9dc47f7d23	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	55	Belt B55	\N	2025-11-14 02:36:11.815731+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2c539b6f-e8fb-4bd2-be5f-557b51563f80	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	56	Belt A56	\N	2025-11-14 02:36:11.879592+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ebaab39f-1d9e-47a9-858a-f6e64fc3f9a4	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	56	Belt B56	\N	2025-11-14 02:36:11.94223+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f7c993ff-e142-4a84-a56b-2ffc03032c67	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	57	Belt A57	\N	2025-11-14 02:36:12.005238+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
db5ef163-ce6e-40fd-b94d-9f53652d07d0	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	57	Belt B57	\N	2025-11-14 02:36:12.06787+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bf103c0a-1f01-4743-b4ad-1914c92a1493	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	58	Belt A58	\N	2025-11-14 02:36:12.131107+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
788572aa-a06a-4185-8dd4-e42675347871	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	58	Belt B58	\N	2025-11-14 02:36:12.193077+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9f89e67b-7f8e-48dc-9fcc-19ef471c0cf6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	59	Belt A59	\N	2025-11-14 02:36:12.255692+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4f3905f4-bd76-4e19-9c21-5b77b1b0f8b9	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	59	Belt B59	\N	2025-11-14 02:36:12.318548+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0c8c8be4-42cd-4eae-a447-74e941e07fa1	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	60	Belt A60	\N	2025-11-14 02:36:12.381328+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a732a143-065d-4ea6-8a63-6e65e2ec3477	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	60	Belt B60	\N	2025-11-14 02:36:12.442638+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
826db8cd-06d5-4b44-b256-c7bfc1dc76fd	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	61	Belt A61	\N	2025-11-14 02:36:12.50537+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
79858654-0135-4fb6-8aa2-14a9f56f8363	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	61	Belt B61	\N	2025-11-14 02:36:12.567768+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a693ddd8-913a-4ae4-89a2-e189e8426115	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	62	Belt A62	\N	2025-11-14 02:36:12.630414+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a00121ab-c549-4833-af89-76ada69bb1c3	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	62	Belt B62	\N	2025-11-14 02:36:12.691931+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7da65253-71d5-40f0-b6a7-71f9061a5ffe	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	63	Belt A63	\N	2025-11-14 02:36:12.754681+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e63897e7-23b8-4be4-a170-c4607928c41a	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	63	Belt B63	\N	2025-11-14 02:36:12.817382+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e9fea62e-5222-499b-87d5-47d90ec6446b	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	64	Belt A64	\N	2025-11-14 02:36:12.880088+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
142cecac-6813-4dcd-80a2-d554bb1fd9c7	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	64	Belt B64	\N	2025-11-14 02:36:12.94269+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5a9fcd3c-1615-4edb-9a5a-13ab99d320ea	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	65	Belt A65	\N	2025-11-14 02:36:13.006302+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
12a31387-321d-4581-a0ee-c90dd07ac0c6	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	65	Belt B65	\N	2025-11-14 02:36:13.069668+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
080f1be6-cbc6-48bc-87a9-31b9a9517381	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	66	Belt A66	\N	2025-11-14 02:36:13.132461+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c20d0a92-6402-4fc4-8f81-4d9ea694fcf4	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	66	Belt B66	\N	2025-11-14 02:36:13.195319+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6f210d34-e643-4e22-8111-1edeb8bb66ac	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	67	Belt A67	\N	2025-11-14 02:36:13.259243+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8cc45888-9603-4d27-aed3-5467e1a9cc95	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	67	Belt B67	\N	2025-11-14 02:36:13.321868+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
56dc630e-224c-445f-b2ce-48d6a485baec	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	68	Belt A68	\N	2025-11-14 02:36:13.386954+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bb3d1bf4-1710-49b5-ab2d-b26b447a9b95	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	68	Belt B68	\N	2025-11-14 02:36:13.449869+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f96222f2-348b-486a-a24e-a37e4f4cef6d	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	69	Belt A69	\N	2025-11-14 02:36:13.51196+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dd69c8e1-dcf2-4ad2-8bea-0dd331117580	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	69	Belt B69	\N	2025-11-14 02:36:13.575147+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8a94d980-8598-46ec-b2eb-4e44c1ce414c	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	A	70	Belt A70	\N	2025-11-14 02:36:13.638338+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9b22cd29-e168-4308-8a18-16370794a710	da832c38-414f-4ca0-8e50-cd910c6d3724	d7382674-b4f7-4689-8de9-fe178cc4dfcb	product	\N	B	70	Belt B70	\N	2025-11-14 02:36:13.701725+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
71bdc23d-9d27-4eb1-8d05-b2d4a5eae30d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	18	Belt A18	\N	2025-11-14 03:12:40.732597+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6010a016-7b6c-4a6b-a116-81541b6f7f19	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	18	Belt B18	\N	2025-11-14 03:12:40.797946+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
458d6f21-0d97-41c7-8f9d-19fb070410ef	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	19	Belt A19	\N	2025-11-14 03:12:40.864764+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8bccd9fe-14b5-46ea-8fb3-427c0c417b5c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	19	Belt B19	\N	2025-11-14 03:12:40.931242+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7ce44c07-cd92-45bc-8de5-1557e494b427	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	20	Belt A20	\N	2025-11-14 03:12:40.998838+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ede6a0ee-67dc-4f45-8293-93246d8ccde7	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	20	Belt B20	\N	2025-11-14 03:12:41.152435+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f7b2c965-7e77-4fe8-8984-1721cf2117ab	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	21	Belt A21	\N	2025-11-14 03:12:41.219025+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4c8d9286-490d-4979-bb77-bfe1643d6834	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	21	Belt B21	\N	2025-11-14 03:12:41.286704+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4deaa663-90c9-4d1d-9a5e-07e46b57d541	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	22	Belt A22	\N	2025-11-14 03:12:41.352847+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e492965f-d33f-4425-b797-02e6c4ed2a02	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	22	Belt B22	\N	2025-11-14 03:12:41.419134+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
85435975-5d23-48a0-a983-4c097de2d3c4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	23	Belt A23	\N	2025-11-14 03:12:41.486982+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
01dc262b-94d8-468c-9482-28d816893421	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	23	Belt B23	\N	2025-11-14 03:12:41.554639+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
62933f95-6733-4eb9-9114-c83a36bfc0b9	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	24	Belt A24	\N	2025-11-14 03:12:41.622692+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3e399263-18d0-4c03-8a1d-a21da0e0bc56	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	24	Belt B24	\N	2025-11-14 03:12:41.689264+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5d74aee7-c220-4565-af00-8076b947fde3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	25	Belt A25	\N	2025-11-14 03:12:41.755422+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fe46e214-c4f2-4b54-9d0b-e11c4e4659c0	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	25	Belt B25	\N	2025-11-14 03:12:41.822103+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
52b5012c-bf91-42d5-ad5f-9fc6d75b5d15	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	26	Belt A26	\N	2025-11-14 03:12:41.890676+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
88ba0bf8-3002-4cdc-b8da-b93e9d3641ff	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	26	Belt B26	\N	2025-11-14 03:12:41.957101+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5c53b01e-bdfc-431f-bad3-87e20dbfc196	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	27	Belt A27	\N	2025-11-14 03:12:42.023265+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
48c23f8c-f162-47d9-96df-253bf659c86f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	27	Belt B27	\N	2025-11-14 03:12:42.089697+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e7a320a7-e55a-4fb2-a339-047e89b43862	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	28	Belt A28	\N	2025-11-14 03:12:42.156393+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
821fe00e-8dd7-451b-a852-540668b78e9c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	28	Belt B28	\N	2025-11-14 03:12:42.222844+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d755d053-fa74-4d7a-8f70-e8a29437d831	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	29	Belt A29	\N	2025-11-14 03:12:42.289293+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7c530d51-ad56-4434-9a94-c4253c910079	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	29	Belt B29	\N	2025-11-14 03:12:42.357662+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d021e91c-e94d-4388-95f9-a3b17169e29b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	30	Belt A30	\N	2025-11-14 03:12:42.423492+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
15d41288-a72e-41c1-b7a5-f02d0f4b9542	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	30	Belt B30	\N	2025-11-14 03:12:42.49626+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
43052825-de6d-4aa4-9c9d-0d967972d0e9	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	31	Belt A31	\N	2025-11-14 03:12:42.563116+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
83137eb0-55bb-4205-8b8a-138fa0a53599	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	31	Belt B31	\N	2025-11-14 03:12:42.629699+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f5b84a25-779b-42eb-b29a-6397b35d2c33	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	32	Belt A32	\N	2025-11-14 03:12:42.696188+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
395e72f1-4178-436b-8823-648319289156	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	32	Belt B32	\N	2025-11-14 03:12:42.762554+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f991ec40-1ca6-40a8-b363-5c5950663122	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	33	Belt A33	\N	2025-11-14 03:12:42.829637+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
26d25b6a-4e8c-4a38-818c-2f15323569ab	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	33	Belt B33	\N	2025-11-14 03:12:42.896417+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
67224587-9559-41de-b816-d54402d06078	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	34	Belt A34	\N	2025-11-14 03:12:42.962376+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9955057f-330f-4275-92cd-48734654aa1d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	34	Belt B34	\N	2025-11-14 03:12:43.028613+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
53464919-880b-414b-9241-41fc3eab026a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	35	Belt A35	\N	2025-11-14 03:12:43.095008+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
95260785-e41b-43e0-8bc1-d7112116ea3f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	35	Belt B35	\N	2025-11-14 03:12:43.161094+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
67011049-81ae-43e8-b4a6-3bf7b7dd83bb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	36	Belt A36	\N	2025-11-14 03:12:43.228368+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1591dc26-4245-4750-bf48-235e4c7c6e75	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	36	Belt B36	\N	2025-11-14 03:12:43.295885+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7dd01495-5ae1-43aa-ac27-ac9a152dc025	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	37	Belt A37	\N	2025-11-14 03:12:43.362642+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2f8ceb5f-a18b-4669-ab1b-b3658bcacf4a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	37	Belt B37	\N	2025-11-14 03:12:43.428316+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
46bb190d-2b26-4d32-9133-c4aceae3ed2f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	38	Belt A38	\N	2025-11-14 03:12:43.498893+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0d6b491a-c03a-44bc-bcdf-8d396a66a014	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	38	Belt B38	\N	2025-11-14 03:12:43.566584+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b8544b46-873d-4279-8c40-c6d9db6ef22d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	39	Belt A39	\N	2025-11-14 03:12:43.632974+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7b7aa38d-9479-4078-bb4b-f28ef14b723f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	39	Belt B39	\N	2025-11-14 03:12:43.699455+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c7b517a1-eaa6-4e19-92a6-a5e382a240f2	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	40	Belt A40	\N	2025-11-14 03:12:43.76537+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
20935c7f-143a-4d1a-9b98-0c51226922a4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	40	Belt B40	\N	2025-11-14 03:12:43.831458+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e48489f0-9140-460a-a78f-a2872353cd41	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	41	Belt A41	\N	2025-11-14 03:12:43.897504+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5688810b-163c-4b2a-a44e-a91217bb25f8	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	41	Belt B41	\N	2025-11-14 03:12:43.967624+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
47b3a3c2-4cee-4db6-bf7d-b046f9277443	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	42	Belt A42	\N	2025-11-14 03:12:44.034296+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d9f10707-93c4-409b-8f8c-1c916a4b2126	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	42	Belt B42	\N	2025-11-14 03:12:44.100459+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
682eddfb-9d06-4733-a15b-70c088c9a861	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	43	Belt A43	\N	2025-11-14 03:12:44.167303+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ee4d284a-6b42-40ab-ad1e-29f20aa2d222	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	43	Belt B43	\N	2025-11-14 03:12:44.236064+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c2285313-9a23-40fa-95a4-51a7d3c44c76	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	44	Belt A44	\N	2025-11-14 03:12:44.302706+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9bfb2b83-92f4-4921-8aa8-9c1707361ac3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	44	Belt B44	\N	2025-11-14 03:12:44.370009+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bdde119c-49d2-4d49-8ad4-d5f635011629	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	45	Belt A45	\N	2025-11-14 03:12:44.436636+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0e254eb2-0c12-4d35-8573-0c88458ee970	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	45	Belt B45	\N	2025-11-14 03:12:44.503214+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
02648dde-fe4a-42f4-aefd-506db9aedc50	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	46	Belt A46	\N	2025-11-14 03:12:44.572778+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
70339693-53ae-45b9-9854-f0e725bcd395	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	46	Belt B46	\N	2025-11-14 03:12:44.638841+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d6f196b9-34ad-4d49-8e42-9ef56e469982	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	47	Belt A47	\N	2025-11-14 03:12:44.704396+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
86b4338f-d369-4a55-b46e-fddbb24c76b6	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	47	Belt B47	\N	2025-11-14 03:12:44.771676+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
10e28603-1a42-4b3b-a0ee-3a7c6376b8be	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	48	Belt A48	\N	2025-11-14 03:12:44.836934+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a6402fed-7973-4061-b052-1dd15bb5323c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	48	Belt B48	\N	2025-11-14 03:12:44.901946+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
109482af-69a0-421e-82d6-ced2c3fd8e33	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	49	Belt A49	\N	2025-11-14 03:12:44.966952+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9527ea90-2f59-40c4-a276-234fbbc00be8	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	49	Belt B49	\N	2025-11-14 03:12:45.035087+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f88b0e60-d2cf-4d3e-8f59-da537ec0f84a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	50	Belt A50	\N	2025-11-14 03:12:45.101517+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b91d8477-16ee-4bbc-842c-a770f4151bc5	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	50	Belt B50	\N	2025-11-14 03:12:45.168722+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
645dd949-baf9-42fe-a6c1-7f46e233c768	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	51	Belt A51	\N	2025-11-14 03:12:45.236952+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
57f8ebed-176a-4c9b-b8d0-ca28d3a31f10	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	51	Belt B51	\N	2025-11-14 03:12:45.303847+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
91b7606f-8b4a-4e6d-bec6-5235376a3b5b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	52	Belt A52	\N	2025-11-14 03:12:45.369939+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bc8476fa-9223-417d-99f3-69259ef265c0	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	52	Belt B52	\N	2025-11-14 03:12:45.435898+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
98095f4d-2867-42cd-9135-c903b20f2319	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	53	Belt A53	\N	2025-11-14 03:12:45.502503+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
49e9c498-0dd9-4e56-b7bc-ea74f7dbdc13	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	53	Belt B53	\N	2025-11-14 03:12:45.568594+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4c4aa0c1-2ecd-46a2-88c3-8a93b0e39e9f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	54	Belt A54	\N	2025-11-14 03:12:45.635223+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
11efa40f-181c-4654-956a-975173c19b37	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	54	Belt B54	\N	2025-11-14 03:12:45.702634+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a7a5c984-bbae-4f30-85c3-2570059cd9d8	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	55	Belt A55	\N	2025-11-14 03:12:45.769384+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1230466a-7890-4d72-b61e-81ab074e8569	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	55	Belt B55	\N	2025-11-14 03:12:45.836042+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f723066a-420e-419b-a698-fd2d39b676ad	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	56	Belt A56	\N	2025-11-14 03:12:45.903959+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6e8f2279-4c0f-4c8f-9727-38511301d82f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	56	Belt B56	\N	2025-11-14 03:12:45.970222+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
74e3668a-589d-48f1-9c5f-839676ab6454	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	57	Belt A57	\N	2025-11-14 03:12:46.036514+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1d5c211f-5bc5-4c74-9956-4a6e3a45208f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	57	Belt B57	\N	2025-11-14 03:12:46.10317+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5d832159-a644-46a5-a300-b48ffad28211	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	58	Belt A58	\N	2025-11-14 03:12:46.169951+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
82ee89ee-b04f-4abc-88f1-cfffe3bfc38f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	58	Belt B58	\N	2025-11-14 03:12:46.236371+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
de8ffe08-83c4-4d20-ad76-1faf51acfede	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	59	Belt A59	\N	2025-11-14 03:12:46.302654+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2f5a49ed-eaeb-4c9a-bded-44aa5f8b6280	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	59	Belt B59	\N	2025-11-14 03:12:46.369818+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0af03524-7314-4586-ad7c-566d6d78f124	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	60	Belt A60	\N	2025-11-14 03:12:46.43606+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4b77c0ad-6921-4f3e-8ce8-fc518d1353ff	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	60	Belt B60	\N	2025-11-14 03:12:46.505873+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e1eb8695-796c-4780-a6fd-118951dd20b1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	61	Belt A61	\N	2025-11-14 03:12:46.573747+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
027d6e74-a639-470c-89d8-1cf4dcaed8a2	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	61	Belt B61	\N	2025-11-14 03:12:46.63789+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bd3c3075-b718-45bb-a37a-60c21da5b026	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	62	Belt A62	\N	2025-11-14 03:12:46.705946+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
185d390a-1e21-49c0-ad44-36743b39f7ea	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	62	Belt B62	\N	2025-11-14 03:12:46.772423+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
492dfad5-52ea-4d46-a16d-8fcc070d31fb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	63	Belt A63	\N	2025-11-14 03:12:46.838387+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d23808da-6a22-46f2-9c43-93c5d9f12ec4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	63	Belt B63	\N	2025-11-14 03:12:46.904726+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
43e9ae82-88c9-44d8-ad98-936465e8c778	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	64	Belt A64	\N	2025-11-14 03:12:46.971847+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bcee192a-dabe-4169-9b31-d09f475d055a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	64	Belt B64	\N	2025-11-14 03:12:47.038536+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e6bbc3e6-b35d-431f-ac1d-c9d8fd189e5c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	65	Belt A65	\N	2025-11-14 03:12:47.10572+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
82bcb1db-c785-4018-889a-01a1939226a1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	65	Belt B65	\N	2025-11-14 03:12:47.170887+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f75da02d-cc9b-45e6-bc64-f308c6c8b3f1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	66	Belt A66	\N	2025-11-14 03:12:47.237943+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3e3e8d6a-a5b5-4a83-a900-e343fbfe2505	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	66	Belt B66	\N	2025-11-14 03:12:47.304495+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3ea61a0e-7a26-484a-977e-70098468126c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	67	Belt A67	\N	2025-11-14 03:12:47.370581+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4e2bf7d5-4bf4-4510-9686-5b2923f16316	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	67	Belt B67	\N	2025-11-14 03:12:47.437024+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c77cdb05-089c-4b1c-afe9-88f3b6cf8426	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	68	Belt A68	\N	2025-11-14 03:12:47.503751+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9f843228-f97f-4878-baf7-b0705f5b658d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	68	Belt B68	\N	2025-11-14 03:12:47.56974+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5be5871f-bba3-4e18-9f29-3076b99ce87f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	69	Belt A69	\N	2025-11-14 03:12:47.635791+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5cbcc4d4-e603-4b59-988c-b26db44de0e3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	69	Belt B69	\N	2025-11-14 03:12:47.701585+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c6b4efee-70e2-4ca2-8c8e-18f313c7da03	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	A	70	Belt A70	\N	2025-11-14 03:12:47.767844+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a16f9e77-c78d-48c8-883c-8178b62f9bc4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	\N	B	70	Belt B70	\N	2025-11-14 03:12:47.834108+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0a74052f-2cbb-4d78-8630-ea057b9a5ca9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	75	Belt B75	\N	2025-11-14 23:52:35.283568+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
66f7bc35-b52b-43d3-a29f-46c11ec03e3b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	B	76	Belt B76	\N	2025-11-17 16:00:14.906769+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5a849ff6-56cf-4288-87ff-4653e63e0795	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	Other	4L200	Belt 4L200	\N	2025-11-16 16:47:23.934777+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
59b9f3e8-8a37-4cb1-b9dd-5d37ded5d6ff	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	Other	4L210	Belt 4L210	\N	2025-11-16 16:47:24.006955+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
62bb9763-f6a2-45f4-8f0a-1378a13f88a4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	Other	3L190	Belt 3L190		2025-11-16 16:47:24.104207+00	\N	\N	f	\N	\N	t	\N		t	\N	\N	\N
d2ba385c-8418-432e-add0-5abaeba5db6c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	Other	4L220	Belt 4L220	\N	2025-11-16 16:47:24.169346+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f4e18fa8-e221-46fa-a818-3e0423e0b696	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	\N	Other	3L220	Belt 3L220	\N	2025-11-17 14:26:20.405798+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
637f8cb8-0c4d-4af2-9109-8287abf9c7ee	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x20x1	M Filter 20x20x1	\N	2025-11-14 03:12:33.509738+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3cc7304d-b99f-4534-bdc5-196694b86ada	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	10x10x1	M Filter 10x10x1	\N	2025-11-13 02:02:20.287198+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
99fb8a45-cb95-48a1-84da-b73eb7087781	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	10x10x2	M Filter 10x10x2	\N	2025-11-13 02:02:20.363245+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
84f000f7-5511-4549-98f2-07d28dc45ab8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	10x20x1	M Filter 10x20x1	\N	2025-11-13 02:02:20.435795+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a6ee5d99-7777-473d-b710-173cae4433ba	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	10x20x2	M Filter 10x20x2	\N	2025-11-13 02:02:20.50726+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
44ee59d1-cd4d-44ca-8e5d-cf1fb18840c4	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	12x12x1	M Filter 12x12x1	\N	2025-11-13 02:02:20.579539+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a4a13e85-0615-4616-b071-f3b312126221	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	12x12x2	M Filter 12x12x2	\N	2025-11-13 02:02:20.652527+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a844019f-47ce-413f-9234-640088d55ba0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	12x24x1	M Filter 12x24x1	\N	2025-11-13 02:02:20.72432+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0059a209-5eb5-4f5d-ad35-ff3c2f77a997	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	12x24x2	M Filter 12x24x2	\N	2025-11-13 02:02:20.7957+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e9f1a382-d90b-4e52-847b-1982c5d0ca7f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x20x1	M Filter 14x20x1	\N	2025-11-13 02:02:20.86795+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8fc37055-87e0-42a8-a484-efe59cb78f73	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x20x2	M Filter 14x20x2	\N	2025-11-13 02:02:20.940466+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5cbe0e5b-1f8a-47e6-ba22-05e07c27d6cf	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x24x1	M Filter 14x24x1	\N	2025-11-13 02:02:21.012671+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4ba5c9bb-bfae-4b5e-bf1e-2285c4e9e6f0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x24x2	M Filter 14x24x2	\N	2025-11-13 02:02:21.085161+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a4481f88-2c17-4aba-b908-42db409a56e2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x25x1	M Filter 14x25x1	\N	2025-11-13 02:02:21.155563+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3e24a25a-1724-445f-80e4-025174434273	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	14x25x2	M Filter 14x25x2	\N	2025-11-13 02:02:21.226287+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
790770c1-efaf-430e-ae5a-d6de10534cdd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	15x20x1	M Filter 15x20x1	\N	2025-11-13 02:02:21.298169+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2019157a-61ca-4288-b8af-91be76519beb	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	15x20x2	M Filter 15x20x2	\N	2025-11-13 02:02:21.37113+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6410ecfa-d0f9-43b4-8ee5-d92eace70e70	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x16x1	M Filter 16x16x1	\N	2025-11-13 02:02:21.442864+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f89db27b-66bf-43c4-a6f7-f57f9245eaf2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x16x2	M Filter 16x16x2	\N	2025-11-13 02:02:21.516062+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3f8cca45-0dce-475e-9837-2e684bfc881e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x20x1	M Filter 16x20x1	\N	2025-11-13 02:02:21.587242+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a5fe5314-5272-4917-9e77-9f91f631e2b3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x20x2	M Filter 16x20x2	\N	2025-11-13 02:02:21.658624+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
73292c98-3034-401b-b297-1c2afb6beeee	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x24x1	M Filter 16x24x1	\N	2025-11-13 02:02:21.731253+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
60c7f0cc-272b-4c43-aee4-bf0c35595a6e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x24x2	M Filter 16x24x2	\N	2025-11-13 02:02:21.802613+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ccd285dd-8f89-478b-84d7-1808251466f9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x25x1	M Filter 16x25x1	\N	2025-11-13 02:02:21.873702+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e286cc61-ee42-4e37-b252-32e081134022	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x25x2	M Filter 16x25x2	\N	2025-11-13 02:02:21.947577+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
056b3296-a07c-4798-8c86-4f8ef98b606f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x30x1	M Filter 16x30x1	\N	2025-11-13 02:02:22.017844+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8bdc1f43-c738-40ac-ac14-4eb70ee6a7c9	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	16x30x2	M Filter 16x30x2	\N	2025-11-13 02:02:22.089745+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
80ddd204-b3c4-46ea-b5c7-3221d040b04f	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x18x1	M Filter 18x18x1	\N	2025-11-13 02:02:22.161179+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dc2b65fd-82ea-4cb5-9fa6-778d2230f64a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x18x2	M Filter 18x18x2	\N	2025-11-13 02:02:22.231897+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f7fa1af9-3735-4c6a-b32f-1128dc18ed73	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x24x1	M Filter 18x24x1	\N	2025-11-13 02:02:22.302996+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e10e7d37-7f9f-4954-aed0-7efe604b090e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x24x2	M Filter 18x24x2	\N	2025-11-13 02:02:22.374546+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9d44a3e1-8cfd-4088-a293-5b0941342ea1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x25x1	M Filter 18x25x1	\N	2025-11-13 02:02:22.449145+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a185f048-8057-43ca-9d87-cf807b40bc4a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	18x25x2	M Filter 18x25x2	\N	2025-11-13 02:02:22.521671+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
04534599-b897-4920-8746-97088e205bfd	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x20x1	M Filter 20x20x1	\N	2025-11-13 02:02:22.593572+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3017605c-71c0-45b3-989e-bf4aca6a809b	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x20x2	M Filter 20x20x2	\N	2025-11-13 02:02:22.664482+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6980ca40-313f-4161-9856-461eafa649f8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x24x1	M Filter 20x24x1	\N	2025-11-13 02:02:22.73498+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9288953a-e0b3-48bb-a863-6e3e72108080	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x24x2	M Filter 20x24x2	\N	2025-11-13 02:02:22.806297+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b25ed85f-a158-4c21-adf3-5930fd289b9d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x25x1	M Filter 20x25x1	\N	2025-11-13 02:02:22.8776+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7c9d7c1e-163b-4d9a-ab94-a12b24877701	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x25x2	M Filter 20x25x2	\N	2025-11-13 02:02:22.95038+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
58704a8a-693d-443d-8b5b-9eca43c11718	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x30x1	M Filter 20x30x1	\N	2025-11-13 02:02:23.022004+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3ee46f4d-a428-4373-9458-b848448abac1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	20x30x2	M Filter 20x30x2	\N	2025-11-13 02:02:23.093129+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
331344db-1025-4200-b0d5-1753acd5654e	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	24x24x1	M Filter 24x24x1	\N	2025-11-13 02:02:23.164959+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7f275cfd-99b2-497a-a9ce-cf1570464b45	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	24x24x2	M Filter 24x24x2	\N	2025-11-13 02:02:23.234892+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8a57920a-b5e3-47d7-9e7a-ff36b1f28cd0	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	24x30x1	M Filter 24x30x1	\N	2025-11-13 02:02:23.306387+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ec80c3f2-b4c3-4e1f-b586-f591c30f14d3	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	24x30x2	M Filter 24x30x2	\N	2025-11-13 02:02:23.38051+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7a43549b-4168-40f2-89f7-2ab64fff68d8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	25x25x1	M Filter 25x25x1	\N	2025-11-13 02:02:23.452118+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2b39139f-a727-4df8-ba03-f175baf40fa8	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Media	\N	25x25x2	M Filter 25x25x2	\N	2025-11-13 02:02:23.524106+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
160c153c-fa14-4e82-a6be-b695ac218d0c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	10x10x1	P Filter 10x10x1	\N	2025-11-13 02:02:23.595582+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
958b1518-d818-45ec-b51b-80393e7e6a16	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	10x10x2	P Filter 10x10x2	\N	2025-11-13 02:02:23.667695+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
70b8d63b-445a-49b3-80bc-e46c28d14c71	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	10x20x1	P Filter 10x20x1	\N	2025-11-13 02:02:23.738221+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1272ecd4-eacb-4645-b7ca-6e764a6086a2	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	10x20x2	P Filter 10x20x2	\N	2025-11-13 02:02:23.809344+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ae3b5754-f328-4b12-8697-3a57b105d515	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x12x1	P Filter 12x12x1	\N	2025-11-13 02:02:23.880134+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4cdcf465-cff9-4964-9ff8-2bfcf5e15e48	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x12x2	P Filter 12x12x2	\N	2025-11-13 02:02:23.950826+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ef5c49b0-697e-48ca-8426-5fdd2de43a2c	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x24x1	P Filter 12x24x1	\N	2025-11-13 02:02:24.022451+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7c83c77c-3e2a-4b75-b3ee-247c8bc77236	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x24x2	P Filter 12x24x2	\N	2025-11-13 02:02:24.094267+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
35ad042c-a04f-4744-a0a4-3759c439a46c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x20x2	M Filter 20x20x2	\N	2025-11-14 03:12:33.576467+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
52bc2997-ac79-49b0-bce4-fc8576b797f7	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x24x1	M Filter 20x24x1	\N	2025-11-14 03:12:33.643142+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
1affa825-59a0-47aa-97fa-461000d0209f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x24x2	M Filter 20x24x2	\N	2025-11-14 03:12:33.711799+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6db59cfe-5e31-4ef6-b278-fd46a1eb8152	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x25x1	M Filter 20x25x1	\N	2025-11-14 03:12:33.777027+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
644286f6-1b4c-4d95-87e3-b791b2320efb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x25x2	M Filter 20x25x2	\N	2025-11-14 03:12:33.844417+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f95db862-b6f9-4ede-a83f-de452b046e9d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x30x1	M Filter 20x30x1	\N	2025-11-14 03:12:33.91238+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ed258a86-4eee-411f-9d03-9c3675ea87dd	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	20x30x2	M Filter 20x30x2	\N	2025-11-14 03:12:33.979296+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
73bb4ebd-fdf3-42bd-97a6-5ff263fb2e80	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	24x24x1	M Filter 24x24x1	\N	2025-11-14 03:12:34.045973+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
086efbd3-2917-4971-9165-a445dde67f19	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	24x24x2	M Filter 24x24x2	\N	2025-11-14 03:12:34.121528+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
25e92bd6-3ce8-484e-9de5-22e4019193f4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	24x30x1	M Filter 24x30x1	\N	2025-11-14 03:12:34.187875+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b741d890-bb13-4885-bb81-b75a57c647d3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Media	\N	24x30x2	M Filter 24x30x2	\N	2025-11-14 03:12:34.253382+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
388d26e7-f93a-4c1d-b7a8-1ba81f7c90f1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x20x2	P Filter 16x20x2	\N	2025-11-14 03:12:35.726837+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5a1c02be-feea-43b9-9ff2-32fea21de985	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x24x1	P Filter 16x24x1	\N	2025-11-14 03:12:35.793165+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7a64d735-cf0a-4840-a41d-2f520e60a753	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x24x2	P Filter 16x24x2	\N	2025-11-14 03:12:35.859807+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a33fd508-7b5e-4f75-9af3-45774e7ef9a7	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x25x1	P Filter 16x25x1	\N	2025-11-14 03:12:35.991867+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7db1814e-c533-4ce3-b8a7-62f372d4e963	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x25x2	P Filter 16x25x2	\N	2025-11-14 03:12:36.059655+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
da6beaea-fc1b-49f7-9813-39827ca96749	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x30x1	P Filter 16x30x1	\N	2025-11-14 03:12:36.179877+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2324982d-72dd-4106-9d24-7b0b47ccdb70	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	16x30x2	P Filter 16x30x2	\N	2025-11-14 03:12:36.248147+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
32b5ef14-d8dc-48ca-a494-1bf231cf4b50	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x18x1	P Filter 18x18x1	\N	2025-11-14 03:12:36.315541+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2a8b8de2-0be8-4637-88e6-0207677d0aa4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x18x2	P Filter 18x18x2	\N	2025-11-14 03:12:36.382806+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5147b63d-b8ec-423a-a7aa-ee4316a5f661	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x24x1	P Filter 18x24x1	\N	2025-11-14 03:12:36.450331+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
06ba9cf4-ea93-410d-97e9-bed65b722e2e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x24x2	P Filter 18x24x2	\N	2025-11-14 03:12:36.517987+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
660c86c3-7c4f-4427-b44b-d35e87e015eb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x25x1	P Filter 18x25x1	\N	2025-11-14 03:12:36.584409+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
7bbbd605-e949-4b95-9e04-8c613b63e457	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	18x25x2	P Filter 18x25x2	\N	2025-11-14 03:12:36.650997+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bd294e9b-793c-4933-aaa1-3c49626ebe9a	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x20x1	P Filter 20x20x1	\N	2025-11-14 03:12:36.717837+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
65182343-d056-4633-a327-ddc1b92e3d7c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x20x2	P Filter 20x20x2	\N	2025-11-14 03:12:36.784006+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5cb7fca8-288c-40a8-a8e7-dd173b872fde	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x24x1	P Filter 20x24x1	\N	2025-11-14 03:12:36.850629+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c48c7c20-25cd-466e-8fd4-9c544d3af56e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x24x2	P Filter 20x24x2	\N	2025-11-14 03:12:36.91746+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5674f149-ca39-490c-a6e1-2d4151a9ca58	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x25x1	P Filter 20x25x1	\N	2025-11-14 03:12:36.986188+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
719941a8-b6b9-40c7-9f0a-92e3e45101dd	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x25x2	P Filter 20x25x2	\N	2025-11-14 03:12:37.053215+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f096ffb5-9155-49f6-8543-b172e51e47df	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x30x1	P Filter 20x30x1	\N	2025-11-14 03:12:37.120585+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
afb828c5-8e4a-4bd4-b72b-40055d4c1485	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	20x30x2	P Filter 20x30x2	\N	2025-11-14 03:12:37.186875+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
108c6b60-f12a-474a-a973-2d0df3f42768	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	24x24x1	P Filter 24x24x1	\N	2025-11-14 03:12:37.253049+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
fcd981d1-ac77-4aba-a0c9-980bb796fc79	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	24x24x2	P Filter 24x24x2	\N	2025-11-14 03:12:37.319426+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5803d5d7-b7e0-4a53-9494-6ae2d694ebc9	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	24x30x1	P Filter 24x30x1	\N	2025-11-14 03:12:37.38498+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
459fe90b-eb2d-4f33-85a5-efd2755786f2	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	24x30x2	P Filter 24x30x2	\N	2025-11-14 03:12:37.450343+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4b99a23d-172d-4c03-830d-c95c2ab6f9c2	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	25x25x1	P Filter 25x25x1	\N	2025-11-14 03:12:37.517147+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f79b250e-58a2-49c2-87e0-b6ee8b146b69	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Pleated	\N	25x25x2	P Filter 25x25x2	\N	2025-11-14 03:12:37.591587+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4e3e3764-dd3c-4f90-92bd-13ff89c86d3e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	10x10x1	T Filter 10x10x1	\N	2025-11-14 03:12:37.658511+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8998ed56-401d-43b2-a2e7-45df158fee5d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	10x10x2	T Filter 10x10x2	\N	2025-11-14 03:12:37.724541+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
4fcf3581-c298-476c-adce-72044b5302d4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	10x20x1	T Filter 10x20x1	\N	2025-11-14 03:12:37.795923+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d9e994fc-5c6e-442d-82e0-e1a0a30a676f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	10x20x2	T Filter 10x20x2	\N	2025-11-14 03:12:37.862594+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5ef83295-1c48-4094-b036-dde9653fc1a5	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	12x12x1	T Filter 12x12x1	\N	2025-11-14 03:12:37.929071+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
be98a9ff-5e81-4db9-9b6b-a7d9b500e3d8	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	12x12x2	T Filter 12x12x2	\N	2025-11-14 03:12:37.995295+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8ea858f1-41d0-43e8-af3a-dccb8d02e20c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	12x24x1	T Filter 12x24x1	\N	2025-11-14 03:12:38.06151+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
12301b84-b6ff-4046-a520-12540111f8b3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	12x24x2	T Filter 12x24x2	\N	2025-11-14 03:12:38.129271+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
73b119ec-eff1-4cf6-899b-b931f89659b1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x20x1	T Filter 14x20x1	\N	2025-11-14 03:12:38.195841+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
ee722391-9a7b-4577-b5f8-0c250afe2202	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x20x2	T Filter 14x20x2	\N	2025-11-14 03:12:38.263826+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e322d83c-df92-4869-a02f-4ececf39a416	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x24x1	T Filter 14x24x1	\N	2025-11-14 03:12:38.330728+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a80928a2-97e6-4553-91aa-1a93738ba5de	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x24x2	T Filter 14x24x2	\N	2025-11-14 03:12:38.397081+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
78ab5186-6f93-4d62-97fe-cb35560f67a3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x25x1	T Filter 14x25x1	\N	2025-11-14 03:12:38.464132+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
28dbc557-b2fe-4341-9985-2394994d03c4	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	14x25x2	T Filter 14x25x2	\N	2025-11-14 03:12:38.530516+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
0c39df61-d781-43a2-8207-fda36342bd63	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	15x20x1	T Filter 15x20x1	\N	2025-11-14 03:12:38.596944+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
9bdd06fb-1da8-4ec0-b542-1f47e31cde8d	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	15x20x2	T Filter 15x20x2	\N	2025-11-14 03:12:38.663717+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
817f1294-d60b-4d93-80f8-1f69800b8af9	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x16x1	T Filter 16x16x1	\N	2025-11-14 03:12:38.729288+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
82fa4f07-66f5-4534-8c9f-5070045d18a1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x16x2	T Filter 16x16x2	\N	2025-11-14 03:12:38.796723+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
098af750-824d-4a5c-ad49-faf29db4838b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x20x1	T Filter 16x20x1	\N	2025-11-14 03:12:38.862813+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5f5a75da-6662-4db0-ac9f-4b97b1dcff6b	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x20x2	T Filter 16x20x2	\N	2025-11-14 03:12:38.929181+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
dd5eb89b-a88e-4105-8a3a-76c8e721c162	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x24x1	T Filter 16x24x1	\N	2025-11-14 03:12:38.995199+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
981819ae-8b9b-4df8-a711-d2afae11233e	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x24x2	T Filter 16x24x2	\N	2025-11-14 03:12:39.062652+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
a022cfe0-114a-46ac-9798-243de084ecc1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x25x1	T Filter 16x25x1	\N	2025-11-14 03:12:39.127032+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b2544096-790b-4852-901d-79e4fd0e7b1f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x25x2	T Filter 16x25x2	\N	2025-11-14 03:12:39.193406+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b264eb2e-9fe3-42cc-84f4-2ec0350edbd3	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x30x1	T Filter 16x30x1	\N	2025-11-14 03:12:39.259561+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
c7be7232-da6d-4a58-8b22-cb7768229042	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	16x30x2	T Filter 16x30x2	\N	2025-11-14 03:12:39.325523+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
53fbac62-c709-4b49-97ef-997e1d3d850c	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x18x1	T Filter 18x18x1	\N	2025-11-14 03:12:39.392076+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f35ba513-7fa9-4d5c-9e6a-73bc24d7fa2f	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x18x2	T Filter 18x18x2	\N	2025-11-14 03:12:39.458268+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
109f1933-46b3-4076-b5da-3bc051c6a6f5	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x24x1	T Filter 18x24x1	\N	2025-11-14 03:12:39.524356+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3dfec6f9-6687-47d6-ab46-246ae8dd3ef6	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x24x2	T Filter 18x24x2	\N	2025-11-14 03:12:39.595948+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
5669e47e-37e9-4e72-8eee-723851770741	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x25x1	T Filter 18x25x1	\N	2025-11-14 03:12:39.662389+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
d6be08dc-9284-4106-a9eb-86f8b237ed27	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	18x25x2	T Filter 18x25x2	\N	2025-11-14 03:12:39.728487+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f23f86cc-d00a-4097-8998-9cd5ab1bd867	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x20x1	T Filter 20x20x1	\N	2025-11-14 03:12:39.794853+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e7b505c6-ceda-46a3-a125-a13cf4703a42	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x20x2	T Filter 20x20x2	\N	2025-11-14 03:12:39.860903+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
f308fb0e-1305-4e10-851a-1012d8e1bd91	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x24x1	T Filter 20x24x1	\N	2025-11-14 03:12:39.92816+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
702b87ec-67f5-493e-82ab-71c4d1a39805	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x24x2	T Filter 20x24x2	\N	2025-11-14 03:12:39.994032+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
eabf2097-4a9a-408d-85ef-87b96ed723b1	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x25x1	T Filter 20x25x1	\N	2025-11-14 03:12:40.062306+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
58806fa9-feea-495e-9e5d-6e19e45c3769	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x25x2	T Filter 20x25x2	\N	2025-11-14 03:12:40.131337+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
2dacc809-d827-486a-9ae8-94d1ebbe36d6	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x30x1	T Filter 20x30x1	\N	2025-11-14 03:12:40.198175+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
977d265b-84a5-4141-9106-a16f0cf59619	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	20x30x2	T Filter 20x30x2	\N	2025-11-14 03:12:40.266777+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
3aaf6e89-006e-40e1-ab84-ebf843889bcb	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	24x24x1	T Filter 24x24x1	\N	2025-11-14 03:12:40.333117+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
e2af3604-3235-40c9-9000-d7fc1eabfbef	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	24x24x2	T Filter 24x24x2	\N	2025-11-14 03:12:40.399867+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
bb66c3a8-48de-4cb0-a6b2-7a90b947d270	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	24x30x1	T Filter 24x30x1	\N	2025-11-14 03:12:40.466447+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
97b9a709-607f-445f-89ce-4f6b768eca67	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	24x30x2	T Filter 24x30x2	\N	2025-11-14 03:12:40.533764+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
b52e40c1-e628-4b33-b75a-30b7de83bdd0	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	25x25x1	T Filter 25x25x1	\N	2025-11-14 03:12:40.600744+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
399780c6-57c2-4ba0-a15d-800c92d6f6af	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	ce5c1985-6505-4b79-9e06-6726ab85f500	product	Throwaway	\N	25x25x2	T Filter 25x25x2	\N	2025-11-14 03:12:40.666677+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
8ba4e20c-1466-4fa9-9875-6ac5defacbd1	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	10x18x1	P Filter 10x18x1	\N	2025-11-14 23:43:07.001298+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
be080552-9d43-4beb-a46d-0bf21663f8f5	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	15.5x32.5x2	P Filter 15.5x32.5x2	\N	2025-11-17 15:17:55.050232+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
31bde08e-7ba1-40d5-a508-14389ecc010a	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x18x2	P Filter 12x18x2	\N	2025-11-17 15:17:55.120381+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
6ac465bb-89e2-40b1-a677-8c38767bab8d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	12x20x1	P Filter 12x20x1	\N	2025-11-17 15:17:55.185692+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
81f451d2-14e9-4bde-8d46-85c849510cc7	25b87fb2-7dc7-489b-a6aa-e99da73f4824	1e4fa7f8-7c43-4ec2-8512-30649a60b946	product	Pleated	\N	20x22x1	P Filter 20x22x1	\N	2025-11-17 15:22:34.2937+00	\N	\N	f	\N	\N	t	\N	\N	t	\N	\N	\N
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at, requested_ip) FROM stdin;
21ca6d63-54b6-4762-9bfe-7ee6b54761ba	1e4fa7f8-7c43-4ec2-8512-30649a60b946	$2b$10$yspgYPAb5oVTCR4.8Z4IR.kVXTkiqNSlvFscZOgJxU.hQ/sHcHQOW	2025-11-10 18:56:49.609	2025-11-13 14:50:30.284	2025-11-10 18:26:49.628	172.31.113.66
315dcd7c-287c-4568-a55a-40785a94c2fd	1e4fa7f8-7c43-4ec2-8512-30649a60b946	$2b$10$giMZFVNu150shKW17Xgs2.005X2qri/h90kSt2Vv/Q4yHZWg6AGjK	2025-11-13 15:20:30.417	2025-11-14 18:23:16.217	2025-11-13 14:50:30.434	172.31.72.66
16f4b6e1-3a70-452c-80fa-6f3137813013	1e4fa7f8-7c43-4ec2-8512-30649a60b946	$2b$10$3O.RC4I7hyIAxgpSmyiXb.eRbPnWw4Lz3R1mnOKy3y6Mmr9TyLR4O	2025-11-14 18:53:16.379	\N	2025-11-14 18:23:16.399	172.31.79.34
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.payments (id, invoice_id, amount, method, reference, received_at, notes, created_at) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.permissions (id, key, "group", label, description, created_at) FROM stdin;
perm-schedule-view-own	schedule.view_own	schedule	View Own Schedule	View your own schedule and assignments	2025-12-10 16:11:02.419935
perm-schedule-edit-own	schedule.edit_own	schedule	Edit Own Schedule	Modify your own schedule entries	2025-12-10 16:11:02.419935
perm-schedule-edit-team	schedule.edit_team	schedule	Edit Team Schedule	Modify schedule entries for team members	2025-12-10 16:11:02.419935
perm-jobs-view-assigned	jobs.view_assigned	jobs	View Assigned Jobs	View jobs assigned to you	2025-12-10 16:11:02.419935
perm-jobs-view-all	jobs.view_all	jobs	View All Jobs	View all jobs in the system	2025-12-10 16:11:02.419935
perm-jobs-create	jobs.create	jobs	Create Jobs	Create new jobs	2025-12-10 16:11:02.419935
perm-jobs-edit	jobs.edit	jobs	Edit Jobs	Edit existing jobs	2025-12-10 16:11:02.419935
perm-jobs-delete	jobs.delete	jobs	Delete Jobs	Delete jobs	2025-12-10 16:11:02.419935
perm-clients-view-basic	clients.view_basic	clients	View Clients	View basic client information	2025-12-10 16:11:02.419935
perm-clients-edit	clients.edit	clients	Edit Clients	Edit client information	2025-12-10 16:11:02.419935
perm-clients-delete	clients.delete	clients	Delete Clients	Delete clients	2025-12-10 16:11:02.419935
perm-pricing-view	pricing.view	pricing	View Pricing	View pricing and rates	2025-12-10 16:11:02.419935
perm-pricing-edit	pricing.edit	pricing	Edit Pricing	Edit pricing and rates	2025-12-10 16:11:02.419935
perm-profitability-view	profitability.view	pricing	View Profitability	View profit margins and reports	2025-12-10 16:11:02.419935
perm-quotes-create	quotes.create	billing	Create Quotes	Create quotes for clients	2025-12-10 16:11:02.419935
perm-quotes-approve	quotes.approve	billing	Approve Quotes	Approve quotes	2025-12-10 16:11:02.419935
perm-invoices-create	invoices.create	billing	Create Invoices	Create invoices	2025-12-10 16:11:02.419935
perm-invoices-payment	invoices.record_payment	billing	Record Payments	Record payments on invoices	2025-12-10 16:11:02.419935
perm-timesheets-track-own	timesheets.track_own	timesheets	Track Own Time	Track your own time entries	2025-12-10 16:11:02.419935
perm-timesheets-approve-team	timesheets.approve_team	timesheets	Approve Team Time	Approve timesheet entries for team	2025-12-10 16:11:02.419935
perm-reports-view-basic	reports.view_basic	reports	View Basic Reports	View basic operational reports	2025-12-10 16:11:02.419935
perm-reports-view-financial	reports.view_financial	reports	View Financial Reports	View financial reports and analytics	2025-12-10 16:11:02.419935
perm-users-manage	users.manage	admin	Manage Users	Manage team members and permissions	2025-12-10 16:11:02.419935
perm-settings-manage	settings.manage	admin	Manage Settings	Manage company settings	2025-12-10 16:11:02.419935
\.


--
-- Data for Name: recurring_job_phases; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.recurring_job_phases (id, series_id, order_index, frequency, "interval", occurrences, until_date) FROM stdin;
\.


--
-- Data for Name: recurring_job_series; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.recurring_job_series (id, company_id, location_id, base_summary, base_description, base_job_type, base_priority, default_technician_id, start_date, timezone, notes, is_active, created_by_user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.role_permissions (role_id, permission_id) FROM stdin;
role-technician	perm-schedule-view-own
role-technician	perm-schedule-edit-own
role-technician	perm-jobs-view-assigned
role-technician	perm-clients-view-basic
role-technician	perm-timesheets-track-own
role-lead-tech	perm-schedule-view-own
role-lead-tech	perm-schedule-edit-own
role-lead-tech	perm-schedule-edit-team
role-lead-tech	perm-jobs-view-assigned
role-lead-tech	perm-jobs-view-all
role-lead-tech	perm-clients-view-basic
role-lead-tech	perm-timesheets-track-own
role-lead-tech	perm-timesheets-approve-team
role-dispatcher	perm-schedule-view-own
role-dispatcher	perm-schedule-edit-own
role-dispatcher	perm-schedule-edit-team
role-dispatcher	perm-jobs-view-assigned
role-dispatcher	perm-jobs-view-all
role-dispatcher	perm-jobs-create
role-dispatcher	perm-jobs-edit
role-dispatcher	perm-clients-view-basic
role-dispatcher	perm-clients-edit
role-dispatcher	perm-pricing-view
role-dispatcher	perm-timesheets-track-own
role-dispatcher	perm-reports-view-basic
role-manager	perm-schedule-view-own
role-manager	perm-schedule-edit-own
role-manager	perm-schedule-edit-team
role-manager	perm-jobs-view-assigned
role-manager	perm-jobs-view-all
role-manager	perm-jobs-create
role-manager	perm-jobs-edit
role-manager	perm-jobs-delete
role-manager	perm-clients-view-basic
role-manager	perm-clients-edit
role-manager	perm-clients-delete
role-manager	perm-pricing-view
role-manager	perm-pricing-edit
role-manager	perm-profitability-view
role-manager	perm-quotes-create
role-manager	perm-quotes-approve
role-manager	perm-invoices-create
role-manager	perm-invoices-payment
role-manager	perm-timesheets-track-own
role-manager	perm-timesheets-approve-team
role-manager	perm-reports-view-basic
role-manager	perm-reports-view-financial
role-admin	perm-schedule-view-own
role-admin	perm-schedule-edit-own
role-admin	perm-schedule-edit-team
role-admin	perm-jobs-view-assigned
role-admin	perm-jobs-view-all
role-admin	perm-jobs-create
role-admin	perm-jobs-edit
role-admin	perm-jobs-delete
role-admin	perm-clients-view-basic
role-admin	perm-clients-edit
role-admin	perm-clients-delete
role-admin	perm-pricing-view
role-admin	perm-pricing-edit
role-admin	perm-profitability-view
role-admin	perm-quotes-create
role-admin	perm-quotes-approve
role-admin	perm-invoices-create
role-admin	perm-invoices-payment
role-admin	perm-timesheets-track-own
role-admin	perm-timesheets-approve-team
role-admin	perm-reports-view-basic
role-admin	perm-reports-view-financial
role-admin	perm-users-manage
role-admin	perm-settings-manage
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.roles (id, name, description, is_system_role, created_at, updated_at) FROM stdin;
role-technician	technician	Field technician with access to own schedule and assigned jobs	t	2025-12-10 16:11:02.419935	\N
role-lead-tech	lead_technician	Lead technician with limited team scheduling capabilities	t	2025-12-10 16:11:02.419935	\N
role-dispatcher	dispatcher	Dispatcher with scheduling, client, and job management access	t	2025-12-10 16:11:02.419935	\N
role-manager	manager	Manager with broad access except user/billing administration	t	2025-12-10 16:11:02.419935	\N
role-admin	admin	Administrator with full system access	t	2025-12-10 16:11:02.419935	\N
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.session (sid, sess, expire) FROM stdin;
vr8ABpUN-eijHiN4fiC02MUxEuiwp2v0	{"cookie": {"path": "/", "secure": true, "expires": "2025-12-26T16:21:35.725Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 2592000000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-07 00:24:05
UkNZDxYccC-1eWCNl1_oIvl5wKRdJBRO	{"cookie": {"path": "/", "secure": true, "expires": "2025-12-30T04:17:06.116Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 2592000000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-18 00:32:46
24rd-52MaX9adK-GZHlhRLUZtfKRJnRE	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-11T15:29:40.329Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-11 15:29:41
xfcPXRrPc4_sl5BP0KWCrkXslvYItQO4	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-11T15:26:18.684Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-11 15:31:03
gd70b6Rp-5c8_WMqM2h0rPQ_SLRR-tEG	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T15:10:09.073Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 2592000000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-23 05:00:29
sMLpo5fTeBnpoW62uuXMJ1qcrxTN3JpM	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-07T05:21:52.395Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "uTAgxcReD2tuYNyEH1BBJpkG"}	2026-01-07 05:21:53
jLOEkLT4_gRYBiZ5vF94BEGhpTc3c4ia	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-07T05:27:16.889Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "fzjrfRYeDAjyCirIDasHvmMK"}	2026-01-07 05:27:17
VtPFgVcXlYQ-n02s6zI552pAMKPy6e9K	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T03:09:14.318Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 03:09:15
oGinHfAfAzJ1Fiq87my57gN2bt-1ar5R	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-11T15:26:57.438Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-11 15:26:58
JYFE1LZTnaWzrmve35tIRvcRmSv0sDIZ	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T03:09:31.158Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 03:09:32
i2kRIoAApdwHXXn8aHYbry9svAO5eJur	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-11T15:30:42.964Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-11 15:30:43
dGpqaGKd502ZmYGLWTwZUEMHVA6ViQ3e	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T04:33:22.612Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 04:33:23
01l40qzEaXie6o983h3jtPwE5GSoj7kK	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T04:33:23.709Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 04:33:24
KgX7YHiEm073WB2JJ1xcA3dF0dlJbsiG	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T04:33:23.811Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 04:33:24
vcp_ikIpw4yDR0XYHrJhgzmXitRCbhhP	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T06:04:40.141Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 06:04:41
3foZAq9_AGZCebDs32GFZguWgOdRsvY-	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T06:04:49.451Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 06:04:50
RA3nvEX-8S_C8c4WgcjJu88VVTm4YYGt	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T13:08:32.230Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-12 13:08:33
puBzzfaJU0kYptTeovV0-JjQSku_vNjP	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-12T15:45:45.107Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "passport": {"user": "1e4fa7f8-7c43-4ec2-8512-30649a60b946"}}	2026-01-12 15:47:31
\.


--
-- Data for Name: subscription_plans; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.subscription_plans (id, name, display_name, stripe_price_id, monthly_price_cents, location_limit, is_trial, trial_days, sort_order, active, created_at, updated_at) FROM stdin;
7f67b72b-0852-4a44-b46a-9f121af9ed25	trial	Free Trial	\N	0	10	t	30	0	t	2025-11-20 01:42:41.217	2025-11-20 01:42:41.217
593ad240-c19f-4d7f-95d4-b1acb0ba74dd	silver	Silver	\N	4000	100	f	\N	1	t	2025-11-20 01:42:41.217	2025-11-20 01:42:41.217
6cfd8977-5888-42cd-8ef8-12506b3b6daf	gold	Gold	\N	7000	200	f	\N	2	t	2025-11-20 01:42:41.217	2025-11-20 01:42:41.217
51a8c894-d382-404a-a086-2697d55bc509	enterprise	Enterprise	\N	\N	999999	f	\N	3	t	2025-11-20 01:42:41.217	2025-11-20 01:42:41.217
\.


--
-- Data for Name: supplier_visit_details; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.supplier_visit_details (task_id, supplier_id, supplier_name_other, po_number, reconciled_at, reconciled_by_user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.suppliers (id, company_id, name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tasks (id, company_id, created_by_user_id, assigned_to_user_id, type, title, notes, status, closed_at, closed_by_user_id, scheduled_start_at, scheduled_end_at, all_day, checked_in_at, checked_out_at, job_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: technician_profiles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.technician_profiles (user_id, labor_cost_per_hour, billable_rate_per_hour, color, phone, note, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: technicians; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.technicians (id, company_id, name, user_id, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_permission_overrides; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.user_permission_overrides (id, user_id, permission_id, override, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.users (id, company_id, email, password, role, full_name, first_name, last_name, created_at, role_id, phone, status, use_custom_schedule, last_login_at, disabled) FROM stdin;
d7382674-b4f7-4689-8de9-fe178cc4dfcb	da832c38-414f-4ca0-8e50-cd910c6d3724	dannysabbouh@gmail.com	$2b$10$hP4ukbyt/QRQuo3SuxU0S.n0jOsLV4jEbGzEuJnsEeImkhGmJUMTS	owner	\N	\N	\N	2025-11-20 22:58:19.047	\N	\N	active	f	\N	f
ce5c1985-6505-4b79-9e06-6726ab85f500	3eb673b9-a6e8-4fc7-989a-de3c3e1bb1db	faboutanos@hotmail.com	$2b$10$hP4ukbyt/QRQuo3SuxU0S.n0jOsLV4jEbGzEuJnsEeImkhGmJUMTS	owner	\N	\N	\N	2025-11-20 22:58:19.047	\N	\N	active	f	\N	f
e43b044b-2a32-4ad7-979c-82d6bbb3627d	25b87fb2-7dc7-489b-a6aa-e99da73f4824	freezeflowai@gmail.com	$2b$10$hP4ukbyt/QRQuo3SuxU0S.n0jOsLV4jEbGzEuJnsEeImkhGmJUMTS	technician	Nadeem Samaha	Nadeem	Samaha	2025-11-21 04:42:04.908	role-lead-tech	9053928228	active	f	\N	f
1e4fa7f8-7c43-4ec2-8512-30649a60b946	25b87fb2-7dc7-489b-a6aa-e99da73f4824	service@samcor.ca	$2b$10$4BIEBWXHI.lYivgmVs6prOLI1n1ouMIrS3bk1/l/EOKttJiZXHHLC	owner	Nadeem Samaha	Nadeem	Samaha	2025-11-20 22:58:19.047	role-admin	9053928228	active	f	\N	f
\.


--
-- Data for Name: working_hours; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.working_hours (id, user_id, day_of_week, start_time, end_time, is_working, created_at, updated_at) FROM stdin;
\.


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: calendar_assignments calendar_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.calendar_assignments
    ADD CONSTRAINT calendar_assignments_pkey PRIMARY KEY (id);


--
-- Name: client_notes client_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_pkey PRIMARY KEY (id);


--
-- Name: client_parts client_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_audit_logs company_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_audit_logs
    ADD CONSTRAINT company_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: company_counters company_counters_company_id_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_counters
    ADD CONSTRAINT company_counters_company_id_unique UNIQUE (company_id);


--
-- Name: company_counters company_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_counters
    ADD CONSTRAINT company_counters_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_company_id_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_company_id_unique UNIQUE (company_id);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_user_id_unique UNIQUE (user_id);


--
-- Name: customer_companies customer_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_companies
    ADD CONSTRAINT customer_companies_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: invitation_tokens invitation_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitation_tokens
    ADD CONSTRAINT invitation_tokens_pkey PRIMARY KEY (id);


--
-- Name: invitation_tokens invitation_tokens_token_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitation_tokens
    ADD CONSTRAINT invitation_tokens_token_unique UNIQUE (token);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_unique UNIQUE (token);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: job_equipment job_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_equipment
    ADD CONSTRAINT job_equipment_pkey PRIMARY KEY (id);


--
-- Name: job_notes job_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_pkey PRIMARY KEY (id);


--
-- Name: job_parts job_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_parts
    ADD CONSTRAINT job_parts_pkey PRIMARY KEY (id);


--
-- Name: job_template_line_items job_template_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_template_line_items
    ADD CONSTRAINT job_template_line_items_pkey PRIMARY KEY (id);


--
-- Name: job_templates job_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_templates
    ADD CONSTRAINT job_templates_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: labor_entries labor_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.labor_entries
    ADD CONSTRAINT labor_entries_pkey PRIMARY KEY (id);


--
-- Name: location_equipment location_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_equipment
    ADD CONSTRAINT location_equipment_pkey PRIMARY KEY (id);


--
-- Name: location_pm_part_templates location_pm_part_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_pkey PRIMARY KEY (id);


--
-- Name: location_pm_plans location_pm_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_plans
    ADD CONSTRAINT location_pm_plans_pkey PRIMARY KEY (id);


--
-- Name: maintenance_records maintenance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_pkey PRIMARY KEY (id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_key_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_unique UNIQUE (key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: recurring_job_phases recurring_job_phases_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_phases
    ADD CONSTRAINT recurring_job_phases_pkey PRIMARY KEY (id);


--
-- Name: recurring_job_series recurring_job_series_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_series
    ADD CONSTRAINT recurring_job_series_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_unique UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: subscription_plans subscription_plans_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_name_unique UNIQUE (name);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: supplier_visit_details supplier_visit_details_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supplier_visit_details
    ADD CONSTRAINT supplier_visit_details_pkey PRIMARY KEY (task_id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: technician_profiles technician_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.technician_profiles
    ADD CONSTRAINT technician_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: technicians technicians_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.technicians
    ADD CONSTRAINT technicians_pkey PRIMARY KEY (id);


--
-- Name: user_permission_overrides user_permission_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: working_hours working_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.working_hours
    ADD CONSTRAINT working_hours_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_logs_timestamp; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_calendar_client_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_calendar_client_id ON public.calendar_assignments USING btree (client_id);


--
-- Name: idx_calendar_company_date; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_calendar_company_date ON public.calendar_assignments USING btree (company_id, year, month, day);


--
-- Name: idx_calendar_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_calendar_company_id ON public.calendar_assignments USING btree (company_id);


--
-- Name: idx_client_parts_client_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_client_parts_client_id ON public.client_parts USING btree (client_id);


--
-- Name: idx_client_parts_company; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_client_parts_company ON public.client_parts USING btree (company_id);


--
-- Name: idx_client_parts_part_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_client_parts_part_id ON public.client_parts USING btree (part_id);


--
-- Name: idx_clients_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_clients_company_id ON public.clients USING btree (company_id);


--
-- Name: idx_clients_company_inactive; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_clients_company_inactive ON public.clients USING btree (company_id, inactive) WHERE (inactive = false);


--
-- Name: idx_equipment_client_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_equipment_client_id ON public.equipment USING btree (client_id);


--
-- Name: idx_equipment_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_equipment_company_id ON public.equipment USING btree (company_id);


--
-- Name: idx_invitations_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invitations_company_id ON public.invitations USING btree (company_id);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);


--
-- Name: idx_invoice_lines_invoice_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invoice_lines_invoice_id ON public.invoice_lines USING btree (invoice_id);


--
-- Name: idx_invoices_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invoices_company_id ON public.invoices USING btree (company_id);


--
-- Name: idx_invoices_company_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invoices_company_status ON public.invoices USING btree (company_id, status);


--
-- Name: idx_invoices_job_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_invoices_job_id ON public.invoices USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_job_equipment_job_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_job_equipment_job_id ON public.job_equipment USING btree (job_id);


--
-- Name: idx_job_parts_job_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_job_parts_job_id ON public.job_parts USING btree (job_id);


--
-- Name: idx_job_templates_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_job_templates_company_id ON public.job_templates USING btree (company_id);


--
-- Name: idx_jobs_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_jobs_company_id ON public.jobs USING btree (company_id);


--
-- Name: idx_jobs_company_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_jobs_company_status ON public.jobs USING btree (company_id, status);


--
-- Name: idx_jobs_location_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_jobs_location_id ON public.jobs USING btree (location_id);


--
-- Name: idx_parts_company_active; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_parts_company_active ON public.parts USING btree (company_id, is_active) WHERE (is_active = true);


--
-- Name: idx_parts_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_parts_company_id ON public.parts USING btree (company_id);


--
-- Name: idx_users_company_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_company_id ON public.users USING btree (company_id);


--
-- Name: idx_users_company_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_company_status ON public.users USING btree (company_id, status) WHERE (status = 'active'::text);


--
-- Name: invoices_company_invoice_number_uq; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX invoices_company_invoice_number_uq ON public.invoices USING btree (company_id, invoice_number) WHERE (invoice_number IS NOT NULL);


--
-- Name: invoices_company_job_uq; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX invoices_company_job_uq ON public.invoices USING btree (company_id, job_id) WHERE (job_id IS NOT NULL);


--
-- Name: jobs_company_job_number_uq; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX jobs_company_job_number_uq ON public.jobs USING btree (company_id, job_number);


--
-- Name: audit_logs audit_logs_platform_admin_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_platform_admin_id_users_id_fk FOREIGN KEY (platform_admin_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_target_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_target_company_id_companies_id_fk FOREIGN KEY (target_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_target_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_target_user_id_users_id_fk FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: calendar_assignments calendar_assignments_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.calendar_assignments
    ADD CONSTRAINT calendar_assignments_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: calendar_assignments calendar_assignments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.calendar_assignments
    ADD CONSTRAINT calendar_assignments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: calendar_assignments calendar_assignments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.calendar_assignments
    ADD CONSTRAINT calendar_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_part_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: clients clients_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: clients clients_parent_company_id_customer_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_parent_company_id_customer_companies_id_fk FOREIGN KEY (parent_company_id) REFERENCES public.customer_companies(id) ON DELETE SET NULL;


--
-- Name: clients clients_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: company_audit_logs company_audit_logs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_audit_logs
    ADD CONSTRAINT company_audit_logs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_audit_logs company_audit_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_audit_logs
    ADD CONSTRAINT company_audit_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: company_counters company_counters_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_counters
    ADD CONSTRAINT company_counters_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_settings company_settings_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_settings company_settings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_companies customer_companies_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_companies
    ADD CONSTRAINT customer_companies_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invitation_tokens invitation_tokens_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitation_tokens
    ADD CONSTRAINT invitation_tokens_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: invitation_tokens invitation_tokens_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitation_tokens
    ADD CONSTRAINT invitation_tokens_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invitation_tokens invitation_tokens_used_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitation_tokens
    ADD CONSTRAINT invitation_tokens_used_by_user_id_users_id_fk FOREIGN KEY (used_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_customer_company_id_customer_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_company_id_customer_companies_id_fk FOREIGN KEY (customer_company_id) REFERENCES public.customer_companies(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: job_equipment job_equipment_equipment_id_location_equipment_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_equipment
    ADD CONSTRAINT job_equipment_equipment_id_location_equipment_id_fk FOREIGN KEY (equipment_id) REFERENCES public.location_equipment(id) ON DELETE CASCADE;


--
-- Name: job_equipment job_equipment_job_id_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_equipment
    ADD CONSTRAINT job_equipment_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: job_notes job_notes_assignment_id_calendar_assignments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_assignment_id_calendar_assignments_id_fk FOREIGN KEY (assignment_id) REFERENCES public.calendar_assignments(id) ON DELETE CASCADE;


--
-- Name: job_notes job_notes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: job_notes job_notes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_parts job_parts_equipment_id_location_equipment_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_parts
    ADD CONSTRAINT job_parts_equipment_id_location_equipment_id_fk FOREIGN KEY (equipment_id) REFERENCES public.location_equipment(id) ON DELETE SET NULL;


--
-- Name: job_parts job_parts_job_id_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_parts
    ADD CONSTRAINT job_parts_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: job_parts job_parts_product_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_parts
    ADD CONSTRAINT job_parts_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.parts(id) ON DELETE SET NULL;


--
-- Name: job_template_line_items job_template_line_items_product_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_template_line_items
    ADD CONSTRAINT job_template_line_items_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.parts(id) ON DELETE CASCADE;


--
-- Name: job_template_line_items job_template_line_items_template_id_job_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_template_line_items
    ADD CONSTRAINT job_template_line_items_template_id_job_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.job_templates(id) ON DELETE CASCADE;


--
-- Name: job_templates job_templates_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_templates
    ADD CONSTRAINT job_templates_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_calendar_assignment_id_calendar_assignments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_calendar_assignment_id_calendar_assignments_id_fk FOREIGN KEY (calendar_assignment_id) REFERENCES public.calendar_assignments(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_primary_technician_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_primary_technician_id_users_id_fk FOREIGN KEY (primary_technician_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_recurring_series_id_recurring_job_series_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_recurring_series_id_recurring_job_series_id_fk FOREIGN KEY (recurring_series_id) REFERENCES public.recurring_job_series(id) ON DELETE SET NULL;


--
-- Name: labor_entries labor_entries_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.labor_entries
    ADD CONSTRAINT labor_entries_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: labor_entries labor_entries_job_id_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.labor_entries
    ADD CONSTRAINT labor_entries_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: labor_entries labor_entries_technician_id_technicians_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.labor_entries
    ADD CONSTRAINT labor_entries_technician_id_technicians_id_fk FOREIGN KEY (technician_id) REFERENCES public.technicians(id) ON DELETE CASCADE;


--
-- Name: location_equipment location_equipment_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_equipment
    ADD CONSTRAINT location_equipment_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: location_pm_part_templates location_pm_part_templates_equipment_id_location_equipment_id_f; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_equipment_id_location_equipment_id_f FOREIGN KEY (equipment_id) REFERENCES public.location_equipment(id) ON DELETE SET NULL;


--
-- Name: location_pm_part_templates location_pm_part_templates_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: location_pm_part_templates location_pm_part_templates_product_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.parts(id) ON DELETE CASCADE;


--
-- Name: location_pm_plans location_pm_plans_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_plans
    ADD CONSTRAINT location_pm_plans_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: location_pm_plans location_pm_plans_recurring_series_id_recurring_job_series_id_f; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_plans
    ADD CONSTRAINT location_pm_plans_recurring_series_id_recurring_job_series_id_f FOREIGN KEY (recurring_series_id) REFERENCES public.recurring_job_series(id) ON DELETE SET NULL;


--
-- Name: maintenance_records maintenance_records_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: maintenance_records maintenance_records_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: maintenance_records maintenance_records_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: parts parts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: parts parts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: recurring_job_phases recurring_job_phases_series_id_recurring_job_series_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_phases
    ADD CONSTRAINT recurring_job_phases_series_id_recurring_job_series_id_fk FOREIGN KEY (series_id) REFERENCES public.recurring_job_series(id) ON DELETE CASCADE;


--
-- Name: recurring_job_series recurring_job_series_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_series
    ADD CONSTRAINT recurring_job_series_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: recurring_job_series recurring_job_series_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_series
    ADD CONSTRAINT recurring_job_series_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: recurring_job_series recurring_job_series_default_technician_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_series
    ADD CONSTRAINT recurring_job_series_default_technician_id_users_id_fk FOREIGN KEY (default_technician_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: recurring_job_series recurring_job_series_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.recurring_job_series
    ADD CONSTRAINT recurring_job_series_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: supplier_visit_details supplier_visit_details_reconciled_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supplier_visit_details
    ADD CONSTRAINT supplier_visit_details_reconciled_by_user_id_users_id_fk FOREIGN KEY (reconciled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_visit_details supplier_visit_details_supplier_id_suppliers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supplier_visit_details
    ADD CONSTRAINT supplier_visit_details_supplier_id_suppliers_id_fk FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: supplier_visit_details supplier_visit_details_task_id_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supplier_visit_details
    ADD CONSTRAINT supplier_visit_details_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: suppliers suppliers_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assigned_to_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_user_id_users_id_fk FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_closed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_closed_by_user_id_users_id_fk FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_job_id_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: technician_profiles technician_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.technician_profiles
    ADD CONSTRAINT technician_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: technicians technicians_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.technicians
    ADD CONSTRAINT technicians_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: technicians technicians_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.technicians
    ADD CONSTRAINT technicians_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_permission_overrides user_permission_overrides_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: user_permission_overrides user_permission_overrides_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: working_hours working_hours_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.working_hours
    ADD CONSTRAINT working_hours_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict NGrTVpnKfkMcY0J6rQQvETx3iWicTQVd3mwxuVC7niIQddo3mQuSMgDdUFCkesr

