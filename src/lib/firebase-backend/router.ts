import { handleAuthAndPublicRoute, handlePlatformRoute } from './auth-and-platform.ts';
import { BackendError } from './helpers.ts';
import { handleOrgAndStudentRoute } from './org-and-student.ts';

export async function dispatchFirebaseApi<T>(
  rawPath: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    organizationId?: string | null;
  } = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const url = new URL(normalized, 'https://qivora.local');
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  const authRes = await handleAuthAndPublicRoute(method, pathname, searchParams, options.body);
  if (authRes.handled) return authRes.data as T;

  const platformRes = await handlePlatformRoute(method, pathname, searchParams, options.body);
  if (platformRes.handled) return platformRes.data as T;

  const orgRes = await handleOrgAndStudentRoute(
    method,
    pathname,
    searchParams,
    options.body,
    options.organizationId
  );
  if (orgRes.handled) return orgRes.data as T;

  throw new BackendError(`Unhandled Firebase route: ${method} ${pathname}`, 404);
}
