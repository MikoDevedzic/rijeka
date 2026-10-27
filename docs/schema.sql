-- Rijeka — database schema (public), exported from the running instance
-- with pg_dump --schema-only --no-owner --no-privileges --schema=public.
--
-- Apply to a fresh Supabase project (SQL editor, or psql against the
-- project's connection string). Supabase provides the auth schema, the
-- pgcrypto/uuid extensions and the `authenticated` role this file relies on.
-- Then run the auth trigger at the bottom so every sign-up gets a profile.
--
-- Regenerate after a migration:  backend/scripts/export_schema.sh
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: cashflow_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cashflow_type AS ENUM (
    'COUPON',
    'PRINCIPAL',
    'FEE',
    'REBATE',
    'NOTIONAL_EXCHANGE',
    'AMORTIZATION'
);


--
-- Name: chat_can_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_can_read(p_room uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.chat_room_members
        WHERE room_id = p_room AND user_id = auth.uid() AND status = 'JOINED'
    ) OR EXISTS (
        SELECT 1 FROM public.firm_members me
        JOIN public.chat_room_members m ON m.firm_id = me.firm_id
        WHERE me.user_id = auth.uid() AND me.role = 'COMPLIANCE'
          AND m.room_id = p_room AND m.status IN ('JOINED', 'LEFT')
    )
$$;


--
-- Name: chat_can_see(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_can_see(p_room uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT public.chat_can_read(p_room) OR EXISTS (
        SELECT 1 FROM public.chat_room_members
        WHERE room_id = p_room AND user_id = auth.uid() AND status = 'INVITED'
    )
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  proposed_id TEXT;
  final_id    TEXT;
  counter     INT := 2;
BEGIN
  proposed_id := UPPER(SPLIT_PART(NEW.email, '@', 1));
  proposed_id := REGEXP_REPLACE(proposed_id, '[^A-Z.]', '.', 'g');
  proposed_id := REGEXP_REPLACE(proposed_id, '\.+', '.', 'g');
  proposed_id := BTRIM(proposed_id, '.');

  final_id := proposed_id;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE trader_id = final_id) LOOP
    final_id := proposed_id || '_' || counter;
    counter  := counter + 1;
  END LOOP;

  INSERT INTO public.profiles (id, trader_id, role, email)
  VALUES (NEW.id, final_id, coalesce(NEW.raw_user_meta_data->>'role', 'viewer'), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;


--
-- Name: my_firm_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_firm_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT firm_id FROM public.firm_members WHERE user_id = auth.uid()
$$;


--
-- Name: sync_role_to_user_metadata(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_role_to_user_metadata() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


--
-- Name: trade_events_assign_seq(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trade_events_assign_seq() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.event_seq IS NULL THEN
    NEW.event_seq := (
      SELECT COALESCE(MAX(event_seq), 0) + 1
      FROM public.trade_events
      WHERE trade_id = NEW.trade_id
    );
  END IF;
  IF NEW.tx_time IS NULL THEN
    NEW.tx_time := now();
  END IF;
  IF NEW.valid_time IS NULL THEN
    NEW.valid_time := NEW.effective_date::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trade_events_reject_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trade_events_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'trade_events is append-only. Use a new event (AMENDED, CANCELLED, etc.) instead of UPDATE/DELETE.';
END;
$$;


--
-- Name: validate_embedded_options(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_embedded_options(opts jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  e JSONB;
BEGIN
  IF jsonb_typeof(opts) <> 'array' THEN
    RETURN FALSE;
  END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(opts)
  LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN FALSE; END IF;
    IF NOT (e ? 'type') OR NOT (e ? 'direction') THEN RETURN FALSE; END IF;
    IF e->>'type' NOT IN ('CAP', 'FLOOR') THEN RETURN FALSE; END IF;
    IF e->>'direction' NOT IN ('BUY', 'SELL') THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bloomberg_ticker_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bloomberg_ticker_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curve_id text NOT NULL,
    tenor text NOT NULL,
    ticker text NOT NULL,
    field text DEFAULT 'PX_LAST'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cap_sabr_params; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_sabr_params (
    id bigint NOT NULL,
    valuation_date date NOT NULL,
    cap_tenor_y double precision NOT NULL,
    caplet_expiry_y double precision NOT NULL,
    alpha double precision,
    rho double precision,
    nu double precision,
    beta double precision DEFAULT 0 NOT NULL,
    atm_vol_bp double precision,
    fit_rmse_bp double precision,
    source text DEFAULT 'AUTO'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT cap_sabr_params_source_check CHECK ((source = ANY (ARRAY['AUTO'::text, 'MANUAL'::text, 'TABLE'::text])))
);


--
-- Name: cap_sabr_params_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cap_sabr_params_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cap_sabr_params_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cap_sabr_params_id_seq OWNED BY public.cap_sabr_params.id;


--
-- Name: cap_vol_surface; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_vol_surface (
    id bigint NOT NULL,
    valuation_date date NOT NULL,
    cap_tenor_y double precision NOT NULL,
    strike_spread_bp integer NOT NULL,
    is_atm boolean DEFAULT false NOT NULL,
    flat_vol_bp double precision NOT NULL,
    ticker text,
    source text DEFAULT 'BLOOMBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    strike_pct numeric(10,6),
    user_id uuid NOT NULL,
    CONSTRAINT cap_vol_surface_source_check CHECK ((source = ANY (ARRAY['BLOOMBERG'::text, 'MANUAL'::text, 'INTERP'::text, 'IMPORT'::text])))
);


--
-- Name: cap_vol_surface_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cap_vol_surface_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cap_vol_surface_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cap_vol_surface_id_seq OWNED BY public.cap_vol_surface.id;


--
-- Name: cashflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    leg_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    payment_date date NOT NULL,
    fixing_date date,
    currency text NOT NULL,
    notional numeric(24,6),
    rate numeric(12,8),
    dcf numeric(10,8),
    amount numeric(24,6) NOT NULL,
    amount_override numeric(24,6),
    is_overridden boolean DEFAULT false NOT NULL,
    status text DEFAULT 'PROJECTED'::text NOT NULL,
    cashflow_hash text,
    settlement_hash text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone,
    last_modified_by uuid,
    cashflow_type public.cashflow_type DEFAULT 'COUPON'::public.cashflow_type NOT NULL,
    user_id uuid NOT NULL,
    event_id uuid,
    snapshot_id uuid,
    computed_as_of date,
    CONSTRAINT cashflows_payment_check CHECK ((payment_date >= period_end)),
    CONSTRAINT cashflows_period_check CHECK ((period_end > period_start)),
    CONSTRAINT cashflows_status_check CHECK ((status = ANY (ARRAY['PROJECTED'::text, 'CONFIRMED'::text, 'SETTLED'::text, 'CANCELLED'::text]))),
    CONSTRAINT ck_cashflows_nonzero_amount CHECK ((amount <> (0)::numeric))
);

ALTER TABLE ONLY public.cashflows FORCE ROW LEVEL SECURITY;


--
-- Name: cashflow_net_by_date; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cashflow_net_by_date AS
 SELECT trade_id,
    payment_date,
    currency,
    sum(COALESCE(amount_override, amount)) AS net_amount,
    count(*) AS leg_count
   FROM public.cashflows
  WHERE (status <> 'CANCELLED'::text)
  GROUP BY trade_id, payment_date, currency
  ORDER BY trade_id, payment_date;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id uuid NOT NULL,
    trade_ref text NOT NULL,
    uti text,
    status text NOT NULL,
    store text NOT NULL,
    asset_class text NOT NULL,
    instrument_type text NOT NULL,
    own_legal_entity_id uuid,
    counterparty_id uuid,
    notional numeric(24,6),
    notional_ccy text NOT NULL,
    trade_date date NOT NULL,
    effective_date date NOT NULL,
    maturity_date date NOT NULL,
    terms jsonb NOT NULL,
    discount_curve_id text,
    forecast_curve_id text,
    desk text,
    book text,
    strategy text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    last_modified_at timestamp with time zone DEFAULT now(),
    last_modified_by uuid,
    structure text,
    user_id uuid NOT NULL,
    latest_event_id uuid,
    version_seq integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_trades_instrument_type_no_legacy CHECK (((instrument_type IS NULL) OR (instrument_type !~~ 'INTEREST_RATE_%'::text))),
    CONSTRAINT chk_trades_ir_swap_structure_valid CHECK (((instrument_type <> 'IR_SWAP'::text) OR (structure = ANY (ARRAY['VANILLA'::text, 'OIS'::text, 'BASIS'::text, 'ZERO_COUPON'::text, 'STEP_UP'::text, 'AMORTIZING'::text, 'ACCRETING'::text])))),
    CONSTRAINT trades_structure_check CHECK ((structure = ANY (ARRAY['VANILLA'::text, 'OIS'::text, 'BASIS'::text, 'XCCY'::text, 'ZERO_COUPON'::text, 'STEP_UP'::text, 'INFLATION_ZC'::text, 'INFLATION_YOY'::text, 'CMS'::text, 'CMS_SPREAD'::text])))
);

ALTER TABLE ONLY public.trades FORCE ROW LEVEL SECURITY;


--
-- Name: cashflows_upcoming; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cashflows_upcoming AS
 SELECT c.id,
    c.trade_id,
    c.leg_id,
    c.payment_date,
    c.currency,
    COALESCE(c.amount_override, c.amount) AS effective_amount,
    c.is_overridden,
    c.status,
    t.trade_ref,
    t.counterparty_id,
    t.desk,
    t.book
   FROM (public.cashflows c
     JOIN public.trades t ON ((t.id = c.trade_id)))
  WHERE (((c.payment_date >= CURRENT_DATE) AND (c.payment_date <= (CURRENT_DATE + '90 days'::interval))) AND (c.status = ANY (ARRAY['PROJECTED'::text, 'CONFIRMED'::text])))
  ORDER BY c.payment_date;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    sender_kind text NOT NULL,
    sender_user_id uuid,
    sender_firm_id uuid,
    sender_name text NOT NULL,
    sender_firm text,
    body text NOT NULL,
    card jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 20000))),
    CONSTRAINT chat_messages_sender_kind_check CHECK ((sender_kind = ANY (ARRAY['USER'::text, 'PROMETHEUS'::text, 'SYSTEM'::text])))
);


--
-- Name: chat_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_reads (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_members (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    firm_id uuid NOT NULL,
    role text DEFAULT 'MEMBER'::text NOT NULL,
    status text DEFAULT 'JOINED'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    CONSTRAINT chat_room_members_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'MEMBER'::text]))),
    CONSTRAINT chat_room_members_status_check CHECK ((status = ANY (ARRAY['INVITED'::text, 'JOINED'::text, 'DECLINED'::text, 'LEFT'::text])))
);


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone,
    name text,
    book_node_id text,
    book_label text,
    book_firm_id uuid,
    CONSTRAINT chat_rooms_kind_check CHECK ((kind = ANY (ARRAY['DIRECT'::text, 'GROUP'::text, 'SUPPORT'::text, 'NEWS'::text])))
);


