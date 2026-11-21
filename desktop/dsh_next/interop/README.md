# DSH plugin capabilities in external ACP Agents

Somnus keeps the DSH Desktop shell and native DSH tools as the capability owner.
Choosing an external Agent changes the ACP reasoning process; it does not copy
DSH plugins into that process or grant extra filesystem/database permissions.

| Capability | External Agent behavior |
| --- | --- |
| DSH tools, including installed plugin tools and allowed MCP tools | A scoped MCP bridge discovers the tools admitted for the current DSH turn and invokes the original DSH executor. Native approvals, guards, workspace scope and cancellation remain in force. |
| DSH skills exposed through an admitted skill tool | Read through the same native tool. Tool-produced context remains in the owning conversation. |
| DSH client UI plugins | Continue to run in the common DSH shell; they are not presented as callable Agent tools. |
| DSH internal runtime hooks and provider extensions | Remain native DSH features. They are not advertised as portable ACP plugins. |
| External Agent without usable MCP transport | Chat/context handoff can continue; native DSH plugin tools are explicitly unavailable. No tool results are simulated. |

The bridge provides two stable MCP tools: `somnus_list_tools` and
`somnus_call_tool`. The external Agent must discover the current native tool
name and schema before calling it. A tool removed or restricted by DSH stops
being callable even if the external process retained an older schema.

Each native conversation/external Agent pair has a separate opaque loopback
capability. It is active only while the corresponding native turn is running.
The global ACP Host token and native provider credentials are not delegated.
HTTP-capable ACP Agents use authenticated HTTP. Other ACP Agents can use the
fixed app-owned stdio relay; arbitrary destinations and executable paths do not
come from the model. Journal events use `somnus/acp-tool`, identifying the real
external caller and settled native result rather than inventing assistant calls.

Run the deterministic boundary tests without network or model calls:

```powershell
node --test desktop/dsh_next/interop/plugin-interop.test.mjs
```
