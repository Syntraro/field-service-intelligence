--
-- PostgreSQL database dump
--

\restrict ofdgXw8LXDYGHycnQ1U4lvaFfZKDuBgamfam7rcZru0uMXCmGJlBJkiex04XphD

-- Dumped from database version 16.11 (f45eb12)
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

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: neondb_owner
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: neondb_owner
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO neondb_owner;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: neondb_owner
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO neondb_owner;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: neondb_owner
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


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
    scheduled_hour integer,
    auto_due_date boolean DEFAULT true NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    completion_notes text,
    job_number integer NOT NULL,
    scheduled_start_minutes integer,
    duration_minutes integer DEFAULT 60,
    scheduled_date date NOT NULL
);


ALTER TABLE public.calendar_assignments OWNER TO neondb_owner;

--
-- Name: client_locations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.client_locations (
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
    next_due text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    parent_company_id character varying,
    bill_with_parent boolean DEFAULT true NOT NULL,
    qbo_customer_id text,
    qbo_parent_customer_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone,
    version integer DEFAULT 0 NOT NULL,
    needs_details boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL
);


ALTER TABLE public.client_locations OWNER TO neondb_owner;

--
-- Name: COLUMN client_locations.next_due; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.client_locations.next_due IS 'Next PM due date - optional, only used for locations with PM scheduling';


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
    default_tax_rate numeric(5,2) DEFAULT 13.00 NOT NULL
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
    quantity numeric(12,4) DEFAULT 0 NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    line_subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    tax_code text,
    qbo_item_ref_id text,
    qbo_tax_code_ref_id text,
    metadata text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    line_item_type text DEFAULT 'service'::text NOT NULL,
    date date,
    technician_id character varying,
    tax_rate numeric(6,4) DEFAULT 0 NOT NULL,
    job_line_item_id character varying,
    unit_cost numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    line_total numeric(12,2) DEFAULT 0.00 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL
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
    notes_internal text,
    notes_customer text,
    qbo_invoice_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone,
    qbo_doc_number text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
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
    dirty boolean DEFAULT false NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    subtotal numeric(12,2) DEFAULT 0.00 NOT NULL,
    tax_total numeric(12,2) DEFAULT 0.00 NOT NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0.00 NOT NULL,
    balance numeric(12,2) DEFAULT 0.00 NOT NULL
);


ALTER TABLE public.invoices OWNER TO neondb_owner;

--
-- Name: items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.items (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    type text NOT NULL,
    name text,
    description text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tax_exempt boolean DEFAULT false,
    sku text,
    is_taxable boolean DEFAULT true,
    tax_code text,
    category text,
    is_active boolean DEFAULT true,
    qbo_item_id text,
    qbo_sync_token text,
    updated_at timestamp without time zone,
    cost numeric(12,2),
    markup_percent numeric(5,2),
    unit_price numeric(12,2)
);


ALTER TABLE public.items OWNER TO neondb_owner;

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
    user_id character varying NOT NULL,
    note_text text NOT NULL,
    image_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    job_id character varying NOT NULL
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
    quantity numeric(12,4) NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    equipment_label text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    unit_cost numeric(12,2),
    unit_price numeric(12,2)
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
    quantity numeric(12,4) DEFAULT 1 NOT NULL,
    unit_price_override numeric(12,2),
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
    updated_at timestamp without time zone,
    version integer DEFAULT 0 NOT NULL
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
    quantity_per_visit numeric(12,4) NOT NULL,
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
    due_date date NOT NULL,
    completed_at timestamp without time zone
);


ALTER TABLE public.maintenance_records OWNER TO neondb_owner;

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
    method text DEFAULT 'other'::text NOT NULL,
    reference text,
    received_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    amount numeric(12,2) NOT NULL
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
-- Name: supplier_locations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.supplier_locations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    supplier_id character varying NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    province text,
    postal_code text,
    country text,
    contact_name text,
    email text,
    phone text,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


