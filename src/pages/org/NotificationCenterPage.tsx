import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, FileText, Mail, Megaphone, Send, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/utils.ts';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationPrefs {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  categories: Record<string, boolean>;
}

interface NotificationTemplate {
  id: string;
  eventKey: string;
  channel: string;
  subject: string;
  bodyTemplate: string;
  isEnabled: boolean;
}

interface DeliveryRow {
  id: string;
  recipientEmail?: string | null;
  channel: string;
  status: string;
  providerResponse?: string | null;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  registration: 'Registration & Approvals',
  id_status: 'Digital ID Lifecycle',
  circulation: 'Book Issue & Returns',
  due_reminders: 'Due Date Reminders',
  overdue: 'Overdue Alerts',
  reservations: 'Reservations & Holds',
  fines: 'Fines & Payments',
  attendance: 'Library Attendance',
  announcements: 'Institution Announcements',
};

export function NotificationCenterPage() {
  const { activeWorkspace } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'preferences' | 'templates' | 'deliveries'>('inbox');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMessage, setAnnounceMessage] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);

  const role =
    activeWorkspace?.type === 'organization' ? activeWorkspace.membership.roleSlug : 'student';
  const isAdmin = role === 'college_admin';
  const isStaff = role === 'college_admin' || role === 'librarian';

  const { data, isLoading } = useQuery({
    queryKey: ['notification-center'],
    queryFn: () =>
      apiRequest<{
        notifications: NotificationItem[];
        preferences: NotificationPrefs;
        templates: NotificationTemplate[];
        deliveries: DeliveryRow[];
        providers: {
          smtpConfigured: boolean;
          webPushConfigured: boolean;
          whatsappConfigured: boolean;
        };
      }>('/org/notifications/center'),
  });

  const [prefs, setPrefs] = useState<NotificationPrefs>({
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    categories: {},
  });

  useEffect(() => {
    if (data?.preferences) {
      setPrefs(data.preferences);
    }
  }, [data?.preferences]);

  const markAllRead = useMutation({
    mutationFn: () => apiRequest('/auth/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-center'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePrefs = useMutation({
    mutationFn: () =>
      apiRequest('/org/notifications/preferences', {
        method: 'PUT',
        body: prefs,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-center'] });
      toast.success('Notification preferences saved.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const announceMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ message: string }>('/org/notifications/announce', {
        method: 'POST',
        body: { title: announceTitle, message: announceMessage },
      }),
    onSuccess: (res) => {
      setAnnounceOpen(false);
      setAnnounceTitle('');
      setAnnounceMessage('');
      queryClient.invalidateQueries({ queryKey: ['notification-center'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(res.message);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveTemplate = useMutation({
    mutationFn: (tpl: NotificationTemplate) =>
      apiRequest(`/org/notifications/templates/${tpl.id}`, {
        method: 'PATCH',
        body: {
          subject: tpl.subject,
          bodyTemplate: tpl.bodyTemplate,
          isEnabled: tpl.isEnabled,
        },
      }),
    onSuccess: () => {
      setEditingTemplate(null);
      queryClient.invalidateQueries({ queryKey: ['notification-center'] });
      toast.success('Notification template saved.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <SkeletonRows rows={6} />;

  const items = data?.notifications || [];
  const filtered =
    categoryFilter === 'all' ? items : items.filter((n) => n.type === categoryFilter);
  const unreadCount = items.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Notification Center
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Manage real-time library alerts, personal delivery preferences, institutional templates, and announcements.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
              <CheckCheck className="h-3.5 w-3.5" />
              Mark All Read ({unreadCount})
            </Button>
          )}
          {isStaff && (
            <Button size="sm" onClick={() => setAnnounceOpen(true)}>
              <Megaphone className="h-3.5 w-3.5" />
              Broadcast Announcement
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        {[
          { id: 'inbox' as const, label: `Inbox (${items.length})`, icon: Bell, show: true },
          { id: 'preferences' as const, label: 'Preferences', icon: Settings2, show: true },
          { id: 'templates' as const, label: 'Templates', icon: FileText, show: isAdmin },
          { id: 'deliveries' as const, label: 'Delivery Logs & Channels', icon: Mail, show: isStaff },
        ]
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  tab === t.id
                    ? 'bg-gradient-to-r from-[#2563EB] to-[#6D28D9] text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-[#111827] dark:text-slate-300 dark:border-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
      </div>

      {/* Tab 1: Inbox */}
      {tab === 'inbox' && (
        <SurfaceCard className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {['all', 'due_reminder', 'overdue', 'circulation', 'id_status', 'announcement', 'registration'].map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cat.replace('_', ' ')}
                  </button>
                )
              )}
            </div>
          </div>

          {!filtered.length ? (
            <EmptyState
              title="No notifications in this view"
              description="Library circulation updates, due date alerts, and institution announcements appear here automatically."
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((n) => (
                <div
                  key={n.id}
                  className={`py-3.5 flex items-start justify-between gap-4 ${
                    !n.isRead ? 'bg-indigo-50/40 -mx-5 px-5 dark:bg-indigo-950/20' : ''
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {!n.isRead && <span className="h-2 w-2 rounded-full bg-[#4F46E5] shrink-0" />}
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</span>
                      <span className="text-[10px] font-mono uppercase text-slate-400">{n.type}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{n.message}</p>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 shrink-0">
                    {formatDateTime(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Tab 2: Preferences */}
      {tab === 'preferences' && (
        <SurfaceCard className="p-6 space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Delivery Channels
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.inAppEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, inAppEnabled: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded accent-[#4F46E5]"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">In-App Inbox</div>
                  <div className="text-xs text-slate-500">Always active inside your QIVORA workspace.</div>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.emailEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, emailEnabled: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded accent-[#4F46E5]"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Email Notifications
                  </div>
                  <div className="text-xs text-slate-500">
                    {data?.providers.smtpConfigured
                      ? 'SMTP provider configured on server.'
                      : 'Preference saved (requires SMTP credentials in server environment).'}
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.pushEnabled}
                  onChange={(e) => setPrefs((p) => ({ ...p, pushEnabled: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded accent-[#4F46E5]"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Browser Web Push</div>
                  <div className="text-xs text-slate-500">
                    {data?.providers.webPushConfigured
                      ? 'VAPID keys configured on server.'
                      : 'Preference saved (requires VAPID push keys in server environment).'}
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Event Categories
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-medium dark:border-slate-800 cursor-pointer"
                >
                  <span className="text-slate-700 dark:text-slate-200">{label}</span>
                  <input
                    type="checkbox"
                    checked={prefs.categories?.[key] !== false}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        categories: { ...(p.categories || {}), [key]: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 rounded accent-[#4F46E5]"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => savePrefs.mutate()} loading={savePrefs.isPending}>
              Save Preferences
            </Button>
          </div>
        </SurfaceCard>
      )}

      {/* Tab 3: Templates (College Admin) */}
      {tab === 'templates' && isAdmin && (
        <SurfaceCard className="p-5 space-y-4">
          {!data?.templates?.length ? (
            <EmptyState
              title="No custom notification templates yet"
              description="System default messages are active for circulation, due reminders, and approvals."
            />
          ) : (
            <div className="space-y-3">
              {data.templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-800"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{tpl.subject}</span>
                      <span className="text-[11px] font-mono text-slate-400">{tpl.eventKey}</span>
                      <StatusText status={tpl.isEnabled ? 'active' : 'inactive'} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{tpl.bodyTemplate}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditingTemplate(tpl)}>
                    Edit Template
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Tab 4: Delivery Logs & Provider Status */}
      {tab === 'deliveries' && isStaff && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SurfaceCard className="p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">SMTP Email Relay</div>
                <div className="text-[11px] text-slate-500">Env: SMTP_HOST, SMTP_USER, SMTP_PASS</div>
              </div>
              <StatusText status={data?.providers.smtpConfigured ? 'configured_enabled' : 'not_configured'} />
            </SurfaceCard>
            <SurfaceCard className="p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">Web Push (VAPID)</div>
                <div className="text-[11px] text-slate-500">Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY</div>
              </div>
              <StatusText status={data?.providers.webPushConfigured ? 'configured_enabled' : 'not_configured'} />
            </SurfaceCard>
            <SurfaceCard className="p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">WhatsApp Cloud API</div>
                <div className="text-[11px] text-slate-500">Env: WHATSAPP_API_TOKEN</div>
              </div>
              <StatusText status={data?.providers.whatsappConfigured ? 'configured_enabled' : 'not_configured'} />
            </SurfaceCard>
          </div>

          <SurfaceCard className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Recent Delivery Audit Log
              </h2>
            </div>
            {!data?.deliveries?.length ? (
              <div className="p-6">
                <EmptyState
                  title="No delivery logs recorded yet"
                  description="Broadcast an announcement or trigger an automation job to inspect per-recipient delivery records."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Recipient</th>
                      <th className="px-4 py-3">Channel</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Provider Response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-3 font-mono text-slate-500">{formatDateTime(d.createdAt)}</td>
                        <td className="px-4 py-3">{d.recipientEmail || '—'}</td>
                        <td className="px-4 py-3 uppercase font-mono">{d.channel}</td>
                        <td className="px-4 py-3">
                          <StatusText status={d.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-500">{d.providerResponse || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {/* Broadcast Modal */}
      <Modal
        open={announceOpen}
        onOpenChange={setAnnounceOpen}
        title="Broadcast Library Announcement"
        description="Delivers an in-app notification immediately to all active members of your institution."
      >
        <div className="space-y-4">
          <Field label="Announcement Title" required>
            <Input
              value={announceTitle}
              onChange={(e) => setAnnounceTitle(e.target.value)}
              placeholder="e.g., Extended Reading Room Hours for Mid-Sem Exams"
            />
          </Field>
          <Field label="Message" required>
            <Textarea
              value={announceMessage}
              onChange={(e) => setAnnounceMessage(e.target.value)}
              placeholder="Write clear details for students and library staff..."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => announceMutation.mutate()}
              loading={announceMutation.isPending}
              disabled={announceTitle.trim().length < 3 || announceMessage.trim().length < 5}
            >
              <Send className="h-3.5 w-3.5" />
              Send Announcement
            </Button>
          </div>
        </div>
      </Modal>

      {/* Template Edit Modal */}
      <Modal
        open={Boolean(editingTemplate)}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
        title="Edit Notification Template"
      >
        {editingTemplate && (
          <div className="space-y-4">
            <Field label="Subject" required>
              <Input
                value={editingTemplate.subject}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
              />
            </Field>
            <Field label="Message Template" required>
              <Textarea
                value={editingTemplate.bodyTemplate}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, bodyTemplate: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={editingTemplate.isEnabled}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, isEnabled: e.target.checked })}
                className="h-4 w-4 rounded accent-[#4F46E5]"
              />
              Enable this notification event
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingTemplate(null)}>
                Cancel
              </Button>
              <Button onClick={() => saveTemplate.mutate(editingTemplate)} loading={saveTemplate.isPending}>
                Save Template
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