--
-- Name: counterparties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_entity_id uuid,
    name text NOT NULL,
    isda_agreement text,
    csa_type text,
    csa_currency text,
    csa_threshold_m numeric(12,2),
    csa_mta_k numeric(12,2),
    discount_curve_id text,
    im_model text DEFAULT 'SIMM'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid NOT NULL,
    CONSTRAINT counterparties_csa_type_check CHECK ((csa_type = ANY (ARRAY['VM_ONLY'::text, 'VM_IM'::text, 'NO_CSA'::text])))
);


--
-- Name: firm_leis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firm_leis (
    lei text NOT NULL,
    firm_id uuid NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signing_address text,
    signer_set_at timestamp with time zone,
    signer_set_by uuid,
    CONSTRAINT firm_leis_signing_address_check CHECK ((signing_address ~ '^0x[0-9a-fA-F]{40}$'::text))
);


--
-- Name: firm_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firm_members (
    user_id uuid NOT NULL,
    firm_id uuid NOT NULL,
    role text DEFAULT 'MEMBER'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT firm_members_role_check CHECK ((role = ANY (ARRAY['MEMBER'::text, 'ADMIN'::text, 'COMPLIANCE'::text])))
);


--
-- Name: firms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'OTHER'::text NOT NULL,
    coverage_tier text DEFAULT 'FREE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT firms_coverage_tier_check CHECK ((coverage_tier = ANY (ARRAY['FREE'::text, 'DEDICATED'::text]))),
    CONSTRAINT firms_kind_check CHECK ((kind = ANY (ARRAY['PLATFORM'::text, 'DEALER'::text, 'BUY_SIDE'::text, 'CORPORATE'::text, 'OTHER'::text])))
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    user_id uuid NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legal_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lei text NOT NULL,
    name text NOT NULL,
    short_name text,
    home_currency text NOT NULL,
    jurisdiction text NOT NULL,
    regulatory_regime text[],
    simm_version text DEFAULT 'v2.6'::text NOT NULL,
    im_threshold_m numeric(12,2),
    ois_curve_id text,
    is_own_entity boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid NOT NULL
);


