let inMemoryToken: string | null = null;
let tokenProvider: (() => Promise<string | null>) | null = null;
let activeOrgId: string | null = null;

export function setApiToken(token: string | null) {
  inMemoryToken = token;
}

export function setApiTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider;
}

export function setApiOrganizationId(orgId: string | null) {
  activeOrgId = orgId;
}

export function getApiOrganizationId(): string | null {
  return activeOrgId;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    organizationId?: string | null;
    skipAuth?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!options.skipAuth) {
    let token = inMemoryToken;
    if (tokenProvider) {
      const fresh = await tokenProvider();
      if (fresh) token = fresh;
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const orgId = options.organizationId !== undefined ? options.organizationId : activeOrgId;
  if (orgId) {
    headers['x-organization-id'] = orgId;
  }

  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  return data as T;
}

export async function uploadAssetFile(file: File, bucket: string): Promise<{ url: string; id: string }> {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type.toLowerCase())) {
    throw new Error('Unsupported format. Please upload PNG, JPG, JPEG, WebP, or PDF.');
  }
  if (file.size > 3 * 1024 * 1024) {
    throw new Error('File is too large. Maximum allowed size is 3 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });

  const res = await apiRequest<{ asset: { id: string; url: string } }>('/org/storage/upload', {
    method: 'POST',
    body: {
      bucket,
      fileName: file.name,
      mimeType: file.type,
      dataUrl,
    },
  });
  return res.asset;
}
