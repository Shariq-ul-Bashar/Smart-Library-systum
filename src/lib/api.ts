import { dispatchFirebaseApi } from './firebase-backend/router.ts';
import { BackendError } from './firebase-backend/helpers.ts';

let activeOrgId: string | null = null;

export function setApiToken(_token: string | null) {
  // Firebase Authentication manages ID tokens natively via the Firebase SDK.
}

export function setApiTokenProvider(_provider: (() => Promise<string | null>) | null) {
  // Firebase Authentication manages ID tokens natively via the Firebase SDK.
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

/**
 * Firebase-only API dispatcher.
 * All QIVORA operations execute directly against Firebase Authentication and Cloud Firestore,
 * eliminating Express /api/* 404 errors on static deployments (such as Vercel).
 */
export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    organizationId?: string | null;
    skipAuth?: boolean;
  } = {}
): Promise<T> {
  const orgId = options.organizationId !== undefined ? options.organizationId : activeOrgId;

  try {
    return await dispatchFirebaseApi<T>(path, {
      method: options.method || 'GET',
      body: options.body,
      organizationId: orgId,
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (err instanceof BackendError) {
      throw new ApiError(err.message, err.status);
    }
    const message = err instanceof Error ? err.message : 'Firebase request failed.';
    throw new ApiError(message, 500);
  }
}

async function compressImageToDataUrl(file: File, maxDimension = 1200, quality = 0.82): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });

  if (!file.type.startsWith('image/') || file.size <= 220 * 1024) {
    return rawDataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outputType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
        let compressed = canvas.toDataURL(outputType, quality);
        if (compressed.length > 440_000) {
          compressed = canvas.toDataURL('image/jpeg', 0.65);
        }
        resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export async function uploadAssetFile(file: File, bucket: string): Promise<{ url: string; id: string }> {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type.toLowerCase())) {
    throw new Error('Unsupported format. Please upload PNG, JPG, JPEG, WebP, or PDF.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File is too large. Maximum allowed size is 5 MB.');
  }

  const dataUrl = await compressImageToDataUrl(file);
  if (dataUrl.length > 480_000) {
    throw new Error('Processed file exceeds safe document storage size (450 KB). Please choose a smaller image.');
  }

  // On public registration (/register) or Super Admin (/platform) there is no activeOrgId;
  // return the optimized inline asset directly so uploads work everywhere cleanly.
  if (!activeOrgId) {
    return {
      id: `inline_${Date.now().toString(36)}`,
      url: dataUrl,
    };
  }

  try {
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
  } catch {
    return {
      id: `inline_${Date.now().toString(36)}`,
      url: dataUrl,
    };
  }
}
