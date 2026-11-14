import { readFileSync } from 'node:fs';

/** Gets a fresh access token from the clasp credential file (refresh-token grant). */
export async function accessToken(authFile: string): Promise<string> {
  const j = JSON.parse(readFileSync(authFile, 'utf8')) as { tokens?: { default?: Record<string, string> } } & Record<string, string>;
  const t = j.tokens?.default ?? (j as Record<string, string>);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: t.client_id!, client_secret: t.client_secret!, refresh_token: t.refresh_token!, grant_type: 'refresh_token' }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`token refresh failed: ${body.error ?? res.status}`);
  return body.access_token;
}

interface EntryPoint {
  entryPointType?: string;
  webApp?: { entryPointConfig?: { access?: string; executeAs?: string } };
}
interface ApiDeployment {
  deploymentConfig?: { versionNumber?: number };
  entryPoints?: EntryPoint[];
}

/** One line per deployment: version and web app access settings. Never prints ids or URLs. */
export async function describeDeployments(authFile: string, scriptId: string): Promise<string[]> {
  const token = await accessToken(authFile);
  const res = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/deployments`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { deployments?: ApiDeployment[]; error?: { message?: string } };
  if (!body.deployments) return [`deployments lookup failed: HTTP ${res.status} ${body.error?.message ?? ''}`];
  return body.deployments.map((d) => {
    const eps = (d.entryPoints ?? []).map((e) => `${e.entryPointType}${e.webApp ? `(access=${e.webApp.entryPointConfig?.access}, executeAs=${e.webApp.entryPointConfig?.executeAs})` : ''}`);
    return `deployment version=${d.deploymentConfig?.versionNumber ?? 'HEAD'} entryPoints=[${eps.join(', ')}]`;
  });
}