ALTER TABLE public.supplier_locations OWNER TO neondb_owner;

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
    updated_at timestamp without time zone,
    supplier_location_id character varying
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
    updated_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL,
    qbo_vendor_id text,
    qbo_sync_token text,
    qbo_last_synced_at timestamp without time zone,
    qbo_sync_status text DEFAULT 'NOT_SYNCED'::text,
    qbo_sync_error text,
    email text,
    phone text,
    website text
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
    status text DEFAULT 'pending'::text NOT NULL,
    closed_at timestamp without time zone,
    closed_by_user_id character varying,
    scheduled_start_at timestamp without time zone,
    scheduled_end_at timestamp without time zone,
    all_day boolean DEFAULT false NOT NULL,
    checked_in_at timestamp without time zone,
    checked_out_at timestamp without time zone,
    job_id character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    client_id character varying,
    estimated_duration_minutes integer,
    actual_duration_minutes integer
);


ALTER TABLE public.tasks OWNER TO neondb_owner;

--
-- Name: COLUMN tasks.client_id; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.tasks.client_id IS 'Optional reference to client for task organization';


--
-- Name: COLUMN tasks.estimated_duration_minutes; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.tasks.estimated_duration_minutes IS 'Estimated time to complete task in minutes';


--
-- Name: COLUMN tasks.actual_duration_minutes; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.tasks.actual_duration_minutes IS 'Actual time taken, auto-calculated from checkedInAt to checkedOutAt';


