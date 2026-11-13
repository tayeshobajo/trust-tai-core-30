-- SOURCE-ONLY: additive v2 storage; no approval rows, legacy updates or runtime activation.
CREATE TABLE public.studio_research_attempts_v2 (
 attempt_id uuid PRIMARY KEY,
 request_id uuid NOT NULL,
 prior_run_id uuid NOT NULL UNIQUE,
 approval jsonb NOT NULL CHECK (approval->>'version'='2' AND approval->>'duplicateCostAccepted'='true'),
 approval_digest text NOT NULL UNIQUE CHECK (approval_digest ~ '^[a-f0-9]{64}$'),
 state jsonb NOT NULL DEFAULT '{"revision":0,"admission":null,"tokens":[],"terminal":null,"cancelled":false,"packetDigests":[],"result":null}'::jsonb
);
CREATE TABLE public.studio_attempt_packets_v2 (
 attempt_id uuid NOT NULL REFERENCES public.studio_research_attempts_v2(attempt_id),
 revision integer NOT NULL CHECK(revision>0), token text NOT NULL CHECK(length(token)<=190000),
 state jsonb NOT NULL, PRIMARY KEY(attempt_id,revision), UNIQUE(attempt_id,token)
);
ALTER TABLE public.studio_research_attempts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_attempt_packets_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_research_attempts_v2, public.studio_attempt_packets_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.studio_research_attempts_v2 TO service_role;
GRANT SELECT ON public.studio_attempt_packets_v2 TO service_role;
CREATE FUNCTION public.studio_attempt_guard_v2() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE prior public.studio_research_requests;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'attempt_history_immutable'; END IF;
 IF TG_TABLE_NAME='studio_attempt_packets_v2' THEN RAISE EXCEPTION 'attempt_history_immutable'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO STRICT prior FROM public.studio_research_requests WHERE request_id=new.request_id;
  IF (new.approval->>'attemptId'=new.attempt_id::text
   AND new.approval->>'priorRunId'=new.prior_run_id::text
   AND new.approval->>'runId'<>new.prior_run_id::text
   AND new.approval->'historicalApproval'=prior.coordinator_approval
   AND new.approval->>'subjectId'=prior.created_by::text
   AND prior.coordinator_admission->>'runId'=new.prior_run_id::text
   AND prior.coordinator_brief IS NULL AND prior.coordinator_result_digest IS NULL
   AND new.state='{"revision":0,"admission":null,"tokens":[],"terminal":null,"cancelled":false,"packetDigests":[],"result":null}'::jsonb) IS NOT TRUE
  THEN RAISE EXCEPTION 'attempt_history_mismatch'; END IF;
 ELSE
  IF (new.attempt_id,new.request_id,new.prior_run_id,new.approval,new.approval_digest) IS DISTINCT FROM
     (old.attempt_id,old.request_id,old.prior_run_id,old.approval,old.approval_digest)
  THEN RAISE EXCEPTION 'attempt_approval_immutable'; END IF;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER studio_attempt_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.studio_research_attempts_v2 FOR EACH ROW EXECUTE FUNCTION public.studio_attempt_guard_v2();
