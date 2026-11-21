import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Archive,
  Award,
  BookOpen,
  Camera,
  CornerDownLeft,
  Download,
  Layers,
  Plus,
  Printer,
  Repeat,
  RotateCw,
  ScanBarcode,
  Search,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { BulkBookScanModal } from '../../components/books/BulkBookScanModal.tsx';
import { ScanAssignBookModal } from '../../components/books/ScanAssignBookModal.tsx';
import { QrScannerModal } from '../../components/scanner/QrScannerModal.tsx';
import {
  Button,
  EmptyState,
  Field,
  FileUploadControl,
  Input,
  Modal,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import {
  downloadBarcodesSheetPdf,
  downloadReceiptPdf,
  formatCurrency,
  formatDate,
} from '../../lib/utils.ts';
import { matchesIsbnSearch, normalizeIsbn } from '../../shared/isbn.ts';

interface BookCatalogRow {
  id: string;
  isbn: string;
  title: string;
  subtitle?: string | null;
  authorName?: string | null;
  publisherName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  semesterName?: string | null;
  edition?: string | null;
  publicationYear?: number | null;
  subject?: string | null;
  coverImageUrl?: string | null;
  rackCode?: string | null;
  shelfCode?: string | null;
  status: string;
  inventory: {
    total: number;
    available: number;
    issued: number;
    reserved: number;
    damaged: number;
    lost: number;
  };
}

// ============================================================================
// 1. BOOK CATALOG & SEPARATE PHYSICAL COPIES INVENTORY
// ============================================================================

export function BooksInventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const [activeTab, setActiveTab] = useState<'catalog' | 'categories' | 'authors' | 'shelves'>('catalog');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [availFilter, setAvailFilter] = useState('');

  const [addBookOpen, setAddBookOpen] = useState(searchParams.get('action') === 'new');
  const [bulkScanOpen, setBulkScanOpen] = useState(false);
  const [scanAssignOpen, setScanAssignOpen] = useState(false);
  const [singleBookScannerTarget, setSingleBookScannerTarget] = useState<'isbn' | 'physical' | null>(null);
  const [copiesBook, setCopiesBook] = useState<BookCatalogRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const orgName =
    activeWorkspace?.type === 'organization'
      ? activeWorkspace.membership.organizationName
      : 'QIVORA Library';

  const [bookForm, setBookForm] = useState({
    isbn: '',
    physicalBarcode: '',
    title: '',
    authorName: '',
    publisherName: '',
    categoryId: '',
    courseId: '',
    semesterId: '',
    edition: '',
    publicationYear: '2025',
    language: 'English',
    subject: '',
    description: '',
    coverImageUrl: null as string | null,
    defaultShelfId: '',
    initialCopies: '5',
    purchasePrice: '',
    supplier: '',
  });

  const [copyBatchForm, setCopyBatchForm] = useState({
    quantity: '3',
    shelfId: '',
    condition: 'new',
    barcodePrefix: '',
    purchasePrice: '',
    supplier: '',
  });

  // Meta creation states
  const [newCat, setNewCat] = useState({ name: '', code: '', description: '' });
  const [newAuthor, setNewAuthor] = useState({ name: '', biography: '' });
  const [newShelf, setNewShelf] = useState({ rackCode: '', shelfCode: '', sectionName: '', capacity: '100' });

  const { data: meta } = useQuery({
    queryKey: ['org-catalog-meta', orgId],
    queryFn: () =>
      apiRequest<{
        categories: Array<{ id: string; name: string; code: string; description?: string }>;
        authors: Array<{ id: string; name: string; biography?: string }>;
        publishers: Array<{ id: string; name: string }>;
        shelves: Array<{ id: string; rackCode: string; shelfCode: string; sectionName: string; capacity: number }>;
      }>('/org/catalog-meta'),
    enabled: Boolean(orgId),
  });

  const { data: academics } = useQuery({
    queryKey: ['org-academics', orgId],
    queryFn: () =>
      apiRequest<{
        courses: Array<{ id: string; name: string }>;
        semesters: Array<{ id: string; courseId: string; name: string }>;
      }>('/org/academics'),
    enabled: Boolean(orgId),
  });

  const { data: booksData, isLoading } = useQuery({
    queryKey: ['org-books', orgId],
    queryFn: () => apiRequest<{ books: BookCatalogRow[] }>('/org/books'),
    enabled: Boolean(orgId),
  });

  const { data: copiesData, isLoading: copiesLoading } = useQuery({
    queryKey: ['org-book-copies', orgId, copiesBook?.id],
    queryFn: () =>
      apiRequest<{
        copies: Array<{
          id: string;
          barcode: string;
          accessionNumber: string;
          status: string;
          condition: string;
          rackCode?: string;
          shelfCode?: string;
          purchaseDate?: string;
        }>;
        history: Array<{
          id: string;
          status: string;
          issuedAt: string;
          dueAt: string;
          returnedAt?: string;
          studentName: string;
          rollNumber: string;
        }>;
      }>(`/org/books/${copiesBook?.id}/copies`),
    enabled: Boolean(copiesBook?.id),
  });

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (booksData?.books || []).filter((b) => {
      if (catFilter && b.categoryId !== catFilter) return false;
      if (courseFilter && b.courseId !== courseFilter) return false;
      if (availFilter === 'available' && b.inventory.available === 0) return false;
      if (availFilter === 'low_stock' && b.inventory.available > 1) return false;
      if (availFilter === 'unavailable' && b.inventory.available > 0) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        matchesIsbnSearch(b.isbn, q) ||
        (b.authorName || '').toLowerCase().includes(q) ||
        (b.subject || '').toLowerCase().includes(q)
      );
    });
  }, [booksData?.books, search, catFilter, courseFilter, availFilter]);

  const handleIsbnLookup = async (overrideIsbn?: string) => {
    const raw = (overrideIsbn ?? bookForm.isbn).trim();
    const norm = normalizeIsbn(raw);
    if (!norm || (norm.length !== 10 && norm.length !== 13)) {
      toast.error('Enter or scan a valid 10- or 13-digit ISBN first.');
      return;
    }
    setBookForm((prev) => ({ ...prev, isbn: norm }));
    setIsbnLoading(true);
    try {
      const res = await apiRequest<{
        provider: string;
        metadata: {
          isbn: string;
          title: string;
          authorName: string;
          publisherName: string;
          publicationYear?: number;
          categoryName?: string;
          subject: string;
          description?: string;
          coverImageUrl: string;
        };
        existingBook?: {
          id: string;
          title: string;
          isbn: string;
          totalCopies: number;
          availableCopies: number;
        } | null;
      }>(`/org/books/isbn-lookup?isbn=${encodeURIComponent(norm)}`);

      const matchedCat = res.metadata.categoryName
        ? (meta?.categories || []).find(
            (c) => c.name.toLowerCase() === res.metadata.categoryName!.toLowerCase()
          )
        : undefined;

      setBookForm((prev) => ({
        ...prev,
        isbn: res.metadata.isbn || norm,
        title: res.metadata.title || prev.title,
        authorName: res.metadata.authorName || prev.authorName,
        publisherName: res.metadata.publisherName || prev.publisherName,
        categoryId: matchedCat?.id || prev.categoryId,
        publicationYear: res.metadata.publicationYear
          ? String(res.metadata.publicationYear)
          : prev.publicationYear,
        subject: res.metadata.subject || prev.subject,
        description: res.metadata.description || prev.description,
        coverImageUrl: res.metadata.coverImageUrl || prev.coverImageUrl,
      }));
      if (res.existingBook) {
        toast.info(
          `Note: "${res.existingBook.title}" is already in catalog (${res.existingBook.totalCopies} copies). Auto-filled via ${res.provider}.`
        );
      } else {
        toast.success(`Auto-filled metadata from ${res.provider}.`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'ISBN lookup failed — you can fill fields manually.');
    } finally {
      setIsbnLoading(false);
    }
  };

  const handleBulkArchive = async () => {
    if (!selectedBookIds.length) return;
    try {
      const res = await apiRequest<{ updatedCount: number }>('/org/books/bulk-archive', {
        method: 'POST',
        body: { bookIds: selectedBookIds, status: 'archived' },
      });
      toast.success(`Archived ${res.updatedCount} book title(s).`);
      setSelectedBookIds([]);
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Bulk archive failed.');
    }
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/org/books', {
        method: 'POST',
        body: {
          ...bookForm,
          physicalBarcode: bookForm.physicalBarcode.trim() || null,
          categoryId: bookForm.categoryId || null,
          courseId: bookForm.courseId || null,
          semesterId: bookForm.semesterId || null,
          defaultShelfId: bookForm.defaultShelfId || null,
          publicationYear: bookForm.publicationYear ? Number(bookForm.publicationYear) : null,
          initialCopies: Number(bookForm.initialCopies) || 0,
          purchasePrice: bookForm.purchasePrice ? Number(bookForm.purchasePrice) : null,
        },
      });
      toast.success('Master book and physical copy records created.');
      setAddBookOpen(false);
      setSearchParams({});
      setBookForm({
        isbn: '',
        physicalBarcode: '',
        title: '',
        authorName: '',
        publisherName: '',
        categoryId: '',
        courseId: '',
        semesterId: '',
        edition: '',
        publicationYear: '2025',
        language: 'English',
        subject: '',
        description: '',
        coverImageUrl: null,
        defaultShelfId: '',
        initialCopies: '5',
        purchasePrice: '',
        supplier: '',
      });
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
      queryClient.invalidateQueries({ queryKey: ['org-catalog-meta'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to add book.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCopies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copiesBook) return;
    setSubmitting(true);
    try {
      await apiRequest(`/org/books/${copiesBook.id}/copies`, {
        method: 'POST',
        body: {
          quantity: Number(copyBatchForm.quantity) || 1,
          shelfId: copyBatchForm.shelfId || null,
          condition: copyBatchForm.condition,
          barcodePrefix: copyBatchForm.barcodePrefix || undefined,
          purchasePrice: copyBatchForm.purchasePrice ? Number(copyBatchForm.purchasePrice) : null,
          supplier: copyBatchForm.supplier || null,
        },
      });
      toast.success(`Added ${copyBatchForm.quantity} physical copy record(s).`);
      queryClient.invalidateQueries({ queryKey: ['org-book-copies', orgId, copiesBook.id] });
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to add copies.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCopyStatus = async (copyId: string, status: string) => {
    try {
      await apiRequest(`/org/copies/${copyId}`, {
        method: 'PATCH',
        body: { status },
      });
      toast.success(`Copy status updated to ${status}.`);
      queryClient.invalidateQueries({ queryKey: ['org-book-copies', orgId, copiesBook?.id] });
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update copy.');
    }
  };

  const handleArchiveBook = async (id: string) => {
    try {
      await apiRequest(`/org/books/${id}/archive`, {
        method: 'PATCH',
        body: { status: 'archived' },
      });
      toast.success('Book archived.');
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
    } catch {
      toast.error('Archive failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Book Catalog & Physical Inventory
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Master titles are separated from physical copies so each barcode tracks its own
            condition, shelf, and loan lifecycle.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedBookIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleBulkArchive}>
              <Archive className="h-3.5 w-3.5" />
              Archive Selected ({selectedBookIds.length})
            </Button>
          )}
          <Button variant="secondary" onClick={() => setScanAssignOpen(true)}>
            <UserCheck className="h-4 w-4" />
            Scan &amp; Assign to Student
          </Button>
          <Button variant="outline" onClick={() => setBulkScanOpen(true)}>
            <ScanBarcode className="h-4 w-4" />
            Bulk Scan &amp; Add Books
          </Button>
          <Button onClick={() => setAddBookOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Book Title
          </Button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
        {(
          [
            ['catalog', 'Books & Copies'],
            ['categories', 'Categories'],
            ['authors', 'Authors'],
            ['shelves', 'Shelves & Racks'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === key
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' && (
        <>
          <SurfaceCard className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title, ISBN, author, subject..."
                  className="pl-9"
                />
              </div>
              <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="">All Categories</option>
                {(meta?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
                <option value="">All Courses</option>
                {(academics?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={availFilter} onChange={(e) => setAvailFilter(e.target.value)}>
                <option value="">All Availability</option>
                <option value="available">Available Copies &gt; 0</option>
                <option value="low_stock">Low Stock (≤ 1 Available)</option>
                <option value="unavailable">Currently Out of Stock</option>
              </Select>
            </div>
          </SurfaceCard>

          <SurfaceCard className="overflow-hidden">
            {isLoading ? (
              <div className="p-5"><SkeletonRows rows={5} /></div>
            ) : !filteredBooks.length ? (
              <div className="p-6">
                <EmptyState
                  title="No books in catalog yet"
                  description="Add your first master book title along with its initial batch of physical copies."
                  action={<Button onClick={() => setAddBookOpen(true)}>Add First Book</Button>}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={filteredBooks.length > 0 && selectedBookIds.length === filteredBooks.length}
                          onChange={() =>
                            setSelectedBookIds(
                              selectedBookIds.length === filteredBooks.length
                                ? []
                                : filteredBooks.map((b) => b.id)
                            )
                          }
                          aria-label="Select all books"
                        />
                      </th>
                      <th className="px-4 py-3">Book Title & Author</th>
                      <th className="px-4 py-3">ISBN</th>
                      <th className="px-4 py-3">Category / Shelf</th>
                      <th className="px-4 py-3 text-right">Available / Total</th>
                      <th className="px-4 py-3 text-right">Issued</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredBooks.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedBookIds.includes(b.id)}
                            onChange={() =>
                              setSelectedBookIds((prev) =>
                                prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]
                              )
                            }
                            aria-label={`Select ${b.title}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={b.coverImageUrl || '/src/assets/images/book_cover_computing_1795150811735.jpg'}
                              alt={b.title}
                              referrerPolicy="no-referrer"
                              className="h-11 w-8 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-white truncate max-w-xs">
                                {b.title}
                              </div>
                              <div className="text-slate-500">
                                {b.authorName || 'Unknown Author'}
                                {b.edition ? ` · ${b.edition} Ed.` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">{b.isbn}</td>
                        <td className="px-4 py-3">
                          <div>{b.categoryName || 'General'}</div>
                          <div className="font-mono text-slate-500">
                            {b.rackCode ? `${b.rackCode}-${b.shelfCode}` : 'Unassigned shelf'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          <span
                            className={
                              b.inventory.available > 0
                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                : 'font-semibold text-red-600 dark:text-red-400'
                            }
                          >
                            {b.inventory.available}
                          </span>
                          <span className="text-slate-400"> / {b.inventory.total}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {b.inventory.issued}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          <Button size="sm" variant="outline" onClick={() => setCopiesBook(b)}>
                            <Layers className="h-3.5 w-3.5" />
                            Copies ({b.inventory.total})
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleArchiveBook(b.id)}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </>
      )}

      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SurfaceCard className="p-5">
            <h2 className="font-display text-sm font-semibold mb-4">Add Category</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await apiRequest('/org/categories', { method: 'POST', body: newCat });
                  toast.success('Category added.');
                  setNewCat({ name: '', code: '', description: '' });
                  queryClient.invalidateQueries({ queryKey: ['org-catalog-meta'] });
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Failed to add category.');
                }
              }}
              className="space-y-3"
            >
              <Field label="Category Name" required>
                <Input required value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
              </Field>
              <Field label="Code" required>
                <Input required value={newCat.code} onChange={(e) => setNewCat({ ...newCat, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Description">
                <Textarea value={newCat.description} onChange={(e) => setNewCat({ ...newCat, description: e.target.value })} />
              </Field>
              <Button type="submit" className="w-full">Save Category</Button>
            </form>
          </SurfaceCard>
          <SurfaceCard className="lg:col-span-2 p-5">
            <h2 className="font-display text-sm font-semibold mb-3">Existing Categories</h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {(meta?.categories || []).map((c) => (
                <div key={c.id} className="py-2.5 flex justify-between">
                  <div>
                    <span className="font-semibold">{c.name}</span>
                    <span className="ml-2 font-mono text-slate-400">{c.code}</span>
                  </div>
                  <span className="text-slate-500">{c.description || '—'}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}

      {activeTab === 'authors' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SurfaceCard className="p-5">
            <h2 className="font-display text-sm font-semibold mb-4">Add Author</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest('/org/authors', { method: 'POST', body: newAuthor });
                toast.success('Author added.');
                setNewAuthor({ name: '', biography: '' });
                queryClient.invalidateQueries({ queryKey: ['org-catalog-meta'] });
              }}
              className="space-y-3"
            >
              <Field label="Author Name" required>
                <Input required value={newAuthor.name} onChange={(e) => setNewAuthor({ ...newAuthor, name: e.target.value })} />
              </Field>
              <Field label="Biography">
                <Textarea value={newAuthor.biography} onChange={(e) => setNewAuthor({ ...newAuthor, biography: e.target.value })} />
              </Field>
              <Button type="submit" className="w-full">Save Author</Button>
            </form>
          </SurfaceCard>
          <SurfaceCard className="lg:col-span-2 p-5">
            <h2 className="font-display text-sm font-semibold mb-3">Authors Directory</h2>
            {!meta?.authors?.length ? (
              <p className="text-xs text-slate-500">Authors are also created automatically when adding books.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {meta.authors.map((a) => (
                  <div key={a.id} className="py-2.5 font-medium">{a.name}</div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {activeTab === 'shelves' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SurfaceCard className="p-5">
            <h2 className="font-display text-sm font-semibold mb-4">Add Rack & Shelf</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await apiRequest('/org/shelves', { method: 'POST', body: newShelf });
                  toast.success('Rack & shelf added.');
                  setNewShelf({ rackCode: '', shelfCode: '', sectionName: '', capacity: '100' });
                  queryClient.invalidateQueries({ queryKey: ['org-catalog-meta'] });
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Unable to add shelf.');
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rack Code" required>
                  <Input required placeholder="R3" value={newShelf.rackCode} onChange={(e) => setNewShelf({ ...newShelf, rackCode: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Shelf Code" required>
                  <Input required placeholder="S1" value={newShelf.shelfCode} onChange={(e) => setNewShelf({ ...newShelf, shelfCode: e.target.value.toUpperCase() })} />
                </Field>
              </div>
              <Field label="Section Name" required>
                <Input required placeholder="Applied Sciences" value={newShelf.sectionName} onChange={(e) => setNewShelf({ ...newShelf, sectionName: e.target.value })} />
              </Field>
              <Field label="Capacity">
                <Input type="number" value={newShelf.capacity} onChange={(e) => setNewShelf({ ...newShelf, capacity: e.target.value })} />
              </Field>
              <Button type="submit" className="w-full">Save Shelf</Button>
            </form>
          </SurfaceCard>
          <SurfaceCard className="lg:col-span-2 p-5">
            <h2 className="font-display text-sm font-semibold mb-3">Library Racks & Shelves</h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {(meta?.shelves || []).map((sh) => (
                <div key={sh.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-semibold">{sh.rackCode}-{sh.shelfCode}</span>
                    <span className="ml-2 text-slate-600 dark:text-slate-300">{sh.sectionName}</span>
                  </div>
                  <span className="font-mono text-slate-400">Cap. {sh.capacity}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}

      {/* Add Book Modal */}
      <Modal
        open={addBookOpen}
        onOpenChange={(o) => { setAddBookOpen(o); if (!o) setSearchParams({}); }}
        title="Add Master Book Title & Physical Copies"
        description="Creates one master book record plus N individual barcoded physical copies."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateBook} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Book Title" required>
              <Input required value={bookForm.title} onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })} placeholder="Computer Fundamentals" />
            </Field>
            <Field label="ISBN" required hint="Scan barcode or enter ISBN-10/13 (hyphens auto-normalized) & Lookup.">
              <div className="flex gap-1.5">
                <Input
                  required
                  value={bookForm.isbn}
                  onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && normalizeIsbn(bookForm.isbn).length >= 10 && !bookForm.title) {
                      e.preventDefault();
                      void handleIsbnLookup();
                    }
                  }}
                  placeholder="978-0-13-468599-1"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="Scan ISBN Barcode with Camera"
                  onClick={() => setSingleBookScannerTarget('isbn')}
                >
                  <Camera className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="outline" size="sm" loading={isbnLoading} onClick={() => handleIsbnLookup()}>
                  <Sparkles className="h-3.5 w-3.5" />
                  Lookup
                </Button>
              </div>
            </Field>
            <Field
              label="Printed Physical Book Barcode (Optional)"
              hint="Scan the physical barcode sticker printed on the book to store it directly on Copy #1."
            >
              <div className="flex gap-1.5">
                <Input
                  value={bookForm.physicalBarcode}
                  onChange={(e) => setBookForm({ ...bookForm, physicalBarcode: e.target.value })}
                  placeholder="e.g. LIB-CS-00142 (auto-generated if blank)"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="Scan Printed Physical Book Barcode"
                  onClick={() => setSingleBookScannerTarget('physical')}
                >
                  <ScanBarcode className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Field>
            <Field label="Author">
              <Input value={bookForm.authorName} onChange={(e) => setBookForm({ ...bookForm, authorName: e.target.value })} placeholder="Author full name" />
            </Field>
            <Field label="Publisher">
              <Input value={bookForm.publisherName} onChange={(e) => setBookForm({ ...bookForm, publisherName: e.target.value })} placeholder="Publisher name" />
            </Field>
            <Field label="Category">
              <Select value={bookForm.categoryId} onChange={(e) => setBookForm({ ...bookForm, categoryId: e.target.value })}>
                <option value="">Select category</option>
                {(meta?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Course">
              <Select value={bookForm.courseId} onChange={(e) => setBookForm({ ...bookForm, courseId: e.target.value })}>
                <option value="">General / All Courses</option>
                {(academics?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Rack & Shelf">
              <Select value={bookForm.defaultShelfId} onChange={(e) => setBookForm({ ...bookForm, defaultShelfId: e.target.value })}>
                <option value="">Select rack & shelf</option>
                {(meta?.shelves || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.rackCode}-{s.shelfCode} · {s.sectionName}</option>
                ))}
              </Select>
            </Field>
            <Field label="Initial Physical Copies" required hint="Separate copy barcodes will be auto-generated.">
              <Input type="number" min={1} max={100} required value={bookForm.initialCopies} onChange={(e) => setBookForm({ ...bookForm, initialCopies: e.target.value })} />
            </Field>
            <Field label="Edition">
              <Input value={bookForm.edition} onChange={(e) => setBookForm({ ...bookForm, edition: e.target.value })} placeholder="4th" />
            </Field>
            <Field label="Publication Year">
              <Input type="number" value={bookForm.publicationYear} onChange={(e) => setBookForm({ ...bookForm, publicationYear: e.target.value })} />
            </Field>
            <Field label="Subject">
              <Input value={bookForm.subject} onChange={(e) => setBookForm({ ...bookForm, subject: e.target.value })} />
            </Field>
            <Field label="Unit Price">
              <Input type="number" step="0.01" value={bookForm.purchasePrice} onChange={(e) => setBookForm({ ...bookForm, purchasePrice: e.target.value })} placeholder="450.00" />
            </Field>
          </div>
          <Field label="Book Cover Image">
            <FileUploadControl
              bucket="book_covers"
              label="Upload Book Cover"
              currentUrl={bookForm.coverImageUrl}
              onUploaded={(url) => setBookForm({ ...bookForm, coverImageUrl: url })}
              allowClear
            />
          </Field>
          <Field label="Description">
            <Textarea value={bookForm.description} onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setAddBookOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Save Book & Copies</Button>
          </div>
        </form>
      </Modal>

      {/* Physical Copies Drawer Modal */}
      <Modal
        open={Boolean(copiesBook)}
        onOpenChange={(o) => !o && setCopiesBook(null)}
        title={`Physical Copies · ${copiesBook?.title || ''}`}
        description={`ISBN ${copiesBook?.isbn || ''} · Each physical copy has a unique barcode and independent status.`}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-5">
          <form onSubmit={handleAddCopies} className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 items-end">
            <Field label="Add Copies">
              <Input type="number" min={1} max={50} value={copyBatchForm.quantity} onChange={(e) => setCopyBatchForm({ ...copyBatchForm, quantity: e.target.value })} />
            </Field>
            <Field label="Barcode Prefix">
              <Input placeholder="Optional" value={copyBatchForm.barcodePrefix} onChange={(e) => setCopyBatchForm({ ...copyBatchForm, barcodePrefix: e.target.value })} />
            </Field>
            <Field label="Shelf">
              <Select value={copyBatchForm.shelfId} onChange={(e) => setCopyBatchForm({ ...copyBatchForm, shelfId: e.target.value })}>
                <option value="">Default Shelf</option>
                {(meta?.shelves || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.rackCode}-{s.shelfCode}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={submitting}>Add Batch</Button>
          </form>

          {(copiesData?.copies?.length || 0) > 0 && copiesBook && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadBarcodesSheetPdf({
                    organizationName: orgName,
                    bookTitle: copiesBook.title,
                    copies: (copiesData?.copies || []).map((c) => ({
                      barcode: c.barcode,
                      accessionNumber: c.accessionNumber,
                      shelf: c.rackCode ? `${c.rackCode}-${c.shelfCode}` : undefined,
                    })),
                  })
                }
              >
                <Printer className="h-3.5 w-3.5" />
                Print Barcode Labels PDF ({copiesData?.copies.length})
              </Button>
            </div>
          )}

          {copiesLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Accession No.</th>
                    <th className="px-3 py-2">Shelf</th>
                    <th className="px-3 py-2">Condition</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(copiesData?.copies || []).map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-mono font-semibold">{c.barcode}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{c.accessionNumber}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {c.rackCode ? `${c.rackCode}-${c.shelfCode}` : '—'}
                      </td>
                      <td className="px-3 py-2 capitalize">{c.condition}</td>
                      <td className="px-3 py-2"><StatusText status={c.status} /></td>
                      <td className="px-3 py-2 text-right">
                        {c.status !== 'issued' ? (
                          <Select
                            value={c.status}
                            onChange={(e) => handleUpdateCopyStatus(c.id, e.target.value)}
                            className="h-7 text-xs w-36 ml-auto"
                          >
                            <option value="available">Available</option>
                            <option value="reserved">Reserved</option>
                            <option value="damaged">Damaged</option>
                            <option value="lost">Lost</option>
                            <option value="under_maintenance">Maintenance</option>
                          </Select>
                        ) : (
                          <span className="text-slate-400">Issued</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Camera Barcode Scanner for Single Book Add (ISBN or Physical Sticker) */}
      <QrScannerModal
        open={Boolean(singleBookScannerTarget)}
        onClose={() => setSingleBookScannerTarget(null)}
        title={
          singleBookScannerTarget === 'physical'
            ? 'Scan Physical Book Barcode Sticker'
            : 'Scan Book ISBN Barcode'
        }
        description={
          singleBookScannerTarget === 'physical'
            ? 'Point your camera at the physical library barcode sticker printed on the book. If it is also an ISBN-10/13, metadata will auto-fetch too.'
            : "Point your camera at the book's back-cover EAN-13 / ISBN barcode to auto-fill title, author, publisher, year, and cover."
        }
        placeholder="Or enter / USB-scan barcode..."
        mode="barcode"
        onScan={(val) => {
          const target = singleBookScannerTarget;
          setSingleBookScannerTarget(null);
          const trimmed = val.trim();
          const norm = normalizeIsbn(trimmed);
          if (target === 'physical') {
            setBookForm((prev) => ({
              ...prev,
              physicalBarcode: trimmed,
              isbn: !prev.isbn && (norm.length === 10 || norm.length === 13) ? norm : prev.isbn,
            }));
            if (norm.length === 10 || norm.length === 13) {
              void handleIsbnLookup(norm);
            } else {
              toast.success(`Captured physical book barcode: ${trimmed}`);
            }
          } else {
            const finalCode = norm || trimmed;
            setBookForm((prev) => ({ ...prev, isbn: finalCode }));
            void handleIsbnLookup(finalCode);
          }
        }}
      />

      {/* Bulk Scan & Add Books Modal */}
      <BulkBookScanModal
        open={bulkScanOpen}
        onOpenChange={setBulkScanOpen}
        organizationName={orgName}
        categories={meta?.categories || []}
        shelves={meta?.shelves || []}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['org-books'] });
          queryClient.invalidateQueries({ queryKey: ['org-catalog-meta'] });
          queryClient.invalidateQueries({ queryKey: ['org-overview'] });
        }}
      />

      {/* Direct Scan Book Barcode & Assign to Selected Student Modal */}
      <ScanAssignBookModal
        open={scanAssignOpen}
        onOpenChange={setScanAssignOpen}
        orgId={orgId}
        organizationName={orgName}
        onAssigned={() => {
          queryClient.invalidateQueries({ queryKey: ['org-books'] });
          queryClient.invalidateQueries({ queryKey: ['org-loans'] });
          queryClient.invalidateQueries({ queryKey: ['org-overview'] });
        }}
      />
    </div>
  );
}

// ============================================================================
// 2. CENTRAL ISSUE, RETURN & RENEWAL CIRCULATION DESK
// ============================================================================

export function CirculationDeskPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const orgName = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationName : 'QIVORA Library';

  const initialTab = (searchParams.get('tab') as 'issue' | 'return' | 'loans') || 'issue';
  const [tab, setTab] = useState<'issue' | 'return' | 'loans'>(initialTab);
  const [scannerMode, setScannerMode] = useState<'student' | 'issue_book' | 'return_book' | null>(null);
  const [quickAssignOpen, setQuickAssignOpen] = useState(false);

  // Issue workflow state
  const [studentLookup, setStudentLookup] = useState(searchParams.get('student') || '');
  const [resolvedStudent, setResolvedStudent] = useState<{
    scannedVia?: 'student_id' | 'founder_id' | 'direct_lookup' | string;
    student: {
      id: string;
      fullName: string;
      studentIdCode: string;
      collegeRollNumber: string;
      status: string;
      courseName?: string | null;
      semesterName?: string | null;
      sessionName?: string | null;
    };
    founderBadge?: {
      founderNumber: string;
      designation: string;
      editionName: string;
      organizationLabel: string;
    } | null;
    eligibility: {
      eligible: boolean;
      activeLoansCount: number;
      overdueLoansCount?: number;
      maxBooksAllowed: number;
      loanDurationDays: number;
      outstandingFine: number;
      blockReason?: string | null;
    };
  } | null>(null);
  interface LookupActiveLoan {
    id: string;
    receiptNumber: string;
    issuedAt: string;
    dueAt: string;
    studentName: string;
    studentIdCode: string;
    rollNumber?: string;
  }

  interface LookupCopyItem {
    id: string;
    barcode: string;
    accessionNumber?: string;
    status: string;
    rackCode?: string | null;
    shelfCode?: string | null;
    bookTitle?: string;
    bookIsbn?: string;
    activeLoan?: LookupActiveLoan | null;
  }

  interface CopyLookupResponse {
    matchedBy?: 'barcode' | 'accession' | 'isbn' | 'title';
    statusMessage?: string;
    inventory?: { total: number; available: number; issued: number; reserved: number };
    copy: LookupCopyItem | null;
    copies?: LookupCopyItem[];
    book: { id?: string; title: string; isbn: string; authorName?: string | null };
    activeLoan: LookupActiveLoan | null;
    activeLoans?: Array<{
      copyId: string;
      barcode: string;
      bookTitle: string;
      bookIsbn: string;
      loan: LookupActiveLoan;
    }>;
  }

  const [issueBarcode, setIssueBarcode] = useState('');
  const [resolvedCopy, setResolvedCopy] = useState<CopyLookupResponse | null>(null);
  const [issuing, setIssuing] = useState(false);

  // Return workflow state
  const [returnBarcode, setReturnBarcode] = useState('');
  const [returnLookup, setReturnLookup] = useState<CopyLookupResponse | null>(null);
  const [returnCondition, setReturnCondition] = useState('good');
  const [damageDesc, setDamageDesc] = useState('');
  const [damageFine, setDamageFine] = useState('0');
  const [returning, setReturning] = useState(false);

  const { data: loansData, isLoading: loansLoading } = useQuery({
    queryKey: ['org-loans', orgId],
    queryFn: () =>
      apiRequest<{
        loans: Array<{
          id: string;
          receiptNumber: string;
          status: string;
          isOverdue: boolean;
          issuedAt: string;
          dueAt: string;
          returnedAt?: string | null;
          renewalCount: number;
          bookTitle: string;
          barcode: string;
          studentName: string;
          studentIdCode: string;
          rollNumber: string;
        }>;
      }>('/org/loans'),
    enabled: Boolean(orgId),
  });

  const lookupStudent = async (query: string) => {
    if (!query.trim()) return;
    try {
      const res = await apiRequest<NonNullable<typeof resolvedStudent>>(
        `/org/circulation/resolve-student?q=${encodeURIComponent(query.trim())}`
      );
      setResolvedStudent(res);
      if (!res.eligibility.eligible && res.eligibility.blockReason) {
        toast.warning(res.eligibility.blockReason);
      } else {
        toast.success(`Student verified: ${res.student.fullName}`);
      }
    } catch (err: unknown) {
      setResolvedStudent(null);
      toast.error(err instanceof Error ? err.message : 'Student not found.');
    }
  };

  useEffect(() => {
    const prefilled = searchParams.get('student');
    if (prefilled) lookupStudent(prefilled);
  }, [searchParams]);

  const lookupIssueBook = async (code: string) => {
    if (!code.trim()) return;
    try {
      const res = await apiRequest<CopyLookupResponse>(
        `/org/copies/lookup?code=${encodeURIComponent(code.trim())}&mode=issue`
      );
      setResolvedCopy(res);
      if (!res.copy) {
        toast.warning(res.statusMessage || 'Book found in catalog, but has 0 physical copies registered.');
      } else if (res.copy.status !== 'available' && res.copy.status !== 'reserved') {
        toast.warning(res.statusMessage || `Copy ${res.copy.barcode} is currently ${res.copy.status}.`);
      } else {
        toast.success(
          `Found "${res.book.title}" (matched by ${res.matchedBy || 'barcode'}) — copy ${res.copy.barcode} ready.`
        );
      }
    } catch (err: unknown) {
      setResolvedCopy(null);
      toast.error(err instanceof Error ? err.message : 'Book or physical copy not found.');
    }
  };

  const confirmIssue = async () => {
    if (!resolvedStudent || !resolvedCopy?.copy) return;
    setIssuing(true);
    try {
      const res = await apiRequest<{
        receipt: {
          receiptNumber: string;
          issuedAt: string;
          dueAt: string;
          bookTitle: string;
          barcode: string;
          studentName: string;
          studentIdCode: string;
        };
      }>('/org/circulation/issue', {
        method: 'POST',
        body: {
          studentId: resolvedStudent.student.id,
          bookCopyId: resolvedCopy.copy.id,
        },
      });
      toast.success(`Book issued! Receipt ${res.receipt.receiptNumber}`);
      downloadReceiptPdf({
        title: 'Book Issue Receipt',
        receiptNumber: res.receipt.receiptNumber,
        organizationName: orgName,
        lines: [
          { label: 'Student', value: `${res.receipt.studentName} (${res.receipt.studentIdCode})` },
          { label: 'Book Title', value: res.receipt.bookTitle },
          { label: 'Copy Barcode', value: res.receipt.barcode },
          { label: 'Issued Date', value: formatDate(res.receipt.issuedAt) },
          { label: 'Due Date', value: formatDate(res.receipt.dueAt) },
        ],
      });
      setIssueBarcode('');
      setResolvedCopy(null);
      await lookupStudent(resolvedStudent.student.studentIdCode);
      queryClient.invalidateQueries({ queryKey: ['org-loans'] });
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Issue transaction failed.');
    } finally {
      setIssuing(false);
    }
  };

  const lookupReturnCopy = async (code: string) => {
    if (!code.trim()) return;
    try {
      const res = await apiRequest<CopyLookupResponse>(
        `/org/copies/lookup?code=${encodeURIComponent(code.trim())}&mode=return`
      );
      setReturnLookup(res);
      if (!res.activeLoan) {
        toast.warning(res.statusMessage || 'No active loan found for this book/copy.');
      } else {
        toast.success(`Active loan loaded for ${res.activeLoan.studentName} (${res.book.title}).`);
      }
    } catch (err: unknown) {
      setReturnLookup(null);
      toast.error(err instanceof Error ? err.message : 'Book or copy not found.');
    }
  };

  const confirmReturn = async () => {
    if (!returnLookup?.activeLoan) return;
    setReturning(true);
    try {
      const res = await apiRequest<{
        overdueDays: number;
        overdueFineAmount: number;
        nextCopyStatus: string;
      }>('/org/circulation/return', {
        method: 'POST',
        body: {
          loanId: returnLookup.activeLoan.id,
          returnCondition,
          damageDescription: damageDesc || null,
          damageFineAmount: Number(damageFine) || 0,
        },
      });
      toast.success(
        `Returned! Copy is now ${res.nextCopyStatus}.${res.overdueFineAmount > 0 ? ` Overdue fine: ${formatCurrency(res.overdueFineAmount)}` : ''}`
      );
      downloadReceiptPdf({
        title: 'Book Return Receipt',
        receiptNumber: `RET-${returnLookup.activeLoan.receiptNumber}`,
        organizationName: orgName,
        lines: [
          { label: 'Student', value: `${returnLookup.activeLoan.studentName} (${returnLookup.activeLoan.studentIdCode})` },
          { label: 'Book Title', value: returnLookup.book.title },
          { label: 'Copy Barcode', value: returnLookup.copy?.barcode || '—' },
          { label: 'Return Condition', value: returnCondition },
          { label: 'Overdue Days', value: String(res.overdueDays) },
          { label: 'Overdue Fine', value: formatCurrency(res.overdueFineAmount) },
        ],
      });
      setReturnBarcode('');
      setReturnLookup(null);
      setReturnCondition('good');
      setDamageDesc('');
      setDamageFine('0');
      queryClient.invalidateQueries({ queryKey: ['org-loans'] });
      queryClient.invalidateQueries({ queryKey: ['org-books'] });
      queryClient.invalidateQueries({ queryKey: ['org-fines'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Return failed.');
    } finally {
      setReturning(false);
    }
  };

  const handleRenew = async (loanId: string) => {
    try {
      const res = await apiRequest<{ loan: { dueAt: string } }>('/org/circulation/renew', {
        method: 'POST',
        body: { loanId },
      });
      toast.success(`Loan renewed until ${formatDate(res.loan.dueAt)}.`);
      queryClient.invalidateQueries({ queryKey: ['org-loans'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Renewal blocked by library rules.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Circulation Desk — Issue, Return & Renew
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Scan student QR codes and book barcodes with atomic double-issue protection and instant
            PDF receipts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setQuickAssignOpen(true)}>
            <ScanBarcode className="h-3.5 w-3.5" />
            Scan Book &amp; Assign Student
          </Button>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['issue', 'Issue Book'],
                ['return', 'Return Book'],
                ['loans', 'Active & All Loans'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  tab === k
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ScanAssignBookModal
        open={quickAssignOpen}
        onOpenChange={setQuickAssignOpen}
        orgId={orgId}
        organizationName={orgName}
        onAssigned={() => {
          queryClient.invalidateQueries({ queryKey: ['org-loans'] });
          queryClient.invalidateQueries({ queryKey: ['org-books'] });
          queryClient.invalidateQueries({ queryKey: ['org-overview'] });
        }}
      />

      {tab === 'issue' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Step 1: Student Verification */}
          <SurfaceCard className="p-5 space-y-4">
            <h2 className="font-display text-sm font-semibold">1. Verify Student Identity</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookupStudent(studentLookup);
              }}
              className="flex gap-2"
            >
              <Input
                value={studentLookup}
                onChange={(e) => setStudentLookup(e.target.value)}
                placeholder="Scan Student QR, Golden Founder QR, Student ID, or Roll No..."
              />
              <Button type="button" variant="outline" onClick={() => setScannerMode('student')}>
                <Camera className="h-4 w-4" />
              </Button>
              <Button type="submit">Verify</Button>
            </form>

            {resolvedStudent && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs">
                {resolvedStudent.founderBadge && (
                  <div className="rounded-lg border border-[#D4AF37]/60 bg-[#0A0B0F] px-3 py-2 text-[#F6DF9C] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Award className="h-4 w-4 text-[#D4AF37] shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-[11px] truncate">
                          Verified QIVORA Founder · {resolvedStudent.founderBadge.designation}
                        </div>
                        <div className="font-mono text-[10px] text-[#C8A24B]">
                          {resolvedStudent.founderBadge.founderNumber}
                          {resolvedStudent.scannedVia === 'founder_id'
                            ? ' · Scanned via Golden Founder QR'
                            : ' · Linked College Member'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    {resolvedStudent.student.fullName}
                  </span>
                  <StatusText status={resolvedStudent.eligibility.eligible ? 'active' : 'blocked'} />
                </div>
                <div className="font-mono text-slate-500">
                  {resolvedStudent.student.studentIdCode} · Roll {resolvedStudent.student.collegeRollNumber}
                </div>
                {(resolvedStudent.student.courseName || resolvedStudent.student.semesterName) && (
                  <div className="text-slate-500">
                    {[
                      resolvedStudent.student.courseName,
                      resolvedStudent.student.semesterName,
                      resolvedStudent.student.sessionName,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="text-slate-400">Active Loans</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {resolvedStudent.eligibility.activeLoansCount} / {resolvedStudent.eligibility.maxBooksAllowed}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Loan Term</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {resolvedStudent.eligibility.loanDurationDays} days
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Unpaid Fines</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {formatCurrency(resolvedStudent.eligibility.outstandingFine)}
                    </div>
                  </div>
                </div>
                {resolvedStudent.eligibility.blockReason && (
                  <div className="rounded bg-red-50 dark:bg-red-950/30 p-2 text-red-700 dark:text-red-300">
                    {resolvedStudent.eligibility.blockReason}
                  </div>
                )}
              </div>
            )}
          </SurfaceCard>

          {/* Step 2: Physical Book Copy Lookup & Confirm Issue */}
          <SurfaceCard className="p-5 space-y-4">
            <h2 className="font-display text-sm font-semibold">2. Scan Book ISBN, Title, or Copy Barcode</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookupIssueBook(issueBarcode);
              }}
              className="flex gap-2"
            >
              <Input
                value={issueBarcode}
                onChange={(e) => setIssueBarcode(e.target.value)}
                placeholder="Scan or enter ISBN, Book Title, Copy Barcode, or Accession ID..."
              />
              <Button type="button" variant="outline" onClick={() => setScannerMode('issue_book')}>
                <Camera className="h-4 w-4" />
              </Button>
              <Button type="submit">Lookup</Button>
            </form>

            {resolvedCopy && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    {resolvedCopy.book.title}
                  </span>
                  <StatusText status={resolvedCopy.copy?.status || 'unavailable'} />
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-slate-500">
                  <span>ISBN: {resolvedCopy.book.isbn}</span>
                  {resolvedCopy.copy && <span>· Copy: {resolvedCopy.copy.barcode}</span>}
                  {resolvedCopy.matchedBy && (
                    <span className="text-[10px] uppercase tracking-wider text-[#2563EB] dark:text-[#60A5FA]">
                      · Matched via {resolvedCopy.matchedBy}
                    </span>
                  )}
                </div>
                <div className="text-slate-500">
                  Author: {resolvedCopy.book.authorName || '—'} · Shelf:{' '}
                  {resolvedCopy.copy?.rackCode
                    ? `${resolvedCopy.copy.rackCode}-${resolvedCopy.copy.shelfCode}`
                    : '—'}
                  {resolvedCopy.inventory && (
                    <>
                      {' '}
                      · Availability:{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {resolvedCopy.inventory.available}/{resolvedCopy.inventory.total} available
                      </strong>
                    </>
                  )}
                </div>

                {/* Copy Picker when multiple physical copies exist */}
                {(resolvedCopy.copies?.length || 0) > 1 && resolvedCopy.copy && (
                  <Field label="Select Physical Copy to Issue">
                    <Select
                      value={resolvedCopy.copy.id}
                      onChange={(e) => {
                        const picked = resolvedCopy.copies?.find((c) => c.id === e.target.value) || null;
                        if (picked) {
                          setResolvedCopy({
                            ...resolvedCopy,
                            copy: picked,
                            activeLoan: picked.activeLoan || null,
                          });
                        }
                      }}
                      className="h-8 text-xs font-mono"
                    >
                      {resolvedCopy.copies!.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.barcode} [{c.status.toUpperCase()}]
                          {c.activeLoan
                            ? ` — Issued to ${c.activeLoan.studentName} (Due ${formatDate(c.activeLoan.dueAt)})`
                            : c.rackCode
                              ? ` · Shelf ${c.rackCode}-${c.shelfCode}`
                              : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                {(!resolvedCopy.copy ||
                  (resolvedCopy.copy.status !== 'available' && resolvedCopy.copy.status !== 'reserved')) && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-2.5 text-amber-800 dark:text-amber-300">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">
                        {resolvedCopy.statusMessage || 'Selected physical copy is currently unavailable.'}
                      </div>
                      {resolvedCopy.copy?.activeLoan && (
                        <div className="mt-0.5 text-[11px]">
                          Borrower: <strong>{resolvedCopy.copy.activeLoan.studentName}</strong> (
                          {resolvedCopy.copy.activeLoan.studentIdCode}) · Due{' '}
                          {formatDate(resolvedCopy.copy.activeLoan.dueAt)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2">
              <Button
                className="w-full"
                size="lg"
                loading={issuing}
                disabled={
                  !resolvedStudent?.eligibility.eligible ||
                  !resolvedCopy?.copy ||
                  (resolvedCopy.copy.status !== 'available' && resolvedCopy.copy.status !== 'reserved')
                }
                onClick={confirmIssue}
              >
                <Repeat className="h-4 w-4" />
                Confirm Issue &amp; Generate PDF Receipt
              </Button>
            </div>
          </SurfaceCard>
        </div>
      )}

      {tab === 'return' && (
        <SurfaceCard className="p-6 max-w-2xl space-y-5">
          <h2 className="font-display text-base font-semibold">Return Physical Copy</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookupReturnCopy(returnBarcode);
            }}
            className="flex gap-2"
          >
            <Input
              value={returnBarcode}
              onChange={(e) => setReturnBarcode(e.target.value)}
              placeholder="Scan or enter ISBN, Book Title, Copy Barcode, or Accession ID..."
            />
            <Button type="button" variant="outline" onClick={() => setScannerMode('return_book')}>
              <Camera className="h-4 w-4" />
            </Button>
            <Button type="submit">Find Active Loan</Button>
          </form>

          {returnLookup && !returnLookup.activeLoan && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{returnLookup.book.title} (ISBN {returnLookup.book.isbn})</div>
                <div className="mt-0.5">
                  {returnLookup.statusMessage || 'No active loan is currently checked out for this book.'}
                </div>
              </div>
            </div>
          )}

          {returnLookup?.activeLoan && (
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4">
              {/* If multiple copies of the same ISBN/Title are currently issued, let librarian pick the right borrower */}
              {(returnLookup.activeLoans?.length || 0) > 1 && (
                <Field label={`Multiple Copies Issued (${returnLookup.activeLoans!.length}) — Select Returning Copy`}>
                  <Select
                    value={returnLookup.copy?.id || ''}
                    onChange={(e) => {
                      const pickedCopy = returnLookup.copies?.find((c) => c.id === e.target.value) || null;
                      if (pickedCopy && pickedCopy.activeLoan) {
                        setReturnLookup({
                          ...returnLookup,
                          copy: pickedCopy,
                          activeLoan: pickedCopy.activeLoan,
                        });
                      }
                    }}
                  >
                    {returnLookup.activeLoans!.map((entry) => (
                      <option key={entry.copyId} value={entry.copyId}>
                        {entry.barcode} — {entry.loan.studentName} ({entry.loan.studentIdCode}) · Due{' '}
                        {formatDate(entry.loan.dueAt)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-400">Book Title &amp; Copy</div>
                  <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {returnLookup.book.title}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {returnLookup.copy?.barcode} · ISBN {returnLookup.book.isbn}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Issued To</div>
                  <div className="font-semibold mt-0.5">
                    {returnLookup.activeLoan.studentName} ({returnLookup.activeLoan.studentIdCode})
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Issued On</div>
                  <div className="font-mono mt-0.5">{formatDate(returnLookup.activeLoan.issuedAt)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Due Date</div>
                  <div className="font-mono mt-0.5">{formatDate(returnLookup.activeLoan.dueAt)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Book Return Condition">
                  <Select value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
                    <option value="new">New / Pristine</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged (Creates Damage Report)</option>
                    <option value="lost">Lost</option>
                  </Select>
                </Field>
                {(returnCondition === 'damaged' || returnCondition === 'lost') && (
                  <Field label="Damage / Replacement Fine">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={damageFine}
                      onChange={(e) => setDamageFine(e.target.value)}
                    />
                  </Field>
                )}
              </div>

              {(returnCondition === 'damaged' || returnCondition === 'lost') && (
                <Field label="Damage Description">
                  <Textarea
                    value={damageDesc}
                    onChange={(e) => setDamageDesc(e.target.value)}
                    placeholder="Describe physical damage or lost copy details..."
                  />
                </Field>
              )}

              <Button className="w-full" size="lg" loading={returning} onClick={confirmReturn}>
                <CornerDownLeft className="h-4 w-4" />
                Confirm Return &amp; Generate Receipt
              </Button>
            </div>
          )}
        </SurfaceCard>
      )}

      {tab === 'loans' && (
        <SurfaceCard className="overflow-hidden">
          {loansLoading ? (
            <div className="p-5"><SkeletonRows rows={5} /></div>
          ) : !loansData?.loans?.length ? (
            <div className="p-6">
              <EmptyState
                title="No loans recorded yet"
                description="Use the Issue Book tab to check out a physical copy to an active student."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3">Book & Barcode</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Renewals</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loansData.loans.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-mono">{l.receiptNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{l.bookTitle}</div>
                        <div className="font-mono text-slate-500">{l.barcode}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{l.studentName}</div>
                        <div className="font-mono text-slate-500">{l.rollNumber}</div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{formatDate(l.dueAt)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">{l.renewalCount}</td>
                      <td className="px-4 py-3">
                        <StatusText status={l.isOverdue ? 'overdue' : l.status} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                        {l.status !== 'returned' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleRenew(l.id)}>
                              <RotateCw className="h-3.5 w-3.5" />
                              Renew
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setTab('return');
                                setReturnBarcode(l.barcode);
                                lookupReturnCopy(l.barcode);
                              }}
                            >
                              Return
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            downloadReceiptPdf({
                              title: 'Circulation Receipt',
                              receiptNumber: l.receiptNumber,
                              organizationName: orgName,
                              lines: [
                                { label: 'Student', value: `${l.studentName} (${l.studentIdCode})` },
                                { label: 'Book', value: l.bookTitle },
                                { label: 'Barcode', value: l.barcode },
                                { label: 'Issued', value: formatDate(l.issuedAt) },
                                { label: 'Due', value: formatDate(l.dueAt) },
                                { label: 'Status', value: l.status },
                              ],
                            })
                          }
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      )}

      <QrScannerModal
        open={Boolean(scannerMode)}
        onClose={() => setScannerMode(null)}
        title={
          scannerMode === 'student'
            ? 'Scan Student Digital ID QR'
            : 'Scan Book ISBN or Copy Barcode'
        }
        mode={scannerMode === 'student' ? 'qr' : 'barcode'}
        placeholder={
          scannerMode === 'student'
            ? 'Enter QR token, Student ID, or Roll No...'
            : 'Enter ISBN, Copy Barcode, Accession ID, or Title...'
        }
        onScan={(val) => {
          if (scannerMode === 'student') {
            setStudentLookup(val);
            lookupStudent(val);
          } else if (scannerMode === 'issue_book') {
            setIssueBarcode(val);
            lookupIssueBook(val);
          } else if (scannerMode === 'return_book') {
            setReturnBarcode(val);
            lookupReturnCopy(val);
          }
        }}
      />
    </div>
  );
}
