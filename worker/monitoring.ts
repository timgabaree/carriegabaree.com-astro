import type { Env } from './contact.ts';
// Structured diagnostics only. Alerting is deliberately deferred until all migrations finish.
export async function persistMailIssue(env: Env, code: 'send_configuration' | 'send_rejected' | 'send_response_invalid' | 'send_timeout_or_network' | 'contact_runtime_error'): Promise<void> {
  console.error(JSON.stringify({event:'CARRIE_CONTACT_ERROR', environment:env.ENVIRONMENT, code}));
}
