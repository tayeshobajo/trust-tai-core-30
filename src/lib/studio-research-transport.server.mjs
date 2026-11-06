// Prepared server-only transport. No environment defaults or activation.
// Caller must authorize the Studio user and durably reserve the request first.
const ORIGIN = 'https://agents.trusttai.com';
const AGENT = '5cbc9418-0ff9-4f1c-a807-c0632e26a538';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const diagnosticCodes = new Set([
  'transport_configuration', 'network_failure', 'timeout', 'response_read_failed',
  'dns_failure', 'tls_failure', 'connection_refused', 'connection_reset',
  'redirect_rejected', 'network_type_error', 'request_aborted', 'runtime_timeout_unavailable',
  'http_401', 'http_403', 'http_404', 'http_429', 'http_client_error', 'http_server_error', 'http_other',
  'response_format', 'response_empty', 'response_too_large', 'response_json',
  'identity_mismatch', 'scope_mismatch', 'identity_shape', 'transport_unknown',
]);
class TransportDiagnosticError extends Error {
  constructor(code) { super('Paperclip verification failed.'); this.code = code; }
}
export function studioTransportDiagnostic(error) {
  return error instanceof TransportDiagnosticError && diagnosticCodes.has(error.code)
    ? error.code : 'transport_unknown';
}
// Inspect only bounded, known error codes/names. Never return message, stack,
// cause, address or headers. Unknown causes stay unknown (including platform blocks).
function networkDiagnostic(error) {
  const codes = new Map([
    ['ENOTFOUND', 'dns_failure'], ['EAI_AGAIN', 'dns_failure'],
    ['CERT_HAS_EXPIRED', 'tls_failure'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_failure'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'tls_failure'], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_failure'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_failure'], ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls_failure'],
    ['ECONNREFUSED', 'connection_refused'], ['ECONNRESET', 'connection_reset'],
    ['ETIMEDOUT', 'timeout'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
  ]);
  let current = error;
  for (let depth = 0; current && depth < 3; depth++, current = current.cause) {
    if (codes.has(current.code)) return codes.get(current.code);
    if (current.name === 'TimeoutError') return 'timeout';
    // Exact Undici sentinel, not a substring of an arbitrary upstream message.
    if (current instanceof Error && current.message === 'unexpected redirect') return 'redirect_rejected';
  }
  if (error?.name === 'AbortError') return 'request_aborted';
  if (error instanceof TypeError) return 'network_type_error';
  return 'network_failure';
}
export function createStudioTransport({ origin, key, companyId, projectId, agentId }, fetcher = fetch) {
  if (origin !== ORIGIN || agentId !== AGENT || !uuid(companyId) || !uuid(projectId) ||
      typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) {
    throw new TransportDiagnosticError('transport_configuration');
  }
  async function request(path, method = 'GET', body) {
    // Single attempt: a failed POST may already have created a task.
    if (typeof AbortSignal?.timeout !== 'function')
      throw new TransportDiagnosticError('runtime_timeout_unavailable');
    let response;
    try { response = await fetcher(`${ORIGIN}/api${path}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    } catch (error) {
      throw new TransportDiagnosticError(networkDiagnostic(error));
    }
    // Workers rejects redirect:error during Request construction. Manual mode
    // sends only to the bound origin; reject all 3xx without inspecting Location.
    if (response.status >= 300 && response.status <= 399)
      throw new TransportDiagnosticError('redirect_rejected');
    if (!response.ok) {
      const status = response.status;
      const code = [401,403,404,429].includes(status) ? `http_${status}`
        : status >= 500 && status <= 599 ? 'http_server_error'
        : status >= 400 && status <= 499 ? 'http_client_error' : 'http_other';
      throw new TransportDiagnosticError(code);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new TransportDiagnosticError('response_format');
    const reader = response.body?.getReader();
    if (!reader) throw new TransportDiagnosticError('response_empty');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1000000) { await reader.cancel(); throw new TransportDiagnosticError('response_too_large'); }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof TransportDiagnosticError) throw error;
      throw new TransportDiagnosticError('response_read_failed');
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new TransportDiagnosticError('response_json'); }
  }
  function verifyIssue(issue, expectedId) {
    if (!issue || !uuid(issue.id) || (expectedId && issue.id !== expectedId) ||
        issue.companyId !== companyId || issue.projectId !== projectId || issue.assigneeAgentId !== agentId) {
      throw new Error('Paperclip issue binding mismatch.');
    }
    return issue;
  }
  return {
    async readAgent(expectedId) {
      if (expectedId !== agentId) throw new Error('Invalid agent binding.');
      // Verified on the installed server: task_bridge can read its own identity.
      // Do not use the broader /agents/:id runtime/configuration endpoint.
      const agent = await request('/agents/me');
      const scope = agent?.keyScope;
      if (agent?.id !== agentId || agent.companyId !== companyId)
        throw new TransportDiagnosticError('identity_mismatch');
      if (scope?.kind !== 'task_bridge' || scope.projectId !== projectId ||
          scope.parentIssueId || scope.parentIssueIds?.length || scope.projectIds?.length ||
          scope.allowedAssigneeAgentIds?.length !== 1 || scope.allowedAssigneeAgentIds[0] !== agentId)
        throw new TransportDiagnosticError('scope_mismatch');
      if (typeof agent.status !== 'string') throw new TransportDiagnosticError('identity_shape');
      return { id: agent.id, companyId: agent.companyId, status: agent.status };
    },
    async createIssue(input) {
      if (input.companyId !== companyId || input.assigneeAgentId !== agentId ||
          typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 ||
          typeof input.description !== 'string' || input.description.length > 20000 ||
          typeof input.correlationId !== 'string' || input.correlationId.length > 300) {
        throw new Error('Invalid Studio research task.');
      }
      // Assignment may wake the agent once enabled. No separate wakeup call.
      return verifyIssue(await request(`/companies/${companyId}/issues`, 'POST', {
        title: input.title, description: `${input.description}\n\nStudio correlation: ${input.correlationId}`,
        projectId, assigneeAgentId: agentId, status: 'todo',
      }));
    },
    async readIssue(expectedCompanyId, issueId) {
      if (expectedCompanyId !== companyId || !uuid(issueId)) throw new Error('Invalid issue binding.');
      const issue = verifyIssue(await request(`/issues/${issueId}`), issueId);
      const comments = await request(`/issues/${issueId}/comments?order=asc&limit=101`);
      if (!Array.isArray(comments) || comments.length > 100) throw new Error('Research comments exceed review limit.');
      for (const c of comments) {
        if (!c || !uuid(c.id) || c.companyId !== companyId || c.issueId !== issueId || typeof c.body !== 'string') {
          throw new Error('Research comment binding mismatch.');
        }
      }
      return { ...issue, comments };
    },
  };
}
