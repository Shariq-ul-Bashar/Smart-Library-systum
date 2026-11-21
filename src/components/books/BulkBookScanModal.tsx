import React, { useState } from 'react';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrScannerModal } from '../scanner/QrScannerModal.tsx';
import { Button, Field, Input, Modal, Select } from '../ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import { downloadBarcodesSheetPdf } from '../../lib/utils.ts';
import { normalizeIsbn } from '../../shared/isbn.ts';

interface StagedBookItem {
  id: string;
  isbn: string;
  physicalBarcode: string;
  title: string;
  authorName: string;
  publisherName: string;
  publicationYear: string;
  categoryId: string;
  categoryName: string;
  subject: string;
  description: string;
  coverImageUrl: string;
  defaultShelfId: string;
  copies: number;
  provider?: string;
  existingInCatalog?: { title: string; totalCopies: number; availableCopies: number } | null;
  status: 'loading' | 'ready' | 'manual';
}

interface BulkBookScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
  categories: Array<{ id: string; name: string }>;
  shelves: Array<{ id: string; rackCode: string; shelfCode: string; sectionName: string }>;
  onSaved: () => void;
}

export function BulkBookScanModal({
  open,
  onOpenChange,
  organizationName,
  categories,
  shelves,
  onSaved,
}: BulkBookScanModalProps) {
  const [isbnInput, setIsbnInput] = useState('');
  const [defaultShelfId, setDefaultShelfId] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [queue, setQueue] = useState<StagedBookItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [savedSummary, setSavedSummary] = useState<{
    createdBooksCount: number;
    updatedBooksCount: number;
    totalCopiesAdded: number;
    results: Array<{
      isbn: string;
      title: string;
      action: 'created' | 'copies_added';
      copiesAdded: number;
      barcodes: string[];
    }>;
  } | null>(null);

  const enqueueIsbn = async (rawCode: string) => {
    const norm = normalizeIsbn(rawCode);
    if (!norm || norm.length < 4) {
      toast.error('Enter or scan a valid ISBN (10 or 13 digits).');
      return;
    }

    // If this normalized ISBN is already in the staging queue, increment its copies count!
    const existingIdx = queue.findIndex((item) => normalizeIsbn(item.isbn) === norm);
    if (existingIdx !== -1) {
      setQueue((prev) =>
        prev.map((item, i) => (i === existingIdx ? { ...item, copies: item.copies + 1 } : item))
      );
      toast.success(`+1 copy added for "${queue[existingIdx].title || norm}" (now ${queue[existingIdx].copies + 1}).`);
      return;
    }

    const trimmedRaw = rawCode.trim();
    const isLikelyIsbn = norm.length === 10 || norm.length === 13;
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const placeholder: StagedBookItem = {
      id: tempId,
      isbn: isLikelyIsbn ? norm : trimmedRaw,
      physicalBarcode: isLikelyIsbn ? '' : trimmedRaw,
      title: '',
      authorName: '',
      publisherName: '',
      publicationYear: String(new Date().getFullYear()),
      categoryId: defaultCategoryId,
      categoryName: '',
      subject: '',
      description: '',
      coverImageUrl: '',
      defaultShelfId,
      copies: 1,
      status: isLikelyIsbn ? 'loading' : 'manual',
    };

    setQueue((prev) => [placeholder, ...prev]);

    if (!isLikelyIsbn) {
      toast.info(`Scanned physical barcode ${trimmedRaw} — enter book title & ISBN (optional) to save.`);
      return;
    }

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

      // Match category if it already exists in org categories
      const matchedCat = res.metadata.categoryName
        ? categories.find((c) => c.name.toLowerCase() === res.metadata.categoryName!.toLowerCase())
        : undefined;

      setQueue((prev) =>
        prev.map((item) =>
          item.id === tempId
            ? {
                ...item,
                isbn: res.metadata.isbn || norm,
                title: res.metadata.title || res.existingBook?.title || '',
                authorName: res.metadata.authorName || '',
                publisherName: res.metadata.publisherName || '',
                publicationYear: res.metadata.publicationYear
                  ? String(res.metadata.publicationYear)
                  : item.publicationYear,
                categoryId: matchedCat?.id || item.categoryId,
                categoryName: matchedCat ? '' : res.metadata.categoryName || '',
                subject: res.metadata.subject || '',
                description: res.metadata.description || '',
                coverImageUrl: res.metadata.coverImageUrl || '',
                provider: res.provider,
                existingInCatalog: res.existingBook || null,
                status: 'ready',
              }
            : item
        )
      );
      toast.success(`Fetched "${res.metadata.title}" via ${res.provider}`);
    } catch {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === tempId
            ? {
                ...item,
                status: 'manual',
              }
            : item
        )
      );
      toast.warning(`ISBN ${norm} not found online — added to queue for quick manual entry.`);
    }
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isbnInput.trim()) return;
    const val = isbnInput.trim();
    setIsbnInput('');
    void enqueueIsbn(val);
  };

  const updateItem = (id: string, patch: Partial<StagedBookItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const totalCopiesQueued = queue.reduce((acc, item) => acc + Math.max(1, item.copies), 0);
  const validItemsCount = queue.filter((item) => item.title.trim().length >= 2 && item.isbn.trim().length >= 4).length;
  const anyLoading = queue.some((item) => item.status === 'loading');

  const handleSaveBatch = async () => {
    const missingTitles = queue.filter((item) => item.title.trim().length < 2);
    if (missingTitles.length > 0) {
      toast.error(`Please enter a Book Title for ${missingTitles.length} staged item(s) before saving.`);
      return;
    }
    if (queue.length === 0) return;

    setSaving(true);
    try {
      const res = await apiRequest<{
        createdBooksCount: number;
        updatedBooksCount: number;
        totalTitlesProcessed: number;
        totalCopiesAdded: number;
        results: Array<{
          isbn: string;
          title: string;
          action: 'created' | 'copies_added';
          copiesAdded: number;
          barcodes: string[];
        }>;
      }>('/org/books/bulk', {
        method: 'POST',
        body: {
          books: queue.map((item) => ({
            isbn: normalizeIsbn(item.isbn) || item.isbn.trim(),
            physicalBarcode: item.physicalBarcode.trim() || null,
            title: item.title.trim(),
            authorName: item.authorName.trim() || undefined,
            publisherName: item.publisherName.trim() || undefined,
            publicationYear: item.publicationYear ? Number(item.publicationYear) : null,
            categoryId: item.categoryId || null,
            categoryName: !item.categoryId && item.categoryName.trim() ? item.categoryName.trim() : null,
            subject: item.subject.trim() || null,
            description: item.description.trim() || null,
            coverImageUrl: item.coverImageUrl || null,
            defaultShelfId: item.defaultShelfId || null,
            initialCopies: Math.max(1, item.copies),
            mergeIfIsbnExists: true,
          })),
        },
      });

      setSavedSummary(res);
      toast.success(
        `Saved ${res.totalCopiesAdded} physical copy/copies across ${res.totalTitlesProcessed} title(s)!`
      );
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save staged books.');
    } finally {
      setSaving(false);
    }
  };

  const resetModal = () => {
    setSavedSummary(null);
    setQueue([]);
    setIsbnInput('');
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) setSavedSummary(null);
          onOpenChange(o);
        }}
        title={savedSummary ? 'Bulk Books Saved Successfully' : 'Bulk Scan & Add Books'}
        description={
          savedSummary
            ? 'All scanned books and normalized ISBNs have been persisted with barcoded physical copies.'
            : 'Scan book ISBN barcodes continuously using your camera or USB scanner. Metadata auto-fetches from Open Library (with Google Books fallback).'
        }
        maxWidth="max-w-5xl"
      >
        {savedSummary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-3.5">
                <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">New Titles Created</div>
                <div className="text-xl font-display font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {savedSummary.createdBooksCount}
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 p-3.5">
                <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300">Existing Titles Restocked</div>
                <div className="text-xl font-display font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {savedSummary.updatedBooksCount}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5">
                <div className="text-[11px] font-medium text-slate-500">Total Physical Copies Added</div>
                <div className="text-xl font-display font-bold tabular-nums">{savedSummary.totalCopiesAdded}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-72">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2">Book Title</th>
                    <th className="px-3 py-2">Normalized ISBN</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Copies &amp; Barcodes</th>
                    <th className="px-3 py-2 text-right">Labels</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {savedSummary.results.map((r, i) => (
                    <tr key={`${r.isbn}-${i}`}>
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{r.title}</td>
                      <td className="px-3 py-2 font-mono">{r.isbn}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-[11px] font-medium ${
                            r.action === 'created'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-[#2563EB] dark:text-[#60A5FA]'
                          }`}
                        >
                          {r.action === 'created' ? 'New Title' : 'Copies Added'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                        +{r.copiesAdded} ({r.barcodes.slice(0, 2).join(', ')}
                        {r.barcodes.length > 2 ? ` +${r.barcodes.length - 2}` : ''})
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            downloadBarcodesSheetPdf({
                              organizationName,
                              bookTitle: r.title,
                              copies: r.barcodes.map((bc) => ({ barcode: bc, accessionNumber: r.isbn })),
                            })
                          }
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button variant="outline" onClick={resetModal}>
                Scan Another Batch
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                <CheckCircle2 className="h-4 w-4" />
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Scan Bar & Defaults */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-3">
              <form onSubmit={handleManualAdd} className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={isbnInput}
                    onChange={(e) => setIsbnInput(e.target.value)}
                    placeholder="Scan ISBN-10 / ISBN-13 with USB scanner or type (e.g. 978-0-13-468599-1)..."
                    className="pl-9 font-mono"
                    autoFocus
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={!isbnInput.trim()}>
                  <Sparkles className="h-4 w-4" />
                  Fetch &amp; Queue
                </Button>
                <Button type="button" onClick={() => setScannerOpen(true)}>
                  <Camera className="h-4 w-4" />
                  Camera Barcode Scanner
                </Button>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Default Shelf Location (applied to newly scanned books)">
                  <Select value={defaultShelfId} onChange={(e) => setDefaultShelfId(e.target.value)}>
                    <option value="">No default shelf</option>
                    {shelves.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.rackCode}-{s.shelfCode} · {s.sectionName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Default Category (fallback if API has no category)">
                  <Select value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                    <option value="">Auto-detect from ISBN metadata</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>

            {/* Staging Queue */}
            {queue.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-10 px-6 text-center space-y-2">
                <BookOpen className="h-9 w-9 mx-auto text-slate-300 dark:text-slate-600" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Staging Queue is Empty
                </div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Scan book barcodes with your camera or enter an ISBN above. Scanning the same book
                  twice automatically increases its copy quantity.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2.5 w-12">Cover</th>
                      <th className="px-3 py-2.5 min-w-[210px]">Title &amp; Normalized ISBN</th>
                      <th className="px-3 py-2.5 min-w-[160px]">Author &amp; Publisher</th>
                      <th className="px-3 py-2.5 min-w-[140px]">Shelf &amp; Category</th>
                      <th className="px-3 py-2.5 w-28 text-center">Copies</th>
                      <th className="px-2 py-2.5 w-9" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {queue.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 align-top">
                          {item.coverImageUrl ? (
                            <img
                              src={item.coverImageUrl}
                              alt={item.title || item.isbn}
                              className="h-12 w-9 rounded object-cover border border-slate-200 dark:border-slate-700"
                            />
                          ) : (
                            <div className="h-12 w-9 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                              {item.status === 'loading' ? (
                                <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
                              ) : (
                                <BookOpen className="h-4 w-4" />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top space-y-1.5">
                          <Input
                            value={item.title}
                            onChange={(e) => updateItem(item.id, { title: e.target.value })}
                            placeholder={item.status === 'loading' ? 'Fetching metadata...' : 'Enter Book Title *'}
                            className="h-8 text-xs font-medium"
                          />
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="font-mono text-slate-500">ISBN: {item.isbn}</span>
                            {item.provider && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                · {item.provider}
                              </span>
                            )}
                            {item.existingInCatalog && (
                              <span className="text-[#2563EB] dark:text-[#60A5FA] font-medium">
                                · In catalog ({item.existingInCatalog.totalCopies} existing copies — will restock)
                              </span>
                            )}
                          </div>
                          <Input
                            value={item.physicalBarcode}
                            onChange={(e) => updateItem(item.id, { physicalBarcode: e.target.value })}
                            placeholder="Optional physical sticker barcode..."
                            className="h-7 text-[11px] font-mono"
                          />
                        </td>
                        <td className="px-2 py-2 align-top space-y-1.5">
                          <Input
                            value={item.authorName}
                            onChange={(e) => updateItem(item.id, { authorName: e.target.value })}
                            placeholder="Author"
                            className="h-8 text-xs"
                          />
                          <div className="flex gap-1.5">
                            <Input
                              value={item.publisherName}
                              onChange={(e) => updateItem(item.id, { publisherName: e.target.value })}
                              placeholder="Publisher"
                              className="h-7 text-[11px]"
                            />
                            <Input
                              type="number"
                              value={item.publicationYear}
                              onChange={(e) => updateItem(item.id, { publicationYear: e.target.value })}
                              placeholder="Year"
                              className="h-7 w-20 text-[11px] font-mono"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top space-y-1.5">
                          <Select
                            value={item.defaultShelfId}
                            onChange={(e) => updateItem(item.id, { defaultShelfId: e.target.value })}
                            className="h-8 text-xs"
                          >
                            <option value="">Shelf (optional)</option>
                            {shelves.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.rackCode}-{s.shelfCode}
                              </option>
                            ))}
                          </Select>
                          <Select
                            value={item.categoryId}
                            onChange={(e) => updateItem(item.id, { categoryId: e.target.value })}
                            className="h-7 text-[11px]"
                          >
                            <option value="">
                              {item.categoryName ? `Auto: ${item.categoryName}` : 'Category'}
                            </option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateItem(item.id, { copies: Math.max(1, item.copies - 1) })}
                              className="h-7 w-7 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <Input
                              type="number"
                              min={1}
                              max={200}
                              value={item.copies}
                              onChange={(e) =>
                                updateItem(item.id, { copies: Math.max(1, Number(e.target.value) || 1) })
                              }
                              className="h-7 w-12 text-center font-mono text-xs px-1"
                            />
                            <button
                              type="button"
                              onClick={() => updateItem(item.id, { copies: Math.min(200, item.copies + 1) })}
                              className="h-7 w-7 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                        <td className="px-1.5 py-2 align-top text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                            title="Remove from queue"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">
                <strong className="text-slate-900 dark:text-white">{queue.length}</strong> title(s) ·{' '}
                <strong className="text-slate-900 dark:text-white">{totalCopiesQueued}</strong> physical copy/copies staged
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  loading={saving}
                  disabled={queue.length === 0 || validItemsCount < queue.length || anyLoading}
                  onClick={handleSaveBatch}
                >
                  Save All Books ({queue.length} / {totalCopiesQueued} copies)
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Bulk Scan Book ISBN Barcodes"
        description="Hold the back cover EAN-13 / ISBN barcode inside the frame. Scanner stays open so you can scan multiple books in sequence."
        placeholder="Or enter / USB-scan ISBN..."
        mode="barcode"
        continuous
        onScan={(code) => {
          void enqueueIsbn(code);
        }}
      />
    </>
  );
}