--
-- Name: market_data_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curve_id text NOT NULL,
    valuation_date date NOT NULL,
    quotes jsonb DEFAULT '[]'::jsonb NOT NULL,
    source text DEFAULT 'MANUAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid,
    CONSTRAINT market_data_snapshots_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'BLOOMBERG'::text, 'REFINITIV'::text, 'IMPORT'::text])))
);


--
-- Name: org_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_nodes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    parent_id text,
    name text NOT NULL,
    node_type text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    user_id uuid NOT NULL,
    CONSTRAINT org_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['firm'::text, 'division'::text, 'desk'::text, 'book'::text, 'strategy'::text, 'team'::text, 'entity'::text])))
);


--
-- Name: pnl_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pnl_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    npv numeric(24,6) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    ir01 numeric(18,6),
    ir01_disc numeric(18,6),
    theta numeric(18,6),
    gamma numeric(18,6),
    delta_rate_bps numeric(10,4),
    delta_disc_bps numeric(10,4),
    total_pnl numeric(24,6),
    carry numeric(18,6),
    rolldown numeric(18,6),
    theta_pnl numeric(18,6),
    ir01_pnl numeric(18,6),
    ir01_disc_pnl numeric(18,6),
    gamma_pnl numeric(18,6),
    fx01_pnl numeric(18,6),
    xccy01_pnl numeric(18,6),
    basis01_pnl numeric(18,6),
    ir_vega_pnl numeric(18,6),
    cs01_pnl numeric(18,6),
    unexplained numeric(18,6),
    source text DEFAULT 'PRICER'::text NOT NULL,
    curve_inputs jsonb,
    valuation_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid NOT NULL,
    CONSTRAINT pnl_snapshots_source_check CHECK ((source = ANY (ARRAY['PRICER'::text, 'BATCH'::text, 'MANUAL'::text])))
);


--
-- Name: pnl_daily_by_desk; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pnl_daily_by_desk AS
 SELECT p.snapshot_date,
    t.desk,
    t.asset_class,
    sum(p.carry) AS carry,
    sum(p.rolldown) AS rolldown,
    sum(p.theta_pnl) AS theta_pnl,
    sum(p.ir01_pnl) AS ir01_pnl,
    sum(p.gamma_pnl) AS gamma_pnl,
    sum(p.fx01_pnl) AS fx01_pnl,
    sum(p.xccy01_pnl) AS xccy01_pnl,
    sum(p.ir_vega_pnl) AS ir_vega_pnl,
    sum(p.unexplained) AS unexplained,
    sum(p.total_pnl) AS total_pnl,
    count(*) AS trade_count
   FROM (public.pnl_snapshots p
     JOIN public.trades t ON ((t.id = p.trade_id)))
  WHERE (p.total_pnl IS NOT NULL)
  GROUP BY p.snapshot_date, t.desk, t.asset_class
  ORDER BY p.snapshot_date DESC, (sum(p.total_pnl)) DESC;


--
-- Name: pnl_mtd_by_trade; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pnl_mtd_by_trade AS
 SELECT p.trade_id,
    t.trade_ref,
    t.desk,
    t.book,
    t.asset_class,
    t.instrument_type,
    date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) AS mtd_start,
    sum(p.total_pnl) AS mtd_pnl,
    sum(p.carry) AS mtd_carry,
    sum(p.theta_pnl) AS mtd_theta,
    sum(p.ir01_pnl) AS mtd_ir01_pnl,
    sum(p.ir_vega_pnl) AS mtd_vega_pnl,
    sum(p.unexplained) AS mtd_unexplained,
    count(*) AS days_priced
   FROM (public.pnl_snapshots p
     JOIN public.trades t ON ((t.id = p.trade_id)))
  WHERE ((p.snapshot_date >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (p.total_pnl IS NOT NULL))
  GROUP BY p.trade_id, t.trade_ref, t.desk, t.book, t.asset_class, t.instrument_type
  ORDER BY (sum(p.total_pnl)) DESC;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    trader_id text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    email text,
    full_name text,
    last_seen_at timestamp with time zone,
    is_active boolean DEFAULT true,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'trader'::text, 'admin'::text])))
);


