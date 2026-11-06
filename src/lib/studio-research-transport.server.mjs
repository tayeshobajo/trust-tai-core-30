// Prepared server-only transport. No environment defaults or activation.
// Caller must authorize the Studio user and durably reserve the request first.
const ORIGIN = 'https://agents.trusttai.com';
const AGENT = '5cbc9418-0ff9-4f1c-a807-c0632e26a538';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createStudioTransport({ origin, key, companyId, projectId, agentId }, fetcher = fetch) {
  if (origin !== ORIGIN || agentId !== AGENT || !uuid(companyId) || !uuid(projectId) ||
      typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) {
    throw new Error('Studio Paperclip binding is incomplete or invalid.');
  }
  async function request(path, method = 'GET', body) {
    // Single attempt: a failed POST may already have created a task.
    const response = await fetcher(`${ORIGIN}/api${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Paperclip request failed (${response.status}).`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Paperclip returned an unexpected response.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Paperclip returned an empty response.');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1000000) { await reader.cancel(); throw new Error('Paperclip response exceeds limit.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('Paperclip returned invalid JSON.'); }
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
      if (agent?.id !== agentId || agent.companyId !== companyId ||
          scope?.kind !== 'task_bridge' || scope.projectId !== projectId ||
          scope.parentIssueId || scope.parentIssueIds?.length || scope.projectIds?.length ||
          scope.allowedAssigneeAgentIds?.length !== 1 || scope.allowedAssigneeAgentIds[0] !== agentId ||
          typeof agent.status !== 'string') {
        throw new Error('Paperclip credential scope or identity mismatch.');
      }
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
