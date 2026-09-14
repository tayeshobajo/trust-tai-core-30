-- Apply atomically with 20260914150000_comms_review_runs.sql on the existing backend.
-- Only the authenticated server may produce review evidence. Browser users read via RLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sessions','versions','sources','runs','findings','obligations','approvals'] LOOP
  EXECUTE format('REVOKE ALL ON public.comms_review_%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT SELECT ON public.comms_review_%I TO authenticated',t);
 END LOOP;
END $$;
ALTER TABLE public.comms_review_sessions ADD COLUMN context_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.comms_review_runs ADD COLUMN context_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.comms_review_versions ADD UNIQUE(id,session_id,organization_id);
ALTER TABLE public.comms_review_sources ADD UNIQUE(id,session_id,organization_id);
ALTER TABLE public.comms_review_runs ADD UNIQUE(id,session_id,version_id,organization_id);
ALTER TABLE public.comms_review_runs ADD FOREIGN KEY(version_id,session_id,organization_id)
 REFERENCES public.comms_review_versions(id,session_id,organization_id);
ALTER TABLE public.comms_review_findings ADD COLUMN session_id uuid NOT NULL;
ALTER TABLE public.comms_review_findings ADD FOREIGN KEY(run_id,session_id,version_id,organization_id)
 REFERENCES public.comms_review_runs(id,session_id,version_id,organization_id);
ALTER TABLE public.comms_review_obligations ADD COLUMN session_id uuid NOT NULL,
 ADD COLUMN version_id uuid NOT NULL, ADD COLUMN obligation_key text NOT NULL;
ALTER TABLE public.comms_review_obligations RENAME COLUMN source_start TO excerpt_start;
ALTER TABLE public.comms_review_obligations RENAME COLUMN source_end TO excerpt_end;
ALTER TABLE public.comms_review_obligations ADD UNIQUE(run_id,obligation_key);
ALTER TABLE public.comms_review_obligations DROP CONSTRAINT comms_review_obligations_source_fkey;
ALTER TABLE public.comms_review_obligations ADD FOREIGN KEY(source_id,session_id,organization_id)
 REFERENCES public.comms_review_sources(id,session_id,organization_id);
ALTER TABLE public.comms_review_obligations ADD FOREIGN KEY(run_id,session_id,version_id,organization_id)
 REFERENCES public.comms_review_runs(id,session_id,version_id,organization_id);
ALTER TABLE public.comms_review_approvals ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE public.comms_review_approvals DROP CONSTRAINT comms_review_approvals_run_fkey;
ALTER TABLE public.comms_review_approvals ADD FOREIGN KEY(run_id,session_id,version_id,organization_id)
 REFERENCES public.comms_review_runs(id,session_id,version_id,organization_id);

CREATE OR REPLACE FUNCTION private.comms_review_session_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF (new.id,new.organization_id,new.created_by,new.created_at) IS DISTINCT FROM
     (old.id,old.organization_id,old.created_by,old.created_at) THEN
   RAISE EXCEPTION 'Review identity is immutable';
  END IF;
  IF (new.situation,new.goal,new.recipient_name,new.recipient_email,new.relationship_id,new.thread_id)
    IS DISTINCT FROM (old.situation,old.goal,old.recipient_name,old.recipient_email,old.relationship_id,old.thread_id) THEN
   new.context_revision := old.context_revision + 1;
   new.status := 'open';
  END IF;
 END IF;
 IF new.relationship_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comms_relationships
    WHERE id=new.relationship_id AND organization_id=new.organization_id) THEN
  RAISE EXCEPTION 'Relationship belongs to another workspace';
 END IF;
 IF new.thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comms_threads
    WHERE id=new.thread_id AND organization_id=new.organization_id) THEN
  RAISE EXCEPTION 'Thread belongs to another workspace';
 END IF;
 new.updated_at := now(); RETURN new;
END $$;
CREATE TRIGGER comms_review_session_guard BEFORE INSERT OR UPDATE ON public.comms_review_sessions
 FOR EACH ROW EXECUTE FUNCTION private.comms_review_session_guard();
CREATE OR REPLACE FUNCTION private.comms_review_context_bump() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 UPDATE public.comms_review_sessions SET context_revision=context_revision+1,status='open'
 WHERE id=new.session_id AND organization_id=new.organization_id;
 RETURN new;
END $$;
CREATE TRIGGER comms_review_version_bump AFTER INSERT ON public.comms_review_versions
 FOR EACH ROW EXECUTE FUNCTION private.comms_review_context_bump();
