BEGIN;

CREATE TABLE public.worker_notification_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  business_unit_id uuid NOT NULL,
  operational_job_id uuid NOT NULL REFERENCES public.operational_job(id),
  worker_assignment_id uuid NOT NULL REFERENCES public.worker_assignment(id),
  work_order_id uuid NOT NULL REFERENCES public.work_order(id),
  worker_id uuid NOT NULL REFERENCES public.worker(id),
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  recipient text NOT NULL,
  provider text NOT NULL,
  provider_message_id text NULL,
  delivery_status text NOT NULL DEFAULT 'requested' CHECK (delivery_status IN ('requested','sent','delivered','failed','acknowledged')),
  idempotency_key text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  failed_at timestamptz NULL,
  acknowledged_at timestamptz NULL,
  failure_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_app_user_id uuid NULL,
  updated_by_app_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_worker_notification_assignment_channel UNIQUE(worker_assignment_id, channel),
  CONSTRAINT uq_worker_notification_idempotency UNIQUE(idempotency_key)
);

ALTER TABLE public.worker_notification_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_wnd_owner_admin_all ON public.worker_notification_delivery
FOR ALL TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'::text]))
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'::text]));

CREATE POLICY pol_wnd_office_ops_all ON public.worker_notification_delivery
FOR ALL TO authenticated
USING (public.has_bu_role(organization_id,business_unit_id,ARRAY['office_ops'::text]))
WITH CHECK (public.has_bu_role(organization_id,business_unit_id,ARRAY['office_ops'::text]));

CREATE POLICY pol_wnd_worker_select ON public.worker_notification_delivery
FOR SELECT TO authenticated
USING (worker_id = public.current_worker_id(organization_id));

CREATE POLICY pol_wnd_worker_ack ON public.worker_notification_delivery
FOR UPDATE TO authenticated
USING (worker_id = public.current_worker_id(organization_id) AND delivery_status IN ('requested','sent','delivered'))
WITH CHECK (worker_id = public.current_worker_id(organization_id) AND delivery_status = 'acknowledged');

GRANT SELECT, INSERT, UPDATE ON public.worker_notification_delivery TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_worker_notification_delivery_update()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.business_unit_id IS DISTINCT FROM OLD.business_unit_id
     OR NEW.operational_job_id IS DISTINCT FROM OLD.operational_job_id
     OR NEW.worker_assignment_id IS DISTINCT FROM OLD.worker_assignment_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.recipient IS DISTINCT FROM OLD.recipient
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'worker_notification_delivery identity is immutable';
  END IF;
  IF OLD.delivery_status = 'acknowledged' AND NEW.delivery_status <> 'acknowledged' THEN
    RAISE EXCEPTION 'acknowledged worker notification is terminal';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_worker_notification_delivery_guard
BEFORE UPDATE ON public.worker_notification_delivery
FOR EACH ROW EXECUTE FUNCTION public.guard_worker_notification_delivery_update();

CREATE INDEX ix_wnd_job ON public.worker_notification_delivery(operational_job_id, created_at DESC);
CREATE INDEX ix_wnd_worker ON public.worker_notification_delivery(worker_id, created_at DESC);

COMMIT;