--
-- Name: sabr_params; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sabr_params (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    valuation_date date NOT NULL,
    expiry_label text,
    tenor_label text,
    expiry_y double precision NOT NULL,
    tenor_y double precision NOT NULL,
    alpha double precision NOT NULL,
    rho double precision NOT NULL,
    nu double precision NOT NULL,
    beta double precision DEFAULT 0.0 NOT NULL,
    atm_vol_bp double precision,
    fit_rmse_bp double precision,
    source text DEFAULT 'AUTO'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid NOT NULL
);


--
-- Name: swaption_vol_skew; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.swaption_vol_skew (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    valuation_date date NOT NULL,
    expiry_label text NOT NULL,
    tenor_label text NOT NULL,
    expiry_y double precision NOT NULL,
    tenor_y double precision NOT NULL,
    atm_vol_bp double precision NOT NULL,
    spread_m200 double precision,
    spread_m100 double precision,
    spread_m50 double precision,
    spread_m25 double precision,
    spread_p25 double precision,
    spread_p50 double precision,
    spread_p100 double precision,
    spread_p200 double precision,
    source text DEFAULT 'MANUAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    user_id uuid NOT NULL
);


--
-- Name: telegram_link_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_link_codes (
    code text NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: telegram_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_links (
    room_id uuid NOT NULL,
    chat_id text NOT NULL,
    chat_title text,
    linked_by uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone
);


--
-- Name: trade_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    event_type text NOT NULL,
    event_date date NOT NULL,
    effective_date date NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    pre_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    post_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    counterparty_confirmed boolean DEFAULT false NOT NULL,
    confirmation_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    event_seq integer NOT NULL,
    tx_time timestamp with time zone DEFAULT now() NOT NULL,
    valid_time timestamp with time zone NOT NULL,
    user_id uuid NOT NULL,
    snapshot_id uuid,
    parent_event_id uuid,
    CONSTRAINT trade_events_event_type_check CHECK ((event_type = ANY (ARRAY['BOOKED'::text, 'CONFIRMED'::text, 'ACTIVATED'::text, 'AMENDED'::text, 'BOOK_TRANSFER'::text, 'STORE_CHANGE'::text, 'PARTIAL_TERMINATION'::text, 'NOVATED'::text, 'TERMINATED'::text, 'MATURED'::text, 'CANCELLED'::text, 'DEFAULTED'::text, 'COMPRESSION'::text, 'CREDIT_EVENT'::text])))
);

ALTER TABLE ONLY public.trade_events FORCE ROW LEVEL SECURITY;


--
-- Name: trade_latest_event; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.trade_latest_event AS
 SELECT DISTINCT ON (trade_id) trade_id,
    id AS event_id,
    event_type AS latest_event_type,
    event_date AS latest_event_date,
    created_at AS latest_event_at,
    created_by AS latest_event_by
   FROM public.trade_events
  ORDER BY trade_id, created_at DESC;


--
-- Name: trade_legs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_legs (
    id uuid NOT NULL,
    trade_id uuid NOT NULL,
    leg_ref text NOT NULL,
    leg_seq integer DEFAULT 0 NOT NULL,
    leg_type text NOT NULL,
    direction text NOT NULL,
    currency text NOT NULL,
    notional numeric(24,6),
    notional_type text DEFAULT 'BULLET'::text NOT NULL,
    notional_schedule jsonb,
    effective_date date,
    maturity_date date,
    first_period_start date,
    last_period_end date,
    day_count text,
    payment_frequency text,
    reset_frequency text,
    bdc text,
    stub_type text,
    payment_calendar text,
    payment_lag integer DEFAULT 0,
    fixed_rate numeric(12,8),
    fixed_rate_type text DEFAULT 'FLAT'::text,
    fixed_rate_schedule jsonb,
    spread numeric(12,8),
    spread_type text DEFAULT 'FLAT'::text,
    spread_schedule jsonb,
    forecast_curve_id text,
    cap_rate numeric(12,8),
    floor_rate numeric(12,8),
    leverage numeric(8,4) DEFAULT 1.0,
    ois_compounding text,
    discount_curve_id text,
    terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    leg_hash text,
    booked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    last_modified_at timestamp with time zone,
    last_modified_by uuid,
    user_id uuid NOT NULL,
    latest_event_id uuid,
    version_seq integer DEFAULT 0 NOT NULL,
    embedded_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chk_trade_legs_embedded_options_shape CHECK (public.validate_embedded_options(embedded_options)),
    CONSTRAINT trade_legs_direction_check CHECK ((direction = ANY (ARRAY['PAY'::text, 'RECEIVE'::text]))),
    CONSTRAINT trade_legs_fixed_rate_type_check CHECK ((fixed_rate_type = ANY (ARRAY['FLAT'::text, 'STEP'::text]))),
    CONSTRAINT trade_legs_leg_seq_check CHECK ((leg_seq >= 0)),
    CONSTRAINT trade_legs_leg_type_check CHECK ((leg_type = ANY (ARRAY['FIXED'::text, 'FLOAT'::text, 'ZERO_COUPON'::text, 'INFLATION'::text, 'CMS'::text, 'CDS_FEE'::text, 'CDS_CONTINGENT'::text, 'TOTAL_RETURN'::text, 'EQUITY_RETURN'::text, 'EQUITY_FWD'::text, 'VARIANCE'::text, 'DIVIDEND'::text, 'COMMODITY_FLOAT'::text, 'EMISSIONS_FLOAT'::text, 'RPA_FEE'::text, 'RPA_CONTINGENT'::text, 'IR_SWAPTION'::text, 'CAP_FLOOR'::text, 'FX_OPTION'::text, 'EQUITY_OPTION'::text, 'COMMODITY_OPTION'::text, 'CDS_OPTION'::text, 'BERMUDAN_SWAPTION'::text, 'CALLABLE_SWAP_OPTION'::text, 'CAPPED_FLOORED_FLOAT'::text, 'EXTENDABLE_FORWARD'::text, 'COMMODITY_ASIAN_OPTION'::text]))),
    CONSTRAINT trade_legs_notional_type_check CHECK ((notional_type = ANY (ARRAY['BULLET'::text, 'LINEAR_AMORT'::text, 'MORTGAGE'::text, 'CUSTOM'::text]))),
    CONSTRAINT trade_legs_spread_type_check CHECK ((spread_type = ANY (ARRAY['FLAT'::text, 'STEP'::text])))
);