--
-- Name: technician_profiles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.technician_profiles (
    user_id character varying NOT NULL,
    color text,
    phone text,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    labor_cost_per_hour numeric(8,2),
    billable_rate_per_hour numeric(8,2)
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
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: neondb_owner
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: neondb_owner
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.audit_logs (id, platform_admin_id, platform_admin_email, target_company_id, target_user_id, action, reason, details, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: calendar_assignments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.calendar_assignments (id, company_id, user_id, client_id, assigned_technician_ids, year, month, day, scheduled_hour, auto_due_date, completed, completion_notes, job_number, scheduled_start_minutes, duration_minutes, scheduled_date) FROM stdin;
\.


--
-- Data for Name: client_locations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.client_locations (id, company_id, user_id, company_name, location, address, city, province, postal_code, contact_name, email, phone, roof_ladder_code, notes, selected_months, inactive, next_due, created_at, parent_company_id, bill_with_parent, qbo_customer_id, qbo_parent_customer_id, qbo_sync_token, qbo_last_synced_at, version, needs_details, is_primary) FROM stdin;
bca65ea5-0d07-4473-823d-d812191b30ea	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	Basil Box	Yonge & Finch	5607 Yonge St	Toronto	On	M2M3S9	Peter Chiu	\N	\N	\N	\N	{}	f	9999-12-31T00:00:00.000Z	2026-01-04 01:04:44.528621+00	b6811484-8eab-4c26-9318-5782d68b0a22	t	\N	\N	\N	\N	0	f	t
c0e7b931-b848-4f20-b1ed-82dfb0f24e76	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	Basil Box	Ryerson	351 Yonge St	Toronto	Ontario	M5B1S1	Peter Chiu	\N	\N	\N	\N	{}	f	\N	2026-01-08 02:00:48.010958+00	b6811484-8eab-4c26-9318-5782d68b0a22	t	\N	\N	\N	\N	0	f	f
dec8dcf2-e4a2-40da-a09e-bc9603c78c6d	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	Basil Box	RBC Plaza	200 Bay St	Toronto	On	M2M3S9	Peter Chiu	\N	\N	\N	\N	{}	f	\N	2026-01-08 02:01:47.191862+00	b6811484-8eab-4c26-9318-5782d68b0a22	t	\N	\N	\N	\N	1	f	f
\.


--
-- Data for Name: client_notes; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.client_notes (id, company_id, client_id, user_id, note_text, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: client_parts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.client_parts (id, company_id, user_id, client_id, part_id, quantity) FROM stdin;
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.companies (id, name, address, city, province_state, postal_code, email, phone, trial_ends_at, subscription_status, subscription_plan, billing_interval, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, created_at, tax_name, default_tax_rate) FROM stdin;
158a0a89-50bb-4402-9a0c-f6233ae62af0	service's Company	\N	\N	\N	\N	service@samcor.ca	\N	2026-01-18 00:53:07.078	trial	\N	\N	\N	f	\N	\N	2026-01-04 00:53:07.112477	HST	13.00
617dac31-2c3d-49f7-bc49-6b1bfedd37d4	service's Company	\N	\N	\N	\N	service@samcor.ca	\N	2026-01-18 00:59:01.894	trial	\N	\N	\N	f	\N	\N	2026-01-04 00:59:01.931662	HST	13.00
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
d5fe4508-224e-434d-b071-fb254cf92564	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	10004	1001
\.


--
-- Data for Name: company_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.company_settings (id, company_id, user_id, company_name, address, city, province_state, postal_code, email, phone, calendar_start_hour, updated_at) FROM stdin;
\.


--
-- Data for Name: customer_companies; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customer_companies (id, company_id, name, legal_name, phone, email, billing_street, billing_city, billing_province, billing_postal_code, billing_country, is_active, qbo_customer_id, qbo_sync_token, qbo_last_synced_at, created_at, updated_at) FROM stdin;
b6811484-8eab-4c26-9318-5782d68b0a22	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	Basil Box	\N	\N	\N	\N	\N	\N	\N	\N	t	\N	\N	\N	2026-01-04 01:04:44.450915	\N
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.equipment (id, company_id, user_id, client_id, name, type, model_number, serial_number, location, notes, created_at) FROM stdin;
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
\.


--
-- Data for Name: invitations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invitations (id, company_id, email, role, token, status, expires_at, accepted_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoice_lines (id, invoice_id, line_number, description, quantity, unit_price, line_subtotal, tax_code, qbo_item_ref_id, qbo_tax_code_ref_id, metadata, created_at, updated_at, line_item_type, date, technician_id, tax_rate, job_line_item_id, unit_cost, tax_amount, line_total, source) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoices (id, company_id, location_id, customer_company_id, invoice_number, status, issue_date, due_date, currency, notes_internal, notes_customer, qbo_invoice_id, qbo_sync_token, qbo_last_synced_at, qbo_doc_number, is_active, created_at, updated_at, job_id, sent_at, viewed_at, work_description, client_message, show_quantity, show_unit_price, show_line_totals, show_line_items, show_balance, dirty, version, subtotal, tax_total, total, amount_paid, balance) FROM stdin;
\.


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.items (id, company_id, user_id, type, name, description, created_at, tax_exempt, sku, is_taxable, tax_code, category, is_active, qbo_item_id, qbo_sync_token, updated_at, cost, markup_percent, unit_price) FROM stdin;
73e8438a-cc14-4e4c-8921-46f84b684c0c	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	service	Labour		2026-01-09 00:55:42.06953+00	f	\N	t	\N	\N	t	\N	\N	2026-01-09 01:52:14.348	\N	\N	90.00
b057f304-3551-4118-8b7f-cd574315e48d	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	product	Thermostat	Digital	2026-01-08 21:16:56.422705+00	f	A421ABD	t	\N	\N	t	\N	\N	2026-01-09 01:54:53.728	184.00	100.00	368.00
6a42e3fe-72dc-4807-b137-ea74dabf3b2d	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	product	Equipment	\N	2026-01-09 02:55:07.866895+00	f	\N	t	\N	\N	t	\N	\N	\N	0.00	\N	0.00
\.


--
-- Data for Name: job_equipment; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_equipment (id, job_id, equipment_id, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: job_notes; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_notes (id, company_id, user_id, note_text, image_url, created_at, updated_at, job_id) FROM stdin;
30304c12-f7d3-4f3b-be3f-c2806474e1a4	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	note	\N	2026-01-08 19:03:06.765177	2026-01-08 19:03:06.765177	c4f78281-46cc-4c2c-a703-81f15a0efca3
25324be5-7485-48d2-8a8c-739a368ec9a6	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	replaced stuff	\N	2026-01-08 19:03:20.916523	2026-01-08 19:03:20.916523	c4f78281-46cc-4c2c-a703-81f15a0efca3
\.


--
-- Data for Name: job_parts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_parts (id, job_id, product_id, equipment_id, description, quantity, source, equipment_label, is_active, created_at, updated_at, sort_order, unit_cost, unit_price) FROM stdin;
\.


--
-- Data for Name: job_template_line_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_template_line_items (id, template_id, product_id, description_override, quantity, unit_price_override, sort_order, created_at) FROM stdin;
\.


--
-- Data for Name: job_templates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.job_templates (id, company_id, name, job_type, description, is_default_for_job_type, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.jobs (id, company_id, location_id, job_number, primary_technician_id, assigned_technician_ids, status, priority, job_type, summary, description, access_instructions, scheduled_start, scheduled_end, actual_start, actual_end, invoice_id, qbo_invoice_id, billing_notes, recurring_series_id, calendar_assignment_id, is_active, created_at, updated_at, version) FROM stdin;
c4f78281-46cc-4c2c-a703-81f15a0efca3	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	bca65ea5-0d07-4473-823d-d812191b30ea	10002	\N	\N	scheduled	medium	maintenance	Makeuup install	fix stuff	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-01-05 17:23:21.383926	2026-01-08 11:35:56.152	2
fa67609e-80ce-4e84-bacd-665419c47a66	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	bca65ea5-0d07-4473-823d-d812191b30ea	10001	\N	\N	scheduled	medium	maintenance	Preventive Maintenance	insert stuff	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-01-05 17:22:38.63128	2026-01-08 13:35:50.169	1
f65db274-bde8-462a-a279-75f0412a5950	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	dec8dcf2-e4a2-40da-a09e-bc9603c78c6d	10003	\N	\N	scheduled	medium	maintenance	Preventive Maintenance	dsfasd	sdafsadf	2026-01-08 11:15:00	2026-01-08 11:15:00	\N	\N	\N	\N	sdfafsda	\N	\N	t	2026-01-08 16:16:12.144561	\N	0
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
\.


--
-- Data for Name: maintenance_records; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.maintenance_records (id, company_id, user_id, client_id, due_date, completed_at) FROM stdin;
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at, requested_ip) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.payments (id, invoice_id, method, reference, received_at, notes, created_at, amount) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.permissions (id, key, "group", label, description, created_at) FROM stdin;
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
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.roles (id, name, description, is_system_role, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.session (sid, sess, expire) FROM stdin;
9Gvk4FFgiZN-3StPiHkib4MhWo0Oz9ue	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:09:53.315Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:09:54
TgBxdNiQDNimde55JuVK2ANb-lGZ85Wm	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:03:23.361Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "NuenPMSFiF0vEgbMYQMxNEHu"}	2026-01-18 01:03:24
b2c5TgWo2VFE2s3wNYqQqB5BiGw0u1xh	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T00:56:26.353Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 00:57:34
w4sAXzs1Vo4oWpby3450RYsf0mVkvF3y	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:09:53.316Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:09:54
hDIHMeOok1ZUWXcKzwsdnljWamsOS5y0	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T17:38:27.935Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 17:38:29
4uwJA0PNxXSYazQHmPzr0R-BNpDTTIm2	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:39:25.258Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:39:26
1VxL-uuMQJgtbySOlFbIowc6VtwQk5em	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:28:09.097Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:28:10
0D0JFV9nYcdlJkFVD2JmD4oFjEd1yONO	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:28:02.510Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:28:03
GbIcmTq2q69qGC-gUBuhi7148D1w8Cie	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:28:09.171Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:28:10
Ti4_HR7cj9nEX1rH_ZC5YFShXiYMQEuc	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:28:09.198Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:28:10
kKcplVCIu_FbwUosJjMRykNNWbTQG-6U	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T19:45:05.104Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 19:45:06
-B1WsEzRJjAOFP6azd-9lcTr8_lpf2_t	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:03:17.495Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-18 01:03:19
tDMitzU8DGW38bvKLwrCMevrXXOB_x4k	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T19:45:10.901Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 19:45:11
YoUXy-5CLHVexjO-EKqkz2pbfflYq0rm	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T19:45:10.905Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 19:45:11
i9Q5_e4CaQ_eCJJdWdFPWVyTV8HGK8Vk	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:30:17.881Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "w5OXL-DOAtBMJjc-TNCWgMbQ"}	2026-01-19 21:30:19
l-pzoQj91uZlDuEoJJCJ_UiaHk6FAYNf	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-18T01:29:49.244Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "OJDboZoXf1Hsp-iZcY-qlmcy"}	2026-01-18 01:29:50
sLW--kM0Lu5-Y-QpFVZrhFKv_m4MDRJd	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T19:45:10.920Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 19:45:16
Bal_pAy6bOopGeY9wKGp8IAF2XDQL3YU	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:00:28.557Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:00:29
ILwqqrfFISWOXtXSzTMiWhi7EXbNWD2X	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:00:35.101Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:00:36
Au6xIaNrgFv5q_dvOC9PPsTQ3dyr_BHV	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:00:35.204Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:00:36
J00O2nRjx3_Zs_AEi4FJg61I3KjYKh0F	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:04:15.297Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "okJSb3toRG_ZCg2YYKPKzRGg"}	2026-01-19 21:04:16
ET1bjmaRLq9_24xMjI6BzFYg9qegiX2z	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:11:07.061Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "RrFQazbUzdVpsisBxuojKEVC"}	2026-01-19 21:11:08
pJJmYwhjnKTjM9W81iOamX-MalvEjAUi	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:39:34.318Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:39:35
yl1DQnroR9_7u7lkoJ7Hrz31kBQ494L6	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:30:02.456Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:30:03
Py4e6dbxe9REMJfvBI7DkDFX6hxRFWfb	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:30:03.006Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:30:04
v5QzRzORuV-vig8jXHEZnq_98ZqXQeC_	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:30:03.017Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:30:04
CxNmyrJYjM1U44iAlmIjXnM79fALLXDW	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:30:03.018Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:30:04
Dv0xw_ZjlkUvdNQV4OP-SJ-0Q8FJgzV-	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:39:34.323Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:39:35
CbvYCGlCbp48q6-AZtyi9eu2jFCgF8qa	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:39:34.326Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 21:39:35
4OHNSpQQsIObKmZbajY4PbUfSYSWA-i2	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T21:23:47.515Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "KgR8r6hOV3CWuUfh0zHlSYWl"}	2026-01-22 21:23:48
xMs82xuLB9ioTTtL84gtsKM6e6CBlHJW	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T21:25:11.524Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-22 21:25:12
wV88jMzlk_2ay6VZBU3GFVDzLGkglwri	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T02:51:37.503Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "iF5I7eR8QZn9eo8n3DNc4Iek"}	2026-01-20 02:51:38
3QKU8OwYis32hl00gby3giHbE5fKS8sO	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T02:48:44.775Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-20 02:48:50
4zUVwMbwLvARatcjeL5sPuNe4Oo_Sk1W	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T22:00:45.458Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "k1ZIZ0gaTaw5HpliraL8aJDh"}	2026-01-19 22:04:44
d-Fq7JxR_lvFiceMyvam0mijOJ__ciWE	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T22:04:02.448Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "5gY2PefHPl40su_jTipqVhvh"}	2026-01-19 22:04:03
ovJnxmCip6UYSPGtByx3tPo7ytZXBnB2	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T23:35:41.262Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 23:35:49
oIDDWBP3QO1Aa_f9Q9HPoJgw2Ju1ncW0	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T22:00:30.060Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-19 22:00:33
d_KbPJgX1xN3_k8nB7WHKZRV_--8eZur	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T21:43:19.715Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "PwPyJvwDtutDTiWA8CJ1AYB7"}	2026-01-19 21:44:43
v8gAVMglLzdB6cC7wpV1zo_X6HZj54qm	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-19T23:36:56.096Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "-gSNcFckBLqbz--9orXGXQn6"}	2026-01-19 23:44:43
rBdGvoI8OrOUpVjYvGEcQ-nWKm1kJQyb	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T21:40:04.838Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-20 21:40:05
EX2LlBXJk0CBLdf5exsnq2PZJ0XnGjDr	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T21:40:11.458Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-20 21:40:12
6LEl7SJYzHe8gQazjyPBUYSZHkFup_hq	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T21:40:11.460Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-20 21:40:12
jq2dDxN2OpU9akPexWXJAKz-riOYugcA	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-20T21:40:11.462Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-20 21:40:15
x4Y1j7JsAuT2bgvoshIlwfvImrF2BUP6	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:58:16.990Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-21 00:58:19
bCHB050-SHABLL-ZRw-n32BG_naCRd37	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:58:11.110Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-21 00:58:12
orHP8LRb9zRNQKbElwPOpIdgYqr7kgw3	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:58:16.960Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-21 00:58:17
hadTjdj1rV-hFVGmLSb381Q8cxOxAJ8R	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:48:09.891Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-21 00:48:10
lrDr2VRXwvHp8shIZ-g4NcBce7v_gf8I	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:48:16.131Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-21 00:48:17
5kBKhHI96JPlSTGaDHAMNxTQxesqyaQW	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:48:16.133Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209599999}}	2026-01-21 00:48:17
SXMH2iLS9-AbIEBiGFl8BsBFqPIYtsUG	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:50:46.751Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "_zhsu1zuBgW9ku2j-7FAJ_ej"}	2026-01-21 00:50:47
8aw9-KvQIJEDsjkoMiVjGO6XuGX48PDE	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T00:58:26.659Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "I03TDFWNQ0GN6oCASMmJPgBQ"}	2026-01-21 00:58:27
jY_Vh6-8i_lxUUhhQ0BMrzFh6UDQP2J8	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T18:23:36.254Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "JgqJmGvkhsorE0Z0tSANeVut"}	2026-01-21 18:23:37
nzN1tUgFYJiTWJGBinI4S7AdU_PZB22s	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T21:15:22.227Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "o0K1QVSF3QcX8qsb6WGY_dph"}	2026-01-22 21:19:41
E4lRrFSpUc3O-oWOxZZMYayrLaaxMjIV	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T20:30:33.677Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "BtJ8WW2en_mvKxZxYSh9Z3zU"}	2026-01-21 20:30:34
tzTQpaLaCXFD6iZejpXt9aacZXmCStCi	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-21T21:20:14.946Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "YvPDZDDH7mrhsvwPzR7gzOUW"}	2026-01-21 21:20:15
dtymzaw_nnQsDCf_snqK0Tecsrz7nUhz	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T21:25:03.393Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}}	2026-01-22 21:25:13
3fjiLy69ELq9wvCFVPvUShXdGmrrJMQz	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-23T01:27:24.059Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "QHRBy8DX2CEuZAegG5swDTSg"}	2026-01-23 01:35:16
MJdXrLtl0A40sW0vYUt1tFbjbF01aHKx	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-23T03:00:16.173Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "passport": {"user": "78b16ede-98ec-4bb4-a0f1-8f035b79787d"}, "csrfSecret": "zHOihAaSmlFTRizbFopPZaBi"}	2026-01-23 12:37:08
CebHsQ8yTy8krbWU7Jf82FQXZ1NdGOZr	{"cookie": {"path": "/", "secure": false, "expires": "2026-01-22T21:25:19.377Z", "httpOnly": true, "sameSite": "lax", "originalMaxAge": 1209600000}, "csrfSecret": "8S4JmEyksmP9nNdjbYwsMX4N"}	2026-01-22 21:25:20
\.


