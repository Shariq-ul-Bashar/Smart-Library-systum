import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { AttendanceDeskPage } from './AttendanceDeskPage.tsx';
import { AutomationCenterPage } from './AutomationCenterPage.tsx';
import { BooksInventoryPage, CirculationDeskPage } from './BooksAndCirculationPages.tsx';
import { DigitalIdRegistryPage, IdAssignmentsPage, IdTemplateStudioPage } from './DigitalIdPages.tsx';
import { EnterpriseAnalyticsPage } from './EnterpriseAnalyticsPage.tsx';
import { MigrationCenterPage } from './MigrationCenterPage.tsx';
import { NotificationCenterPage } from './NotificationCenterPage.tsx';
import {
  CollegeBrandingPage,
  LibrariansPage,
  LibrarySettingsPage,
  OrgAuditLogsPage,
} from './OrgGovernancePage.tsx';
import { OrgOverviewPage } from './OrgOverviewPage.tsx';
import { FinesAndPaymentsPage, ReservationsPage } from './ReservationsAndFinesPage.tsx';
import { StudentApplicationsPage, StudentsPage } from './StudentsAndAppsPage.tsx';

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { activeWorkspace } = useAuth();
  const isAdmin =
    activeWorkspace?.type === 'organization' &&
    activeWorkspace.membership.roleSlug === 'college_admin';
  if (!isAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

export function OrgWorkspace() {
  return (
    <Routes>
      <Route index element={<OrgOverviewPage />} />
      <Route path="students" element={<StudentsPage />} />
      <Route path="applications" element={<StudentApplicationsPage />} />
      <Route path="books" element={<BooksInventoryPage />} />
      <Route path="circulation" element={<CirculationDeskPage />} />
      <Route path="reservations" element={<ReservationsPage />} />
      <Route path="fines" element={<FinesAndPaymentsPage />} />
      <Route path="attendance" element={<AttendanceDeskPage />} />
      <Route path="id-cards" element={<DigitalIdRegistryPage />} />
      <Route path="reports" element={<EnterpriseAnalyticsPage />} />
      <Route path="automations" element={<AutomationCenterPage />} />
      <Route path="migration" element={<MigrationCenterPage />} />
      <Route path="notifications" element={<NotificationCenterPage />} />

      {/* Strictly College Admin Only Routes (also enforced server-side) */}
      <Route
        path="librarians"
        element={
          <AdminOnlyRoute>
            <LibrariansPage />
          </AdminOnlyRoute>
        }
      />
      <Route
        path="id-studio"
        element={
          <AdminOnlyRoute>
            <IdTemplateStudioPage />
          </AdminOnlyRoute>
        }
      />
      <Route
        path="id-assignments"
        element={
          <AdminOnlyRoute>
            <IdAssignmentsPage />
          </AdminOnlyRoute>
        }
      />
      <Route
        path="branding"
        element={
          <AdminOnlyRoute>
            <CollegeBrandingPage />
          </AdminOnlyRoute>
        }
      />
      <Route
        path="settings"
        element={
          <AdminOnlyRoute>
            <LibrarySettingsPage />
          </AdminOnlyRoute>
        }
      />
      <Route
        path="audit-logs"
        element={
          <AdminOnlyRoute>
            <OrgAuditLogsPage />
          </AdminOnlyRoute>
        }
      />
      <Route path="*" element={<Navigate to="/org" replace />} />
    </Routes>
  );
}
