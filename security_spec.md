# QIVORA Firestore Security Specification (Phase 0 — Payload-First Security TDD)

## 1. Core Data Invariants
1. **Zero Self-Privilege Escalation**: No user may create or update `/admins/{uid}`, set `isSuperAdmin: true` on `/users/{uid}`, or fabricate `/memberships/{membershipId}` unless they are already a verified Platform Super Admin (or claiming a matching server/admin-created `/pendingInvites/{inviteId}` for their own verified email).
2. **Strict Multi-Tenant Isolation**: Every institutional subcollection under `/organizations/{orgId}/...` requires the parent organization to exist and restricts access to active members of that exact `orgId` (or Platform Super Admin).
3. **Exclusive Super Admin Founder & Premium Control**:
   - `/founderIdentities/{founderId}` is writable **exclusively** by Platform Super Admin. College Admins and Librarians receive `PERMISSION_DENIED`.
   - On `/organizations/{orgId}/students/{studentId}`, fields `isPremium`, `premiumTier`, `premiumDesign`, `premiumBadgeLabel`, `premiumGrantedAt`, and `premiumNote` cannot be modified by College Admins, Librarians, or Students — **only** Platform Super Admin.
4. **PII Isolation**:
   - `/users/{uid}` is readable only by the owner (`request.auth.uid == uid`) or Platform Super Admin.
   - `/publicQrRegistry/{token}` allows single-document `get` only (no `list`) and stores zero phone, email, address, DOB, or fine data.
5. **Audit Immutability**: `/platformAuditLogs/{logId}` and `/organizations/{orgId}/auditLogs/{logId}` are append-only (`update` and `delete` strictly denied).

## 2. The "Dirty Dozen" Attack Payloads (All MUST Return `PERMISSION_DENIED`)
1. **Unverified Admin Email Spoof**: User with email `mohammad@shariq.com` and `email_verified: false` tries to write `/admins/{uid}`.
2. **Self-SuperAdmin Escalation on Create**: New user writes `/users/{uid}` with `{ isSuperAdmin: true }`.
3. **Shadow Role Escalation on Update**: Existing student updates `/users/{uid}` adding `{ isSuperAdmin: true, status: "active" }`.
4. **Fabricated Membership Injection**: Student attempts to create `/memberships/orgA_uid_college_admin` with `{ roleSlug: "college_admin" }`.
5. **Cross-Tenant Book Creation**: Librarian of College A tries to create a book in `/organizations/orgB/books/book1`.
6. **College Admin Founder Spoofing**: College Admin attempts to create `/founderIdentities/fnd1`.
7. **College Admin Premium Student Escalation**: College Admin updates `/organizations/orgA/students/stu1` modifying `isPremium: true` and `premiumDesign: "royal_sapphire"`.
8. **Student Loan Tampering**: Student attempts to mark their own `/organizations/orgA/loans/loan1` as `status: "returned"`.
9. **Public QR Registry Scraping**: Unauthenticated client calls `list` on `/publicQrRegistry`.
10. **Other User PII Read**: Authenticated student tries `get` on `/users/otherUid`.
11. **ID Poisoning / Oversized Field**: Client tries to create a document with a 2KB ID or 50KB title string.
12. **Audit Log Tampering**: College Admin attempts to `delete` or `update` `/organizations/orgA/auditLogs/log1`.