--
-- Data for Name: subscription_plans; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.subscription_plans (id, name, display_name, stripe_price_id, monthly_price_cents, location_limit, is_trial, trial_days, sort_order, active, created_at, updated_at) FROM stdin;
4ad12dc3-e7af-4e29-9dd2-77aa54976a45	trial	Free Trial	\N	0	10	t	\N	0	t	2026-01-04 01:03:05.811695	2026-01-04 01:03:05.811695
\.


--
-- Data for Name: supplier_locations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.supplier_locations (id, company_id, supplier_id, name, address, city, province, postal_code, country, contact_name, email, phone, is_primary, is_active, created_at, updated_at) FROM stdin;
a7b4466c-9ee2-494c-b024-49c68b00aa88	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	57062ef2-d988-4d25-b2ad-e4a516d1dfab	Markham	35 Riviera Drive	Markham							t	t	2026-01-07 19:14:05.370827	2026-01-07 19:14:05.336
984612d4-d095-4c77-aed7-7bdcad18b433	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	57062ef2-d988-4d25-b2ad-e4a516d1dfab	Vaughan	20 Courtland Ave	Vaughan	On	L4K5B3	Canada				f	t	2026-01-07 19:18:39.989992	2026-01-07 19:18:39.957
d4388083-8ba0-42fe-af12-873b933774de	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	57062ef2-d988-4d25-b2ad-e4a516d1dfab	Barrie	154 Reid Rd	Barrie	On	L4N6L2	Canada			7057193477	f	t	2026-01-07 19:24:53.575268	2026-01-07 19:24:53.541
\.


