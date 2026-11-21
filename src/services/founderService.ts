import { apiRequest } from '../lib/api.ts';
import type { FounderIdentityRecord } from '../types/qivora.ts';

export const founderService = {
  listAll: () => apiRequest<{ founderIds: FounderIdentityRecord[] }>('/platform/founder-ids'),

  issue: (payload: {
    fullName: string;
    designation: string;
    organizationLabel: string;
    profileEmail?: string;
    bio?: string;
    photoUrl?: string | null;
    linkedOrganizationId?: string | null;
    linkedStudentId?: string | null;
  }) =>
    apiRequest<{ founderId: FounderIdentityRecord }>('/platform/founder-ids', {
      method: 'POST',
      body: payload,
    }),

  linkCollegeStudent: (
    founderId: string,
    payload: {
      linkedOrganizationId: string | null;
      linkedStudentId: string | null;
      autoApproveIfSameAdmin?: boolean;
    }
  ) =>
    apiRequest<{ founderId: FounderIdentityRecord; message: string }>(
      `/platform/founder-ids/${founderId}/link-student`,
      {
        method: 'PATCH',
        body: payload,
      }
    ),

  regenerateToken: (founderId: string) =>
    apiRequest<{ founderId: FounderIdentityRecord }>(`/platform/founder-ids/${founderId}/regenerate`, {
      method: 'POST',
    }),

  revoke: (founderId: string, reason: string) =>
    apiRequest<{ message: string }>(`/platform/founder-ids/${founderId}/revoke`, {
      method: 'POST',
      body: { reason },
    }),

  listOrgStudentsForLinking: (organizationId: string) =>
    apiRequest<{
      students: Array<{
        id: string;
        fullName: string;
        studentIdCode: string;
        collegeRollNumber: string;
        email: string;
        status: string;
        courseName?: string | null;
        semesterName?: string | null;
      }>;
    }>(`/platform/organizations/${organizationId}/students-lookup`),

  collegeAdminReviewFounderLink: (
    studentId: string,
    decision: 'approved' | 'revoked',
    reason?: string
  ) =>
    apiRequest<{ message: string; collegeLinkStatus: string }>(
      `/org/students/${studentId}/founder-link`,
      {
        method: 'PATCH',
        body: { decision, reason },
      }
    ),
};