CREATE TRIGGER comms_review_source_bump AFTER INSERT ON public.comms_review_sources
 FOR EACH ROW EXECUTE FUNCTION private.comms_review_context_bump();
CREATE OR REPLACE FUNCTION private.comms_review_run_start() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 SELECT context_revision INTO new.context_revision FROM public.comms_review_sessions
 WHERE id=new.session_id AND organization_id=new.organization_id FOR UPDATE;
 IF new.status <> 'running' THEN RAISE EXCEPTION 'Review must start running'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER comms_review_run_start BEFORE INSERT ON public.comms_review_runs
 FOR EACH ROW EXECUTE FUNCTION private.comms_review_run_start();
CREATE OR REPLACE FUNCTION public.comms_review_run_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF old.status <> 'running' THEN RAISE EXCEPTION 'Finished review is immutable'; END IF;
 IF (new.id,new.organization_id,new.session_id,new.version_id,new.started_at,new.created_by,new.context_revision,new.context_fingerprint)
 IS DISTINCT FROM (old.id,old.organization_id,old.session_id,old.version_id,old.started_at,old.created_by,old.context_revision,old.context_fingerprint)
 THEN RAISE EXCEPTION 'Review evidence cannot be repointed'; END IF;
 RETURN new;
END $$;
CREATE OR REPLACE FUNCTION public.comms_review_finding_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF (to_jsonb(new)-ARRAY['state','decided_by','decided_at','decision_note']) IS DISTINCT FROM
    (to_jsonb(old)-ARRAY['state','decided_by','decided_at','decision_note']) THEN
  RAISE EXCEPTION 'Finding evidence is immutable';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships
   WHERE organization_id=new.organization_id AND user_id=new.decided_by AND status='active') THEN
  RAISE EXCEPTION 'An active member must make the decision';
 END IF;
 new.decided_at := now(); RETURN new;
END $$;
CREATE OR REPLACE FUNCTION public.comms_review_approval_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE s public.comms_review_sessions; r public.comms_review_runs; v uuid; actual_role text;
BEGIN
 SELECT * INTO s FROM public.comms_review_sessions WHERE id=new.session_id
   AND organization_id=new.organization_id FOR UPDATE;
 SELECT role INTO actual_role FROM public.organization_memberships
   WHERE organization_id=new.organization_id AND user_id=new.approved_by AND status='active';
 IF actual_role IS NULL OR actual_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Only an active owner or admin may approve';
 END IF;
 SELECT id INTO v FROM public.comms_review_versions WHERE session_id=s.id
   AND organization_id=s.organization_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO r FROM public.comms_review_runs WHERE id=new.run_id AND session_id=s.id
   AND organization_id=s.organization_id AND version_id=new.version_id;
 IF r.id IS NULL OR r.status <> 'complete' OR v IS DISTINCT FROM new.version_id
   OR r.context_revision IS DISTINCT FROM s.context_revision
   OR nullif(btrim(new.context_fingerprint),'') IS NULL
   OR r.context_fingerprint IS DISTINCT FROM new.context_fingerprint THEN
  RAISE EXCEPTION 'A completed review of the current words and context is required';
 END IF;
 IF coalesce((r.coverage->>'complete')::boolean,false) IS NOT TRUE
   OR EXISTS(SELECT 1 FROM public.comms_review_sources WHERE session_id=s.id AND status<>'parsed')
   OR EXISTS(SELECT 1 FROM public.comms_review_obligations WHERE run_id=r.id
      AND (status NOT IN ('answered','pending_confirmation') OR method<>'semantic'))
   OR EXISTS(SELECT 1 FROM public.comms_review_findings WHERE run_id=r.id AND severity='must_fix') THEN
  RAISE EXCEPTION 'Resolve blocking findings and coverage, then run a fresh review';
 END IF;
 new.approver_role := actual_role; new.approved_at := now(); RETURN new;
END $$;
-- Historical evidence cannot be rewritten even through the service API.
REVOKE UPDATE,DELETE,TRUNCATE ON public.comms_review_versions,public.comms_review_sources,
 public.comms_review_obligations,public.comms_review_approvals FROM service_role;
REVOKE DELETE,TRUNCATE ON public.comms_review_sessions,public.comms_review_runs,
 public.comms_review_findings FROM service_role;
REVOKE ALL ON FUNCTION private.comms_review_session_guard(),private.comms_review_context_bump(),
 private.comms_review_run_start(),public.comms_review_approval_guard(),public.comms_review_run_guard(),
 public.comms_review_finding_guard() FROM PUBLIC,anon,authenticated;
