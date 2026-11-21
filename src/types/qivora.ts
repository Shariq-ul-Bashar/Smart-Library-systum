export interface LinkedCollegeMembership {
  studentId: string;
  organizationId: string;
  collegeName: string;
  collegeCode?: string | null;
  studentIdCode: string;
  collegeRollNumber: string;
  courseName?: string | null;
  semesterName?: string | null;
  academicSession?: string | null;
  photoUrl?: string | null;
  membershipStatus: string;
  collegeLinkStatus: 'unlinked' | 'pending_college_approval' | 'approved' | 'revoked';
  collegeApprovedAt?: string | null;
}

export interface FounderIdentityRecord {
  id: string;
  profileId?: string | null;
  linkedOrganizationId?: string | null;
  linkedStudentId?: string | null;
  collegeLinkStatus: 'unlinked' | 'pending_college_approval' | 'approved' | 'revoked';
  collegeApprovedAt?: string | null;
  founderNumber: string;
  fullName: string;
  designation: string;
  organizationLabel: string;
  photoUrl?: string | null;
  editionName: string;
  bio?: string | null;
  status: string;
  issuedAt: string;
  qrToken?: string | null;
  qrIsActive?: boolean | null;
  linkedCollege?: LinkedCollegeMembership | null;
}

export interface FounderBadgeSummary {
  founderNumber: string;
  designation: string;
  editionName: string;
  fullName?: string;
  organizationLabel?: string;
  verifiedCreator: boolean;
}

export interface PremiumStudentSummary {
  isPremium: boolean;
  premiumTier: string;
  premiumDesign: string;
  premiumBadgeLabel: string;
  premiumGrantedAt?: string | null;
  premiumNote?: string | null;
}

