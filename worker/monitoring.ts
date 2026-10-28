import { persistMailIssue as persist, scopedStatus } from './monitoring-core.ts';
import type { MailIssue } from './monitoring-core.ts';
import type { Env } from './contact.ts';
export async function persistMailIssue(env: Env, issue: MailIssue): Promise<void> {
  return persist({ ENVIRONMENT: env.ENVIRONMENT, DELIVERY_STATUS: env.DELIVERY_STATUS ? scopedStatus(env.DELIVERY_STATUS, 'carrie') : undefined }, issue);
}