CREATE TRIGGER studio_attempt_packets_guard_v2 BEFORE UPDATE OR DELETE ON public.studio_attempt_packets_v2 FOR EACH ROW EXECUTE FUNCTION public.studio_attempt_guard_v2();
CREATE FUNCTION public.studio_attempt_commit_v2(p_attempt_id uuid,p_revision integer,p_state jsonb,p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_row public.studio_research_attempts_v2; prior_packet public.studio_attempt_packets_v2; item record;
BEGIN
 SELECT * INTO STRICT current_row FROM public.studio_research_attempts_v2 WHERE attempt_id=p_attempt_id FOR UPDATE;
 SELECT * INTO prior_packet FROM public.studio_attempt_packets_v2 WHERE attempt_id=p_attempt_id AND token=p_token;
 IF FOUND THEN
  IF prior_packet.state<>p_state THEN RAISE EXCEPTION 'attempt_duplicate_conflict'; END IF;
  RETURN true;
 END IF;
 IF (
  jsonb_typeof(p_state)='object'
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_state) k)=ARRAY['admission','cancelled','packetDigests','result','revision','terminal','tokens']
  AND jsonb_typeof(p_state->'revision')='number' AND (p_state->>'revision') ~ '^[0-9]+$'
  AND (current_row.state->>'revision')::integer=p_revision AND (p_state->>'revision')::integer=p_revision+1
  AND current_row.state->>'terminal' IS NULL
  AND jsonb_typeof(p_state->'cancelled')='boolean' AND p_state->'cancelled'=current_row.state->'cancelled'
  AND (NOT (current_row.state->>'cancelled')::boolean OR p_state->>'terminal'='uncertain')
  AND jsonb_typeof(p_state->'tokens')='array' AND jsonb_array_length(p_state->'tokens') BETWEEN jsonb_array_length(current_row.state->'tokens') AND 64
  AND jsonb_typeof(p_state->'packetDigests')='array' AND jsonb_array_length(p_state->'packetDigests')=jsonb_array_length(current_row.state->'packetDigests')+1
  AND jsonb_array_length(p_state->'packetDigests')<=3
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'packetDigests') v WHERE jsonb_typeof(v)<>'string' OR (v #>> '{}') !~ '^[a-f0-9]{64}$')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'tokens') v WHERE jsonb_typeof(v)<>'string' OR length(v #>> '{}')>8192)
  AND jsonb_typeof(p_state->'admission')='object'
  AND (current_row.state->'admission'='null'::jsonb OR p_state->'admission'=current_row.state->'admission')
  AND (p_state->'terminal'='null'::jsonb OR p_state->>'terminal' IN ('ready','uncertain'))
  AND ((p_state->>'terminal'='ready' AND jsonb_typeof(p_state->'result')='object') OR
       (p_state->'terminal'<>'"ready"'::jsonb AND p_state->'result'='null'::jsonb))
  AND length(p_token) BETWEEN 1 AND 190000
 ) IS NOT TRUE THEN RAISE EXCEPTION 'attempt_revision_conflict'; END IF;
 FOR item IN SELECT value, ordinality FROM jsonb_array_elements(current_row.state->'packetDigests') WITH ORDINALITY LOOP
  IF p_state->'packetDigests'->(item.ordinality::integer-1) IS DISTINCT FROM item.value THEN RAISE EXCEPTION 'attempt_digest_conflict'; END IF;
 END LOOP;
 FOR item IN SELECT value, ordinality FROM jsonb_array_elements(current_row.state->'tokens') WITH ORDINALITY LOOP
  IF p_state->'tokens'->(item.ordinality::integer-1) IS DISTINCT FROM item.value THEN RAISE EXCEPTION 'attempt_receipt_conflict'; END IF;
 END LOOP;
 INSERT INTO public.studio_attempt_packets_v2 VALUES(p_attempt_id,p_revision+1,p_token,p_state);
 UPDATE public.studio_research_attempts_v2 SET state=p_state WHERE attempt_id=p_attempt_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_attempt_commit_v2(uuid,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_attempt_commit_v2(uuid,integer,jsonb,text) TO service_role;

CREATE TABLE public.studio_attempt_cancellations_v2(attempt_id uuid PRIMARY KEY REFERENCES public.studio_research_attempts_v2(attempt_id), cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.studio_attempt_cancellations_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_attempt_cancellations_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.studio_attempt_cancel_v2(p_attempt_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.studio_research_attempts_v2;
BEGIN
 SELECT * INTO STRICT r FROM public.studio_research_attempts_v2 WHERE attempt_id=p_attempt_id FOR UPDATE;
 IF r.state->>'terminal' IS NOT NULL OR (r.state->>'cancelled')::boolean THEN RETURN true; END IF;
 INSERT INTO public.studio_attempt_cancellations_v2(attempt_id) VALUES(p_attempt_id);
 UPDATE public.studio_research_attempts_v2 SET state=jsonb_set(jsonb_set(state,'{cancelled}','true'::jsonb),'{revision}',to_jsonb((state->>'revision')::integer+1)) WHERE attempt_id=p_attempt_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_attempt_cancel_v2(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_attempt_cancel_v2(uuid) TO service_role;
CREATE TABLE public.studio_attempt_nonces_v2(nonce uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES public.studio_research_attempts_v2(attempt_id), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), response text);
ALTER TABLE public.studio_attempt_nonces_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_attempt_nonces_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.studio_attempt_nonce_claim_v2(p_attempt_id uuid,p_approval_digest text,p_nonce uuid,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.studio_attempt_nonces_v2; inserted integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.studio_research_attempts_v2 WHERE attempt_id=p_attempt_id AND approval_digest=p_approval_digest) THEN RAISE EXCEPTION 'attempt_not_approved'; END IF;
 INSERT INTO public.studio_attempt_nonces_v2 VALUES(p_nonce,p_attempt_id,p_digest,NULL) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO STRICT n FROM public.studio_attempt_nonces_v2 WHERE nonce=p_nonce;
 IF n.attempt_id<>p_attempt_id OR n.digest<>p_digest THEN RAISE EXCEPTION 'attempt_nonce_conflict'; END IF;
 RETURN jsonb_build_object('claimed',inserted=1,'response',n.response);
END $$;
CREATE FUNCTION public.studio_attempt_nonce_finish_v2(p_attempt_id uuid,p_nonce uuid,p_digest text,p_response text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_response IS NULL OR length(p_response)>190000 THEN RAISE EXCEPTION 'attempt_response_invalid'; END IF;
 UPDATE public.studio_attempt_nonces_v2 SET response=p_response WHERE nonce=p_nonce AND attempt_id=p_attempt_id AND digest=p_digest AND response IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt_nonce_consumed'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_attempt_nonce_claim_v2(uuid,text,uuid,text),public.studio_attempt_nonce_finish_v2(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_attempt_nonce_claim_v2(uuid,text,uuid,text),public.studio_attempt_nonce_finish_v2(uuid,uuid,text,text) TO service_role;