--
-- Data for Name: supplier_visit_details; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.supplier_visit_details (task_id, supplier_id, supplier_name_other, po_number, reconciled_at, reconciled_by_user_id, created_at, updated_at, supplier_location_id) FROM stdin;
cbf14120-abe1-4ea2-92ee-666208513368	\N	\N	\N	\N	\N	2026-01-07 19:56:05.04356	\N	\N
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.suppliers (id, company_id, name, created_at, updated_at, is_active, qbo_vendor_id, qbo_sync_token, qbo_last_synced_at, qbo_sync_status, qbo_sync_error, email, phone, website) FROM stdin;
a4794657-704c-4f83-aa2e-8c7949a29a25	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	United Refrigeration	2026-01-07 18:44:04.134499	2026-01-07 18:44:04.1	t	\N	\N	\N	NOT_SYNCED	\N	\N	\N	\N
57062ef2-d988-4d25-b2ad-e4a516d1dfab	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	Master Group	2026-01-07 18:44:30.676185	2026-01-07 18:44:30.642	t	\N	\N	\N	NOT_SYNCED	\N	\N	\N	\N
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.tasks (id, company_id, created_by_user_id, assigned_to_user_id, type, title, notes, status, closed_at, closed_by_user_id, scheduled_start_at, scheduled_end_at, all_day, checked_in_at, checked_out_at, job_id, created_at, updated_at, client_id, estimated_duration_minutes, actual_duration_minutes) FROM stdin;
a2a9e91e-fd75-4bba-9c30-a7fcb676de88	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	SUPPLIER_VISIT	motor	sdafasdfsdaf	completed	2026-01-07 21:18:15.606	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 20:21:19.791144	\N	\N	\N	\N
cbf14120-abe1-4ea2-92ee-666208513368	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	SUPPLIER_VISIT	motor	notes go here	completed	2026-01-07 22:02:18.872	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 19:56:05.04356	\N	\N	\N	\N
e69ce03d-8a82-4b4a-97b8-a0e8be1779f8	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	GENERAL	pick up motor	\N	pending	\N	\N	\N	\N	f	\N	\N	\N	2026-01-07 00:24:30.276482	\N	\N	\N	\N
ac76c41b-d3ea-4cda-982e-d6bc3cc981f4	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	GENERAL	pay visa	\N	pending	\N	\N	\N	\N	f	\N	\N	\N	2026-01-07 00:23:36.750197	\N	\N	\N	\N
dc342d3f-b416-48ac-941c-c49c8b083361	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	GENERAL	pick up parts	\N	pending	\N	\N	\N	\N	f	\N	\N	\N	2026-01-06 22:05:36.679203	\N	\N	\N	\N
a9fe1e22-dd90-4330-bfd8-c76005de5079	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	SUPPLIER_VISIT	motor	dsfsdafsdaf	completed	2026-01-07 21:18:09.078	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 20:22:09.618061	\N	\N	\N	\N
b24d97da-a094-4aed-a0f8-3b7c33c1902d	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	SUPPLIER_VISIT	motor	dsfsdafsdaf	completed	2026-01-07 21:18:11.265	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 20:21:53.069975	\N	\N	\N	\N
ac72b484-f37a-405c-b09a-b1e402cb0611	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	GENERAL	motor	sdafasdfsdaf	completed	2026-01-07 21:18:12.745	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 20:21:37.304449	\N	\N	\N	\N
40220827-83f0-4be4-aeef-9d9f4e00b9bd	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	SUPPLIER_VISIT	motor	sdafasdfsdaf	completed	2026-01-07 21:18:13.827	78b16ede-98ec-4bb4-a0f1-8f035b79787d	\N	\N	f	\N	\N	\N	2026-01-07 20:21:31.504962	\N	\N	\N	\N
7f34de86-0d81-4918-928c-754e944ac032	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	78b16ede-98ec-4bb4-a0f1-8f035b79787d	78b16ede-98ec-4bb4-a0f1-8f035b79787d	GENERAL	appointment	\N	pending	\N	\N	\N	\N	f	\N	\N	\N	2026-01-07 13:07:52.751425	\N	\N	\N	\N
\.


