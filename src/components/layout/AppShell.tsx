import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Award,
  Bell,
  BookOpen,
  Building2,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Crown,
  Database,
  FileBarChart,
  History,
  IdCard,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Moon,
  Palette,
  Plug,
  QrCode,
  Receipt,
  Repeat,
  Search,
  Settings,
  Shield,
  Sun,
  User,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { type ActiveWorkspace, useAuth } from '../../contexts/AuthContext.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { cn, formatDateTime } from '../../lib/utils.ts';
import { QivoraFooter, QivoraLogo } from '../brand/QivoraLogo.tsx';
import { Button, Modal } from '../ui/primitives.tsx';

export interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  shortLabel?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

function getNavGroupsForWorkspace(ws: ActiveWorkspace | null): NavGroup[] {
  if (!ws) return [];
  if (ws.type === 'platform') {
    return [
      {
        id: 'platform-core',
        label: 'Platform Governance',
        items: [
          { label: 'Overview', to: '/platform', icon: LayoutDashboard, shortLabel: 'Home' },
          { label: 'Organizations', to: '/platform/organizations', icon: Building2, shortLabel: 'Orgs' },
          { label: 'Users & Passwords', to: '/platform/accounts', icon: KeyRound, shortLabel: 'Accounts' },
          { label: 'Founder & Premium IDs', to: '/platform/student-tiers', icon: Crown, shortLabel: 'Tiers' },
          { label: 'College Admins', to: '/platform/college-admins', icon: Shield, shortLabel: 'Admins' },
          { label: 'Founder Registry', to: '/platform/founder-ids', icon: Award, shortLabel: 'Founders' },
        ],
      },
      {
        id: 'platform-ops',
        label: 'Infrastructure & Controls',
        items: [
          { label: 'Integrations Hub', to: '/platform/integrations', icon: Plug, shortLabel: 'Integrations' },
          { label: 'Platform Settings', to: '/platform/settings', icon: Settings, shortLabel: 'Settings' },
          { label: 'Audit Logs', to: '/platform/audit-logs', icon: History, shortLabel: 'Audit' },
          { label: 'System Health', to: '/platform/health', icon: Activity, shortLabel: 'Health' },
        ],
      },
    ];
  }

  const role = ws.membership.roleSlug;
  if (role === 'college_admin') {
    return [
      {
        id: 'admin-core',
        label: 'Library Operations',
        items: [
          { label: 'Overview', to: '/org', icon: LayoutDashboard, shortLabel: 'Home' },
          { label: 'Issue & Return', to: '/org/circulation', icon: Repeat, shortLabel: 'Desk' },
          { label: 'Books & Inventory', to: '/org/books', icon: BookOpen, shortLabel: 'Books' },
          { label: 'Reservations', to: '/org/reservations', icon: Library, shortLabel: 'Queue' },
          { label: 'Fines & Payments', to: '/org/fines', icon: Receipt, shortLabel: 'Fines' },
          { label: 'Attendance Gate', to: '/org/attendance', icon: QrCode, shortLabel: 'Gate' },
        ],
      },
      {
        id: 'admin-people',
        label: 'Members & Digital ID',
        items: [
          { label: 'Students', to: '/org/students', icon: Users, shortLabel: 'Students' },
          { label: 'Applications', to: '/org/applications', icon: UserCheck, shortLabel: 'Apps' },
          { label: 'Librarians', to: '/org/librarians', icon: Shield, shortLabel: 'Staff' },
          { label: 'Digital ID Cards', to: '/org/id-cards', icon: IdCard, shortLabel: 'IDs' },
          { label: 'ID Template Studio', to: '/org/id-studio', icon: Palette, shortLabel: 'Studio' },
          { label: 'ID Assignments', to: '/org/id-assignments', icon: Layers, shortLabel: 'Assign' },
        ],
      },
      {
        id: 'admin-intelligence',
        label: 'Intelligence & Migration',
        items: [
          { label: 'Enterprise Analytics', to: '/org/reports', icon: FileBarChart, shortLabel: 'Analytics' },
          { label: 'Smart Automation', to: '/org/automations', icon: Zap, shortLabel: 'Automate' },
          { label: 'Migration Center', to: '/org/migration', icon: Database, shortLabel: 'Migrate' },
          { label: 'Notification Center', to: '/org/notifications', icon: Bell, shortLabel: 'Alerts' },
        ],
      },
      {
        id: 'admin-gov',
        label: 'Institution Governance',
        items: [
          { label: 'College Branding', to: '/org/branding', icon: Building2, shortLabel: 'Brand' },
          { label: 'Library Settings', to: '/org/settings', icon: Settings, shortLabel: 'Rules' },
          { label: 'Audit Logs', to: '/org/audit-logs', icon: History, shortLabel: 'Audit' },
        ],
      },
    ];
  }

  if (role === 'librarian') {
    return [
      {
        id: 'lib-desk',
        label: 'Circulation Desk',
        items: [
          { label: 'Overview', to: '/org', icon: LayoutDashboard, shortLabel: 'Home' },
          { label: 'Issue & Return', to: '/org/circulation', icon: Repeat, shortLabel: 'Desk' },
          { label: 'Attendance Gate', to: '/org/attendance', icon: QrCode, shortLabel: 'Gate' },
          { label: 'Reservations', to: '/org/reservations', icon: Library, shortLabel: 'Queue' },
          { label: 'Fines & Payments', to: '/org/fines', icon: Receipt, shortLabel: 'Fines' },
        ],
      },
      {
        id: 'lib-catalog',
        label: 'Catalog & Members',
        items: [
          { label: 'Books & Inventory', to: '/org/books', icon: BookOpen, shortLabel: 'Books' },
          { label: 'Students', to: '/org/students', icon: Users, shortLabel: 'Students' },
          { label: 'Applications', to: '/org/applications', icon: UserCheck, shortLabel: 'Apps' },
          { label: 'Digital ID Cards', to: '/org/id-cards', icon: IdCard, shortLabel: 'IDs' },
        ],
      },
      {
        id: 'lib-tools',
        label: 'Tools & Analytics',
        items: [
          { label: 'Migration Center', to: '/org/migration', icon: Database, shortLabel: 'Import' },
          { label: 'Smart Automation', to: '/org/automations', icon: Zap, shortLabel: 'Jobs' },
          { label: 'Notification Center', to: '/org/notifications', icon: Bell, shortLabel: 'Alerts' },
          { label: 'Reports & Analytics', to: '/org/reports', icon: FileBarChart, shortLabel: 'Reports' },
        ],
      },
    ];
  }

  return [
    {
      id: 'stu-main',
      label: 'Student Library Portal',
      items: [
        { label: 'Dashboard', to: '/student', icon: LayoutDashboard, shortLabel: 'Home' },
        { label: 'My Digital ID', to: '/student/digital-id', icon: CreditCard, shortLabel: 'My ID' },
        { label: 'Explore Books', to: '/student/books', icon: BookOpen, shortLabel: 'Catalog' },
        { label: 'My Borrowed Books', to: '/student/loans', icon: Repeat, shortLabel: 'Books' },
        { label: 'Reservations', to: '/student/reservations', icon: Library, shortLabel: 'Reserved' },
        { label: 'Fine History', to: '/student/fines', icon: Receipt, shortLabel: 'Fines' },
        { label: 'Attendance', to: '/student/attendance', icon: QrCode, shortLabel: 'Visits' },
        { label: 'Notifications', to: '/student/notifications', icon: Bell, shortLabel: 'Alerts' },
        { label: 'Profile & Support', to: '/student/profile', icon: Settings, shortLabel: 'Profile' },
      ],
    },
  ];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, memberships, activeWorkspace, selectWorkspace, logout } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moduleSearch, setModuleSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const navGroups = useMemo(() => getNavGroupsForWorkspace(activeWorkspace), [activeWorkspace]);
  const flatNavItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);

  const filteredGroups = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    if (!q) return navGroups;
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [navGroups, moduleSearch]);

  // Prevent background scrolling when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Global productivity keyboard shortcuts (Ctrl/Cmd+K, Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+R)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (activeWorkspace?.type === 'organization') setSearchOpen(true);
      } else if (
        mod &&
        e.shiftKey &&
        e.key.toLowerCase() === 'i' &&
        activeWorkspace?.type === 'organization' &&
        activeWorkspace.membership.roleSlug !== 'student'
      ) {
        e.preventDefault();
        navigate('/org/circulation?tab=issue');
      } else if (
        mod &&
        e.shiftKey &&
        e.key.toLowerCase() === 'r' &&
        activeWorkspace?.type === 'organization' &&
        activeWorkspace.membership.roleSlug !== 'student'
      ) {
        e.preventDefault();
        navigate('/org/circulation?tab=return');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeWorkspace, navigate]);

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiRequest<{
        notifications: Array<{
          id: string;
          title: string;
          message: string;
          type: string;
          isRead: boolean;
          createdAt: string;
        }>;
        unreadCount: number;
      }>('/org/notifications'),
    enabled: Boolean(user),
    refetchInterval: 30000,
  });

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: [
      'global-search',
      activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null,
      searchQuery,
    ],
    queryFn: () =>
      apiRequest<{
        students: Array<{ id: string; fullName: string; studentIdCode: string; collegeRollNumber: string }>;
        books: Array<{ id: string; title: string; isbn: string; subject?: string }>;
        copies: Array<{ id: string; barcode: string; status: string; bookTitle: string }>;
        loans: Array<{ id: string; receiptNumber: string; studentName: string; bookTitle: string }>;
      }>(`/org/search?q=${encodeURIComponent(searchQuery)}`),
    enabled: searchOpen && activeWorkspace?.type === 'organization' && searchQuery.trim().length >= 2,
  });

  const markAllRead = async () => {
    await apiRequest('/org/notifications/read-all', { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markOneRead = async (id: string) => {
    await apiRequest(`/org/notifications/${id}/read`, { method: 'PATCH' });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handleWorkspaceSelect = (ws: ActiveWorkspace) => {
    selectWorkspace(ws);
    setWorkspaceMenuOpen(false);
    queryClient.clear();
    if (ws.type === 'platform') {
      navigate('/platform');
    } else if (ws.membership.roleSlug === 'student') {
      navigate('/student');
    } else {
      navigate('/org');
    }
  };

  const currentNav =
    flatNavItems.find((item) => location.pathname === item.to) ||
    flatNavItems.find(
      (item) =>
        item.to !== '/platform' &&
        item.to !== '/org' &&
        item.to !== '/student' &&
        location.pathname.startsWith(item.to)
    ) ||
    flatNavItems[0];

  const workspaceShortLabel =
    activeWorkspace?.type === 'platform'
      ? 'Platform Super Admin'
      : activeWorkspace
        ? activeWorkspace.membership.organizationName
        : 'QIVORA';

  const canSwitchWorkspace = (user?.isSuperAdmin ? 1 : 0) + memberships.length > 1;

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen flex bg-[#F4F6FA] text-[#0F172A] dark:bg-[#0B1120] dark:text-[#F1F5F9]">
      {/* Desktop Fixed White Sidebar (Expandable / Collapsible) */}
      <aside
        className={cn(
          'hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200/90 bg-white dark:border-slate-800 dark:bg-[#0F172A] transition-[width] duration-200 z-30',
          sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[268px]'
        )}
      >
        {/* Logo + Collapse Toggle */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-slate-100 dark:border-slate-800/90">
          <QivoraLogo size="sm" showTagline={!sidebarCollapsed} collapsed={sidebarCollapsed} />
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Workspace Selector + Module Search */}
        {!sidebarCollapsed && (
          <div className="px-3 pt-3 pb-2 space-y-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => canSwitchWorkspace && setWorkspaceMenuOpen((o) => !o)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-900/70',
                  canSwitchWorkspace && 'hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
                )}
              >
                <div className="min-w-0">
                  <div className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                    {activeWorkspace?.type === 'platform'
                      ? 'Global Governance'
                      : activeWorkspace?.membership.roleName || 'Workspace'}
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {activeWorkspace?.type === 'platform'
                      ? 'QIVORA Platform'
                      : activeWorkspace?.membership.organizationName || 'No Organization'}
                  </div>
                </div>
                {canSwitchWorkspace && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
              </button>

              {workspaceMenuOpen && canSwitchWorkspace && (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-[#111827]">
                  {user?.isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => handleWorkspaceSelect({ type: 'platform' })}
                      className={cn(
                        'w-full rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                        activeWorkspace?.type === 'platform'
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 font-semibold'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                      )}
                    >
                      <div>QIVORA Platform</div>
                      <div className="text-[11px] text-slate-500">Platform Super Admin</div>
                    </button>
                  )}
                  {memberships.map((m) => (
                    <button
                      key={m.membershipId}
                      type="button"
                      onClick={() => handleWorkspaceSelect({ type: 'organization', membership: m })}
                      className={cn(
                        'w-full rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                        activeWorkspace?.type === 'organization' &&
                          activeWorkspace.membership.membershipId === m.membershipId
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 font-semibold'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                      )}
                    >
                      <div className="truncate">{m.organizationName}</div>
                      <div className="text-[11px] text-slate-500">
                        {m.roleName} · {m.organizationCode}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Search Modules Input */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={moduleSearch}
                onChange={(e) => setModuleSearch(e.target.value)}
                placeholder="Search modules..."
                aria-label="Search navigation modules"
                className="w-full h-8 rounded-xl border border-slate-200/90 bg-slate-50/70 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#4F46E5] focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:focus:bg-slate-900"
              />
            </div>
          </div>
        )}

        {/* Collapsible Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {filteredGroups.map((group) => {
            const isGroupCollapsed = Boolean(collapsedGroups[group.id]) && !moduleSearch;
            return (
              <div key={group.id} className="space-y-1">
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer"
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform',
                        isGroupCollapsed && '-rotate-90'
                      )}
                    />
                  </button>
                )}
                {!isGroupCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = location.pathname === item.to;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          title={sidebarCollapsed ? item.label : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all whitespace-nowrap',
                            sidebarCollapsed && 'justify-center px-2',
                            active
                              ? 'bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white'
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom User Profile & Logout */}
        <div className="border-t border-slate-100 dark:border-slate-800 p-3">
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-900/70 p-2',
              sidebarCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#7C3AED] text-white flex items-center justify-center shrink-0 overflow-hidden text-xs font-bold">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  (user?.fullName || 'Q').slice(0, 1).toUpperCase()
                )}
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {user?.fullName}
                  </div>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                    {user?.email}
                  </div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400 cursor-pointer shrink-0"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile / Tablet Slide-Out Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex w-76 max-w-[85vw] flex-col bg-white dark:bg-[#0F172A] h-full shadow-2xl">
            <div className="flex h-16 items-center justify-between px-4 border-b border-slate-100 dark:border-slate-800">
              <QivoraLogo size="sm" showTagline />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {canSwitchWorkspace && (
                <div className="pb-3 border-b border-slate-100 dark:border-slate-800 space-y-1">
                  <div className="px-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                    Authorized Workspaces
                  </div>
                  {user?.isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        handleWorkspaceSelect({ type: 'platform' });
                        setMobileMenuOpen(false);
                      }}
                      className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      QIVORA Platform · Super Admin
                    </button>
                  )}
                  {memberships.map((m) => (
                    <button
                      key={m.membershipId}
                      type="button"
                      onClick={() => {
                        handleWorkspaceSelect({ type: 'organization', membership: m });
                        setMobileMenuOpen(false);
                      }}
                      className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {m.organizationName} · {m.roleName}
                    </button>
                  ))}
                </div>
              )}

              {navGroups.map((group) => (
                <div key={group.id} className="space-y-1">
                  <div className="px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = location.pathname === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                          active
                            ? 'bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
              <Button variant="outline" className="w-full" onClick={logout}>
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
              <QivoraFooter compact />
            </div>
          </div>
        </div>
      )}

      {/* Main Content Workspace */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 transition-[padding] duration-200',
          sidebarCollapsed ? 'lg:pl-[76px]' : 'lg:pl-[268px]'
        )}
      >
        {/* Clean White Top Navigation */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/95 backdrop-blur px-4 sm:px-6 dark:border-slate-800 dark:bg-[#0F172A]/95">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="truncate max-w-[180px]">{workspaceShortLabel}</span>
                <span>/</span>
                <span className="truncate">{currentNav?.label || 'Dashboard'}</span>
              </div>
              <div className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {currentNav?.label || 'Dashboard'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeWorkspace?.type === 'organization' && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:border-[#4F46E5]/50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Quick Search</span>
                <kbd className="hidden md:inline font-mono text-[10px] text-slate-400">⌘K</kbd>
              </button>
            )}

            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label="Notifications"
              className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Bell className="h-4.5 w-4.5" />
              {(notifData?.unreadCount || 0) > 0 && (
                <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-[#2563EB] to-[#7C3AED] px-1 text-[10px] font-bold text-white tabular-nums">
                  {notifData!.unreadCount > 9 ? '9+' : notifData!.unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} mode`}
              className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>

            {/* Profile Avatar & Account Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white pl-1.5 pr-2.5 py-1 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 cursor-pointer"
              >
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#7C3AED] text-white flex items-center justify-center overflow-hidden text-xs font-bold">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </div>
                <span className="hidden md:inline text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[110px] truncate">
                  {user?.fullName}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {accountMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-[#111827]">
                    <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {user?.fullName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
                    </div>
                    <div className="py-1 space-y-0.5 text-xs">
                      <Link
                        to="/verify"
                        onClick={() => setAccountMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Public ID Verification
                      </Link>
                      {activeWorkspace?.type === 'organization' && (
                        <Link
                          to={
                            activeWorkspace.membership.roleSlug === 'student'
                              ? '/student/notifications'
                              : '/org/notifications'
                          }
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          Notification Center
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setAboutOpen(true);
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Info className="h-3.5 w-3.5" />
                        About QIVORA
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-20 lg:pb-10 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Mandatory Subtle Footer */}
        <footer className="border-t border-slate-200/80 bg-white/70 dark:border-slate-800/80 dark:bg-[#0F172A]/60 px-4 sm:px-8 py-3.5 mb-14 lg:mb-0">
          <QivoraFooter onAboutClick={() => setAboutOpen(true)} />
        </footer>
      </div>

      {/* Compact Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-20 flex lg:hidden h-14 items-center justify-around border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-[#0F172A]/95 px-2">
        {flatNavItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[10px] font-medium min-w-[54px]',
                active
                  ? 'text-[#4F46E5] dark:text-[#818CF8]'
                  : 'text-slate-500 dark:text-slate-400'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{item.shortLabel || item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Role-Scoped Global Search Modal */}
      <Modal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="QIVORA Global Search"
        description="Search authorized records inside your active institution. Shortcuts: ⌘K Search · ⌘⇧I Issue · ⌘⇧R Return"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search books, ISBN, student roll numbers, barcodes, or receipt IDs..."
              autoFocus
              className="w-full h-11 rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-slate-700 dark:bg-[#0F172A] dark:text-white"
            />
          </div>

          {searchQuery.trim().length < 2 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
              Type at least 2 characters to search across authorized library records.
            </p>
          ) : searching ? (
            <p className="text-xs text-slate-500 py-4 text-center">Searching records...</p>
          ) : (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto">
              {(searchResults?.books?.length || 0) > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Books</div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {searchResults!.books.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          navigate(
                            activeWorkspace?.type === 'organization' &&
                              activeWorkspace.membership.roleSlug === 'student'
                              ? '/student/books'
                              : '/org/books'
                          );
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">{b.title}</span>
                        <span className="font-mono text-slate-500">{b.isbn}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(searchResults?.students?.length || 0) > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Students</div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {searchResults!.students.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          navigate('/org/students');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">{s.fullName}</span>
                        <span className="font-mono text-slate-500">
                          {s.studentIdCode} · Roll {s.collegeRollNumber}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(searchResults?.copies?.length || 0) > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Physical Copies</div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {searchResults!.copies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          navigate('/org/circulation');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">{c.bookTitle}</span>
                        <span className="font-mono text-slate-500">
                          {c.barcode} · {c.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!(
                searchResults?.books?.length ||
                searchResults?.students?.length ||
                searchResults?.copies?.length
              ) && (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No matching records found for "{searchQuery}".
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Quick Notifications Drawer Modal */}
      <Modal
        open={notifOpen}
        onOpenChange={setNotifOpen}
        title="Notifications"
        description="Real-time in-app alerts scoped to your account."
        maxWidth="max-w-lg"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            {activeWorkspace?.type === 'organization' && (
              <Link
                to={
                  activeWorkspace.membership.roleSlug === 'student'
                    ? '/student/notifications'
                    : '/org/notifications'
                }
                onClick={() => setNotifOpen(false)}
                className="text-xs font-medium text-[#4F46E5] hover:underline"
              >
                Open Full Notification Center
              </Link>
            )}
            {(notifData?.unreadCount || 0) > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </Button>
            )}
          </div>
          {!notifData?.notifications?.length ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              You have no notifications yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[60vh] overflow-y-auto">
              {notifData.notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.isRead && markOneRead(n.id)}
                  className={cn(
                    'py-3 px-2.5 rounded-xl transition-colors',
                    !n.isRead
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/30 cursor-pointer'
                      : 'opacity-80'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      {n.title}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {n.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* About QIVORA Modal */}
      <Modal
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        title="About QIVORA"
        description="Smart Library Management System — Intelligence for Every Library."
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <QivoraLogo size="md" showTagline />
            <span className="font-mono text-[11px] font-semibold text-[#4F46E5] dark:text-indigo-400">
              Production v2.0
            </span>
          </div>

          <p>
            <strong>QIVORA</strong> is a multi-tenant institutional Library Management SaaS built for
            colleges and universities. It unifies copy-level book inventory, atomic circulation
            workflows, fines, reservations, attendance gates, institutional Digital ID cards, and
            linked Golden Founder credentials under strict per-institution data isolation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="font-semibold text-slate-900 dark:text-white">Multi-Tenant Security</div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Server-enforced RBAC across Platform Super Admin, College Admin, Librarian, and Student workspaces.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="font-semibold text-slate-900 dark:text-white">Linked Founder Identity</div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Golden Founder IDs unify creator verification with real College Student records without bypassing library policies.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/60 p-4 text-center dark:border-indigo-900/60 dark:bg-indigo-950/30">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Designed &amp; Developed by MOHAMMAD SHARIQ
            </div>
            <div className="mt-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              BCA 1st Year | 2026–2027 Batch
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