ALTER TABLE ONLY public.trade_legs FORCE ROW LEVEL SECURITY;


--
-- Name: xva_calibration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xva_calibration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curve_id text DEFAULT 'USD_SWVOL_ATM'::text NOT NULL,
    valuation_date date NOT NULL,
    model text DEFAULT 'HW1F'::text NOT NULL,
    a double precision NOT NULL,
    sigma_bp double precision NOT NULL,
    theta double precision,
    basket_size integer,
    fit_rmse_bp double precision,
    fit_details jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    user_id uuid NOT NULL
);


--
-- Name: cap_sabr_params id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_sabr_params ALTER COLUMN id SET DEFAULT nextval('public.cap_sabr_params_id_seq'::regclass);


--
-- Name: cap_vol_surface id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_vol_surface ALTER COLUMN id SET DEFAULT nextval('public.cap_vol_surface_id_seq'::regclass);


--
-- Name: bloomberg_ticker_overrides bloomberg_ticker_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bloomberg_ticker_overrides
    ADD CONSTRAINT bloomberg_ticker_overrides_pkey PRIMARY KEY (id);


--
-- Name: bloomberg_ticker_overrides bloomberg_ticker_overrides_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bloomberg_ticker_overrides
    ADD CONSTRAINT bloomberg_ticker_overrides_unique UNIQUE (curve_id, tenor, created_by);


--
-- Name: cap_sabr_params cap_sabr_params_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_sabr_params
    ADD CONSTRAINT cap_sabr_params_pkey PRIMARY KEY (id);


--
-- Name: cap_sabr_params cap_sabr_params_valuation_date_cap_tenor_y_caplet_expiry_y_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_sabr_params
    ADD CONSTRAINT cap_sabr_params_valuation_date_cap_tenor_y_caplet_expiry_y_key UNIQUE (valuation_date, cap_tenor_y, caplet_expiry_y);


--
-- Name: cap_vol_surface cap_vol_surface_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_vol_surface
    ADD CONSTRAINT cap_vol_surface_pkey PRIMARY KEY (id);


--
-- Name: cashflows cashflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflows
    ADD CONSTRAINT cashflows_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_reads chat_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reads
    ADD CONSTRAINT chat_reads_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: chat_room_members chat_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: counterparties counterparties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_pkey PRIMARY KEY (id);


--
-- Name: firm_leis firm_leis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_leis
    ADD CONSTRAINT firm_leis_pkey PRIMARY KEY (lei);


--
-- Name: firm_members firm_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_members
    ADD CONSTRAINT firm_members_pkey PRIMARY KEY (user_id);


--
-- Name: firms firms_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_name_key UNIQUE (name);


--
-- Name: firms firms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firms
    ADD CONSTRAINT firms_pkey PRIMARY KEY (id);


--
-- Name: legal_entities legal_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_pkey PRIMARY KEY (id);


--
-- Name: legal_entities legal_entities_user_lei_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_user_lei_key UNIQUE (user_id, lei);


--
-- Name: market_data_snapshots market_data_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_snapshots
    ADD CONSTRAINT market_data_snapshots_pkey PRIMARY KEY (id);


--
-- Name: org_nodes org_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys pk_idempotency_keys; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT pk_idempotency_keys PRIMARY KEY (user_id, key);


--
-- Name: pnl_snapshots pnl_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_snapshots
    ADD CONSTRAINT pnl_snapshots_pkey PRIMARY KEY (id);


--
-- Name: pnl_snapshots pnl_snapshots_trade_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_snapshots
    ADD CONSTRAINT pnl_snapshots_trade_date_unique UNIQUE (trade_id, snapshot_date);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_trader_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_trader_id_key UNIQUE (trader_id);


--
-- Name: sabr_params sabr_params_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sabr_params
    ADD CONSTRAINT sabr_params_pkey PRIMARY KEY (id);


--
-- Name: swaption_vol_skew swaption_vol_skew_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swaption_vol_skew
    ADD CONSTRAINT swaption_vol_skew_pkey PRIMARY KEY (id);


--
-- Name: telegram_link_codes telegram_link_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_pkey PRIMARY KEY (code);


--
-- Name: telegram_links telegram_links_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_chat_id_key UNIQUE (chat_id);


--
-- Name: telegram_links telegram_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_pkey PRIMARY KEY (room_id);


--
-- Name: trade_events trade_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_events
    ADD CONSTRAINT trade_events_pkey PRIMARY KEY (id);


--
-- Name: trade_legs trade_legs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_legs
    ADD CONSTRAINT trade_legs_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: cap_vol_surface uq_cap_vol_surface_user_date_tenor_strike; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_vol_surface
    ADD CONSTRAINT uq_cap_vol_surface_user_date_tenor_strike UNIQUE (user_id, valuation_date, cap_tenor_y, strike_spread_bp);


--
-- Name: market_data_snapshots uq_market_data_snapshots_user_curve_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_snapshots
    ADD CONSTRAINT uq_market_data_snapshots_user_curve_date UNIQUE (user_id, curve_id, valuation_date);


--
-- Name: sabr_params uq_sabr_params_user_date_expiry_tenor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sabr_params
    ADD CONSTRAINT uq_sabr_params_user_date_expiry_tenor UNIQUE (user_id, valuation_date, expiry_y, tenor_y);