--
-- Data for Name: technician_profiles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.technician_profiles (user_id, color, phone, note, created_at, updated_at, labor_cost_per_hour, billable_rate_per_hour) FROM stdin;
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
78b16ede-98ec-4bb4-a0f1-8f035b79787d	617dac31-2c3d-49f7-bc49-6b1bfedd37d4	service@samcor.ca	$2b$10$IWb9kOJ.eMRWe5fcseqfX.ABIyyaaCpJbP2sxpjKTvJ8UDZFKsHUO	admin	\N	\N	\N	2026-01-04 00:59:02.116228	\N	\N	active	f	\N	f
\.


--
-- Data for Name: working_hours; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.working_hours (id, user_id, day_of_week, start_time, end_time, is_working, created_at, updated_at) FROM stdin;
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: neondb_owner
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 1, false);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: neondb_owner
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


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
-- Name: client_locations clients_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_locations
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
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


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
-- Name: supplier_locations supplier_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supplier_locations
    ADD CONSTRAINT supplier_locations_pkey PRIMARY KEY (id);


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
-- Name: invoices_company_invoice_number_uq; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX invoices_company_invoice_number_uq ON public.invoices USING btree (company_id, invoice_number) WHERE (invoice_number IS NOT NULL);


--
-- Name: invoices_company_job_uq; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX invoices_company_job_uq ON public.invoices USING btree (company_id, job_id) WHERE (job_id IS NOT NULL);


