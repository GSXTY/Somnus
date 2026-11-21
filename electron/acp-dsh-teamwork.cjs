const TEAM_COMMAND = 'somnus-conversation-teamwork';
const TEAM_CLAIM = 'native_teamwork_claim';

function teamworkPlugin(moduleUrl, endpointVariable, tokenVariable) {
  return `
import { apply as nativeTeamTools, inject as nativeInject } from ${JSON.stringify(moduleUrl)};
export const inject = [...nativeInject, 'commands'];
export function apply(ctx) {
  const roots = new Set();
  const rootOf = agent => ctx.agentTeams.tryMembership(agent)?.root;
  const enabled = agent => roots.has(rootOf(agent));
  let created;
  let disposed;
  const agents = Object.create(ctx.agents);
  Object.defineProperty(agents, 'list', { value: () => ctx.agents.list().filter(enabled) });
  const scoped = new Proxy(ctx, {
    get(target, key) {
      if (key === 'agents') return agents;
      if (key === 'on') return (event, handler) => {
        if (event === 'agent/created') {
          created = handler;
          return target.on(event, data => { if (enabled(data.agent)) handler(data); });
        }
        if (event === 'agent/disposed') {
          disposed = handler;
          return target.on(event, data => { roots.delete(data.agent); handler(data); });
        }
        return target.on(event, handler);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  nativeTeamTools(scoped, { freshProvider: 'spawn', forkProvider: 'fork' });
  ctx.commands.register({
    definitionId: 'somnus:conversation-teamwork', name: '${TEAM_COMMAND}', recordInput: false,
    description: 'Somnus conversation Teamwork',
    async handler({ agent, rawInput, signal }) {
      const pending = rawInput.trim();
      const decline = { kind: 'error', text: 'Teamwork update not authorized' };
      // The host's exact single-use pending claim is authoritative, including random fork Session IDs.
      if (typeof agent?.session.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pending) ||
          rootOf(agent) !== agent || agent.status !== 'idle') return decline;
      const response = await fetch(process.env.${endpointVariable}, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.${tokenVariable} },
        body: JSON.stringify({ sessionId: agent.session.id, requestId: pending, name: '${TEAM_CLAIM}', args: {} }),
      });
      if (!response.ok || agent.status !== 'idle') return decline;
      const update = await response.json();
      if (agent.status !== 'idle' || typeof update.enabled !== 'boolean') return decline;
      const members = ctx.agents.list().filter(member => rootOf(member) === agent);
      if (update.enabled) {
        roots.add(agent);
        for (const member of members) created?.({ agent: member });
      } else if (roots.delete(agent)) {
        for (const member of members) disposed?.({ agent: member });
      }
      return { kind: 'success', text: update.enabled ? 'enabled' : 'disabled' };
    },
  });
}
`;
}

module.exports = { TEAM_COMMAND, TEAM_CLAIM, teamworkPlugin };