--
-- Name: swaption_vol_skew uq_swaption_vol_skew_user_date_expiry_tenor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swaption_vol_skew
    ADD CONSTRAINT uq_swaption_vol_skew_user_date_expiry_tenor UNIQUE (user_id, valuation_date, expiry_label, tenor_label);


--
-- Name: trade_events uq_trade_events_trade_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_events
    ADD CONSTRAINT uq_trade_events_trade_seq UNIQUE (trade_id, event_seq);


--
-- Name: xva_calibration uq_xva_calibration_user_curve_date_model; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xva_calibration
    ADD CONSTRAINT uq_xva_calibration_user_curve_date_model UNIQUE (user_id, curve_id, valuation_date, model);


--
-- Name: xva_calibration xva_calibration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xva_calibration
    ADD CONSTRAINT xva_calibration_pkey PRIMARY KEY (id);


--
-- Name: bto_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bto_created_by_idx ON public.bloomberg_ticker_overrides USING btree (created_by);


--
-- Name: bto_curve_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bto_curve_id_idx ON public.bloomberg_ticker_overrides USING btree (curve_id);


--
-- Name: cashflows_leg_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_leg_id_idx ON public.cashflows USING btree (leg_id);


--
-- Name: cashflows_leg_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_leg_period_idx ON public.cashflows USING btree (leg_id, period_start);


--
-- Name: cashflows_payment_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_payment_date_idx ON public.cashflows USING btree (payment_date);


--
-- Name: cashflows_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_status_idx ON public.cashflows USING btree (status);


--
-- Name: cashflows_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_trade_id_idx ON public.cashflows USING btree (trade_id);


--
-- Name: cashflows_trade_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflows_trade_payment_idx ON public.cashflows USING btree (trade_id, payment_date);


--
-- Name: chat_messages_room_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_room_time ON public.chat_messages USING btree (room_id, created_at);


--
-- Name: chat_room_members_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_room_members_firm ON public.chat_room_members USING btree (firm_id);


--
-- Name: chat_room_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_room_members_user ON public.chat_room_members USING btree (user_id, status);


--
-- Name: firm_leis_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX firm_leis_firm ON public.firm_leis USING btree (firm_id);


--
-- Name: firm_members_firm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX firm_members_firm ON public.firm_members USING btree (firm_id);


--
-- Name: firms_one_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX firms_one_platform ON public.firms USING btree (kind) WHERE (kind = 'PLATFORM'::text);


--
-- Name: idx_cap_sabr_params_date_tenor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cap_sabr_params_date_tenor ON public.cap_sabr_params USING btree (valuation_date, cap_tenor_y);


--
-- Name: idx_cap_vol_surface_date_tenor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cap_vol_surface_date_tenor ON public.cap_vol_surface USING btree (valuation_date, cap_tenor_y);


--
-- Name: idx_org_nodes_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_parent_id ON public.org_nodes USING btree (parent_id);


--
-- Name: idx_org_nodes_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_nodes_sort_order ON public.org_nodes USING btree (sort_order);


--
-- Name: idx_sabr_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sabr_date ON public.sabr_params USING btree (valuation_date DESC);


--
-- Name: idx_sabr_exp_ten; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sabr_exp_ten ON public.sabr_params USING btree (expiry_y, tenor_y);


--
-- Name: idx_vol_skew_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vol_skew_date ON public.swaption_vol_skew USING btree (valuation_date DESC);


--
-- Name: idx_vol_skew_exp_ten; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vol_skew_exp_ten ON public.swaption_vol_skew USING btree (expiry_y, tenor_y);


--
-- Name: ix_cashflows_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cashflows_event ON public.cashflows USING btree (event_id) WHERE (event_id IS NOT NULL);


--
-- Name: ix_cashflows_user_trade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cashflows_user_trade ON public.cashflows USING btree (user_id, trade_id);


--
-- Name: ix_idempotency_keys_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_idempotency_keys_created_at ON public.idempotency_keys USING btree (created_at);


--
-- Name: ix_telegram_link_codes_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_telegram_link_codes_room ON public.telegram_link_codes USING btree (room_id);


--
-- Name: ix_trade_events_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trade_events_snapshot ON public.trade_events USING btree (snapshot_id) WHERE (snapshot_id IS NOT NULL);


--
-- Name: ix_trade_events_trade_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trade_events_trade_seq ON public.trade_events USING btree (trade_id, event_seq);


--
-- Name: ix_trade_events_user_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trade_events_user_tx ON public.trade_events USING btree (user_id, tx_time DESC);


--
-- Name: ix_trade_legs_user_trade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trade_legs_user_trade ON public.trade_legs USING btree (user_id, trade_id);


--
-- Name: ix_trades_latest_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trades_latest_event ON public.trades USING btree (latest_event_id);


--
-- Name: ix_trades_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trades_user_status ON public.trades USING btree (user_id, status);


--
-- Name: mds_curve_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mds_curve_date_idx ON public.market_data_snapshots USING btree (curve_id, valuation_date DESC);


--
-- Name: mds_curve_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mds_curve_id_idx ON public.market_data_snapshots USING btree (curve_id);


--
-- Name: mds_valuation_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mds_valuation_date_idx ON public.market_data_snapshots USING btree (valuation_date DESC);


--
-- Name: pnl_snap_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pnl_snap_date_idx ON public.pnl_snapshots USING btree (snapshot_date DESC);


--
-- Name: pnl_snap_trade_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pnl_snap_trade_date_idx ON public.pnl_snapshots USING btree (trade_id, snapshot_date DESC);


--
-- Name: pnl_snap_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pnl_snap_trade_id_idx ON public.pnl_snapshots USING btree (trade_id);


--
-- Name: trade_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_events_created_at_idx ON public.trade_events USING btree (created_at DESC);