--
-- Name: job_notes_company_job_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX job_notes_company_job_idx ON public.job_notes USING btree (company_id, job_id);


--
-- Name: job_notes_job_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX job_notes_job_id_idx ON public.job_notes USING btree (job_id);


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
    ADD CONSTRAINT calendar_assignments_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT client_notes_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT client_parts_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_part_id_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_part_id_items_id_fk FOREIGN KEY (part_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: client_parts client_parts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_parts
    ADD CONSTRAINT client_parts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: client_locations clients_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT clients_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: client_locations clients_parent_company_id_customer_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT clients_parent_company_id_customer_companies_id_fk FOREIGN KEY (parent_company_id) REFERENCES public.customer_companies(id) ON DELETE SET NULL;


--
-- Name: client_locations clients_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.client_locations
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
    ADD CONSTRAINT equipment_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT invoices_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
-- Name: job_notes job_notes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: job_notes job_notes_job_id_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_notes
    ADD CONSTRAINT job_notes_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT job_parts_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.items(id) ON DELETE SET NULL;


--
-- Name: job_template_line_items job_template_line_items_product_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.job_template_line_items
    ADD CONSTRAINT job_template_line_items_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.items(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT jobs_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT location_equipment_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


--
-- Name: location_pm_part_templates location_pm_part_templates_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


--
-- Name: location_pm_part_templates location_pm_part_templates_product_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_part_templates
    ADD CONSTRAINT location_pm_part_templates_product_id_parts_id_fk FOREIGN KEY (product_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: location_pm_plans location_pm_plans_location_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.location_pm_plans
    ADD CONSTRAINT location_pm_plans_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


--
-- Name: maintenance_records maintenance_records_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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
-- Name: items parts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT parts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: items parts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
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
    ADD CONSTRAINT recurring_job_series_location_id_clients_id_fk FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE CASCADE;


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

\unrestrict ofdgXw8LXDYGHycnQ1U4lvaFfZKDuBgamfam7rcZru0uMXCmGJlBJkiex04XphD