--
-- Name: trade_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_events_event_type_idx ON public.trade_events USING btree (event_type);


--
-- Name: trade_events_trade_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_events_trade_created_idx ON public.trade_events USING btree (trade_id, created_at DESC);


--
-- Name: trade_events_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_events_trade_id_idx ON public.trade_events USING btree (trade_id);


--
-- Name: trade_legs_leg_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_legs_leg_type_idx ON public.trade_legs USING btree (leg_type);


--
-- Name: trade_legs_trade_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_legs_trade_id_idx ON public.trade_legs USING btree (trade_id);


--
-- Name: trade_legs_trade_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_legs_trade_seq_idx ON public.trade_legs USING btree (trade_id, leg_seq);


--
-- Name: trades_structure_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trades_structure_idx ON public.trades USING btree (structure) WHERE (structure IS NOT NULL);


--
-- Name: uq_trades_user_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trades_user_ref ON public.trades USING btree (user_id, trade_ref) WHERE (user_id IS NOT NULL);


--
-- Name: uq_trades_user_uti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trades_user_uti ON public.trades USING btree (user_id, uti) WHERE (uti IS NOT NULL);


--
-- Name: profiles on_profile_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_profile_role_change AFTER UPDATE OF role ON public.profiles FOR EACH ROW WHEN ((old.role IS DISTINCT FROM new.role)) EXECUTE FUNCTION public.sync_role_to_user_metadata();


--
-- Name: trade_events tr_trade_events_assign_seq; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_trade_events_assign_seq BEFORE INSERT ON public.trade_events FOR EACH ROW EXECUTE FUNCTION public.trade_events_assign_seq();


--
-- Name: trade_events tr_trade_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_trade_events_no_delete BEFORE DELETE ON public.trade_events FOR EACH ROW EXECUTE FUNCTION public.trade_events_reject_mutation();


--
-- Name: trade_events tr_trade_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_trade_events_no_update BEFORE UPDATE ON public.trade_events FOR EACH ROW EXECUTE FUNCTION public.trade_events_reject_mutation();


--
-- Name: bloomberg_ticker_overrides bloomberg_ticker_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bloomberg_ticker_overrides
    ADD CONSTRAINT bloomberg_ticker_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: cap_sabr_params cap_sabr_params_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_sabr_params
    ADD CONSTRAINT cap_sabr_params_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cap_vol_surface cap_vol_surface_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_vol_surface
    ADD CONSTRAINT cap_vol_surface_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cashflows cashflows_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflows
    ADD CONSTRAINT cashflows_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.trade_events(id);


--
-- Name: cashflows cashflows_last_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflows
    ADD CONSTRAINT cashflows_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES auth.users(id);


--
-- Name: cashflows cashflows_leg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflows
    ADD CONSTRAINT cashflows_leg_id_fkey FOREIGN KEY (leg_id) REFERENCES public.trade_legs(id) ON DELETE CASCADE;


--
-- Name: cashflows cashflows_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflows
    ADD CONSTRAINT cashflows_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_sender_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_firm_id_fkey FOREIGN KEY (sender_firm_id) REFERENCES public.firms(id);


--
-- Name: chat_reads chat_reads_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reads
    ADD CONSTRAINT chat_reads_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_reads chat_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reads
    ADD CONSTRAINT chat_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id);


--
-- Name: chat_room_members chat_room_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);


--
-- Name: chat_room_members chat_room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_book_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_book_firm_id_fkey FOREIGN KEY (book_firm_id) REFERENCES public.firms(id);


--
-- Name: chat_rooms chat_rooms_book_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_book_node_id_fkey FOREIGN KEY (book_node_id) REFERENCES public.org_nodes(id) ON DELETE SET NULL;


--
-- Name: counterparties counterparties_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: counterparties counterparties_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: counterparties counterparties_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: firm_leis firm_leis_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_leis
    ADD CONSTRAINT firm_leis_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: firm_leis firm_leis_signer_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_leis
    ADD CONSTRAINT firm_leis_signer_set_by_fkey FOREIGN KEY (signer_set_by) REFERENCES auth.users(id);


--
-- Name: firm_members firm_members_firm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_members
    ADD CONSTRAINT firm_members_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES public.firms(id) ON DELETE CASCADE;


--
-- Name: firm_members firm_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_members
    ADD CONSTRAINT firm_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: legal_entities legal_entities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: legal_entities legal_entities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: market_data_snapshots market_data_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_snapshots
    ADD CONSTRAINT market_data_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: market_data_snapshots market_data_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_snapshots
    ADD CONSTRAINT market_data_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: org_nodes org_nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.org_nodes(id);


--
-- Name: org_nodes org_nodes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_nodes
    ADD CONSTRAINT org_nodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: pnl_snapshots pnl_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_snapshots
    ADD CONSTRAINT pnl_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: pnl_snapshots pnl_snapshots_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_snapshots
    ADD CONSTRAINT pnl_snapshots_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;


--
-- Name: pnl_snapshots pnl_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_snapshots
    ADD CONSTRAINT pnl_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sabr_params sabr_params_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sabr_params
    ADD CONSTRAINT sabr_params_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: swaption_vol_skew swaption_vol_skew_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.swaption_vol_skew
    ADD CONSTRAINT swaption_vol_skew_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: telegram_link_codes telegram_link_codes_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: telegram_links telegram_links_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: trade_events trade_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_events
    ADD CONSTRAINT trade_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: trade_events trade_events_parent_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_events
    ADD CONSTRAINT trade_events_parent_event_id_fkey FOREIGN KEY (parent_event_id) REFERENCES public.trade_events(id);


--
-- Name: trade_events trade_events_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_events
    ADD CONSTRAINT trade_events_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE RESTRICT;


--
-- Name: trade_legs trade_legs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_legs
    ADD CONSTRAINT trade_legs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: trade_legs trade_legs_last_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_legs
    ADD CONSTRAINT trade_legs_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES auth.users(id);


--
-- Name: trade_legs trade_legs_latest_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_legs
    ADD CONSTRAINT trade_legs_latest_event_id_fkey FOREIGN KEY (latest_event_id) REFERENCES public.trade_events(id);


--
-- Name: trade_legs trade_legs_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_legs
    ADD CONSTRAINT trade_legs_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;


--
-- Name: trades trades_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id);


--
-- Name: trades trades_latest_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_latest_event_id_fkey FOREIGN KEY (latest_event_id) REFERENCES public.trade_events(id);


--
-- Name: trades trades_own_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_own_legal_entity_id_fkey FOREIGN KEY (own_legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: xva_calibration xva_calibration_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xva_calibration
    ADD CONSTRAINT xva_calibration_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles admin_see_all_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_see_all_profiles ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles admin_update_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update_profiles ON public.profiles FOR UPDATE TO authenticated USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: bloomberg_ticker_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bloomberg_ticker_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: bloomberg_ticker_overrides bto_delete_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bto_delete_author ON public.bloomberg_ticker_overrides FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: bloomberg_ticker_overrides bto_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bto_insert_authenticated ON public.bloomberg_ticker_overrides FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: bloomberg_ticker_overrides bto_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bto_select_authenticated ON public.bloomberg_ticker_overrides FOR SELECT TO authenticated USING (true);


--
-- Name: bloomberg_ticker_overrides bto_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bto_update_authenticated ON public.bloomberg_ticker_overrides FOR UPDATE TO authenticated USING ((created_by = auth.uid()));


--
-- Name: cap_sabr_params; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cap_sabr_params ENABLE ROW LEVEL SECURITY;

--
-- Name: cap_sabr_params cap_sabr_params_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_sabr_params_rls ON public.cap_sabr_params USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: cap_vol_surface; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cap_vol_surface ENABLE ROW LEVEL SECURITY;

--
-- Name: cap_vol_surface cap_vol_surface_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_vol_surface_rls ON public.cap_vol_surface USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: cashflows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cashflows ENABLE ROW LEVEL SECURITY;

--
-- Name: cashflows cashflows_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cashflows_rls ON public.cashflows TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()))) WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_read ON public.chat_messages FOR SELECT TO authenticated USING (public.chat_can_read(room_id));


--
-- Name: chat_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_reads chat_reads_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_reads_read ON public.chat_reads FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: chat_room_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_room_members chat_room_members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_room_members_read ON public.chat_room_members FOR SELECT TO authenticated USING (public.chat_can_see(room_id));


--
-- Name: chat_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_rooms chat_rooms_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_rooms_read ON public.chat_rooms FOR SELECT TO authenticated USING (public.chat_can_see(id));


--
-- Name: counterparties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

--
-- Name: counterparties counterparties_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY counterparties_rls ON public.counterparties USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: firm_leis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.firm_leis ENABLE ROW LEVEL SECURITY;

--
-- Name: firm_leis firm_leis_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY firm_leis_read ON public.firm_leis FOR SELECT TO authenticated USING (true);


--
-- Name: firm_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.firm_members ENABLE ROW LEVEL SECURITY;

--
-- Name: firm_members firm_members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY firm_members_read ON public.firm_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (firm_id = public.my_firm_id())));


--
-- Name: firms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;

--
-- Name: firms firms_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY firms_read ON public.firms FOR SELECT TO authenticated USING (true);


--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys idempotency_keys_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY idempotency_keys_rls ON public.idempotency_keys TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: legal_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_entities legal_entities_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_entities_rls ON public.legal_entities USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: market_data_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_data_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: market_data_snapshots market_data_snapshots_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_data_snapshots_rls ON public.market_data_snapshots USING (((user_id IS NULL) OR (user_id = auth.uid()))) WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: org_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: org_nodes org_nodes_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_nodes_rls ON public.org_nodes USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: pnl_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pnl_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: pnl_snapshots pnl_snapshots_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pnl_snapshots_rls ON public.pnl_snapshots USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: sabr_params; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sabr_params ENABLE ROW LEVEL SECURITY;

--
-- Name: sabr_params sabr_params_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sabr_params_rls ON public.sabr_params USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: swaption_vol_skew; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.swaption_vol_skew ENABLE ROW LEVEL SECURITY;

--
-- Name: swaption_vol_skew swaption_vol_skew_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY swaption_vol_skew_rls ON public.swaption_vol_skew USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: telegram_link_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

--
-- Name: trade_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;

--
-- Name: trade_events trade_events_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trade_events_rls ON public.trade_events TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()))) WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: trade_legs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trade_legs ENABLE ROW LEVEL SECURITY;

--
-- Name: trade_legs trade_legs_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trade_legs_rls ON public.trade_legs TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()))) WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: trades trades_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trades_rls ON public.trades TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()))) WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: profiles users_see_own_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_see_own_profile ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: xva_calibration; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.xva_calibration ENABLE ROW LEVEL SECURITY;

--
-- Name: xva_calibration xva_calibration_rls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY xva_calibration_rls ON public.xva_calibration USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- PostgreSQL database dump complete
--



--
-- news_items — headlines the NEWS room posts (migration 016)
--
CREATE TABLE public.news_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    url text NOT NULL UNIQUE,
    title text NOT NULL,
    source text NOT NULL,
    published_at timestamp with time zone,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    message_id uuid REFERENCES public.chat_messages(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX ix_news_items_published ON public.news_items USING btree (published_at DESC);
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY news_items_read ON public.news_items FOR SELECT TO authenticated USING (true);

--
-- Profile on sign-up (trigger lives on auth.users, so it is outside the
-- public-schema dump above)
--
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
