import { Router } from 'express';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicSessions,
  acquisitions,
  attendance,
  authors,
  bookCopies,
  books,
  categories,
  courses,
  damageReports,
  fines,
  founderIdentities,
  idCards,
  idTemplates,
  librarySettings,
  loans,
  organizationBranding,
  payments,
  publishers,
  qrTokens,
  renewals,
  reservations,
  semesters,
  shelves,
  studentCategories,
  students,
} from '../../db/schema.ts';
import { getIsbnLookupCandidates, normalizeIsbn } from '../../shared/isbn.ts';
import {
  type AuthRequest,
  createNotification,
  logAudit,
  requireAuth,
  requireOrgRole,
} from '../auth.ts';

export const booksAndCirculationRouter = Router();

// ============================================================================
// CATALOG METADATA (Categories, Authors, Publishers, Shelves)
// ============================================================================

booksAndCirculationRouter.get(
  '/org/catalog-meta',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [cats, auths, pubs, shs] = await Promise.all([
        db.select().from(categories).where(eq(categories.organizationId, orgId)).orderBy(categories.name),
        db.select().from(authors).where(eq(authors.organizationId, orgId)).orderBy(authors.name),
        db.select().from(publishers).where(eq(publishers.organizationId, orgId)).orderBy(publishers.name),
        db.select().from(shelves).where(eq(shelves.organizationId, orgId)).orderBy(shelves.rackCode, shelves.shelfCode),
      ]);
      res.json({ categories: cats, authors: auths, publishers: pubs, shelves: shs });
    } catch (error) {
      console.error('Load catalog metadata failed:', error);
      res.status(500).json({ error: 'Unable to load catalog metadata.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/categories',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        code: z.string().min(1).max(20),
        description: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Category name and code are required.' });

      const [created] = await db
        .insert(categories)
        .values({
          organizationId: req.orgId!,
          name: parsed.data.name.trim(),
          code: parsed.data.code.trim().toUpperCase(),
          description: parsed.data.description?.trim() || null,
        })
        .returning();
      res.status(201).json({ category: created });
    } catch {
      res.status(409).json({ error: 'Category code already exists.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/authors',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        biography: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Author name is required.' });

      const [created] = await db
        .insert(authors)
        .values({
          organizationId: req.orgId!,
          name: parsed.data.name.trim(),
          biography: parsed.data.biography?.trim() || null,
        })
        .returning();
      res.status(201).json({ author: created });
    } catch {
      res.status(500).json({ error: 'Unable to add author.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/publishers',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        website: z.string().optional().nullable(),
        contact: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Publisher name is required.' });

      const [created] = await db
        .insert(publishers)
        .values({
          organizationId: req.orgId!,
          name: parsed.data.name.trim(),
          website: parsed.data.website?.trim() || null,
          contact: parsed.data.contact?.trim() || null,
        })
        .returning();
      res.status(201).json({ publisher: created });
    } catch {
      res.status(500).json({ error: 'Unable to add publisher.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/shelves',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        rackCode: z.string().min(1),
        shelfCode: z.string().min(1),
        sectionName: z.string().min(2),
        capacity: z.coerce.number().int().min(1).default(100),
        notes: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Rack, shelf code, and section are required.' });

      const [created] = await db
        .insert(shelves)
        .values({
          organizationId: req.orgId!,
          rackCode: parsed.data.rackCode.trim().toUpperCase(),
          shelfCode: parsed.data.shelfCode.trim().toUpperCase(),
          sectionName: parsed.data.sectionName.trim(),
          capacity: parsed.data.capacity,
          notes: parsed.data.notes?.trim() || null,
        })
        .returning();
      res.status(201).json({ shelf: created });
    } catch {
      res.status(409).json({ error: 'Rack and shelf combination already exists.' });
    }
  }
);

// ============================================================================
// BOOK CATALOG & SEPARATE PHYSICAL COPIES INVENTORY
// ============================================================================

async function listOrgBooksWithAvailability(orgId: string, includeArchived = false) {
  const rows = await db
    .select({
      book: books,
      authorName: authors.name,
      publisherName: publishers.name,
      categoryName: categories.name,
      courseName: courses.name,
      courseCode: courses.code,
      semesterName: semesters.name,
      rackCode: shelves.rackCode,
      shelfCode: shelves.shelfCode,
      sectionName: shelves.sectionName,
    })
    .from(books)
    .leftJoin(authors, eq(books.authorId, authors.id))
    .leftJoin(publishers, eq(books.publisherId, publishers.id))
    .leftJoin(categories, eq(books.categoryId, categories.id))
    .leftJoin(courses, eq(books.courseId, courses.id))
    .leftJoin(semesters, eq(books.semesterId, semesters.id))
    .leftJoin(shelves, eq(books.defaultShelfId, shelves.id))
    .where(
      includeArchived
        ? eq(books.organizationId, orgId)
        : and(eq(books.organizationId, orgId), eq(books.status, 'active'))
    )
    .orderBy(desc(books.createdAt));

  const allCopies = await db
    .select()
    .from(bookCopies)
    .where(eq(bookCopies.organizationId, orgId));

  const copyStats = new Map<
    string,
    { total: number; available: number; issued: number; reserved: number; damaged: number; lost: number }
  >();

  for (const c of allCopies) {
    const stat = copyStats.get(c.bookId) || {
      total: 0,
      available: 0,
      issued: 0,
      reserved: 0,
      damaged: 0,
      lost: 0,
    };
    stat.total++;
    if (c.status === 'available') stat.available++;
    else if (c.status === 'issued') stat.issued++;
    else if (c.status === 'reserved') stat.reserved++;
    else if (c.status === 'damaged') stat.damaged++;
    else if (c.status === 'lost') stat.lost++;
    copyStats.set(c.bookId, stat);
  }

  return rows.map((r) => ({
    ...r.book,
    authorName: r.authorName,
    publisherName: r.publisherName,
    categoryName: r.categoryName,
    courseName: r.courseName,
    courseCode: r.courseCode,
    semesterName: r.semesterName,
    rackCode: r.rackCode,
    shelfCode: r.shelfCode,
    sectionName: r.sectionName,
    inventory: copyStats.get(r.book.id) || {
      total: 0,
      available: 0,
      issued: 0,
      reserved: 0,
      damaged: 0,
      lost: 0,
    },
  }));
}

booksAndCirculationRouter.get(
  '/org/books',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const includeArchived = req.query.includeArchived === 'true';
      const list = await listOrgBooksWithAvailability(req.orgId!, includeArchived);
      res.json({ books: list });
    } catch (error) {
      console.error('List books failed:', error);
      res.status(500).json({ error: 'Unable to load book catalog.' });
    }
  }
);

const createBookSchema = z.object({
  isbn: z.string().min(4),
  title: z.string().min(2),
  subtitle: z.string().optional().nullable(),
  authorId: z.string().uuid().optional().nullable(),
  authorName: z.string().optional(),
  publisherId: z.string().uuid().optional().nullable(),
  publisherName: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  edition: z.string().optional().nullable(),
  publicationYear: z.coerce.number().int().min(1400).max(2100).optional().nullable(),
  language: z.string().default('English'),
  subject: z.string().optional().nullable(),
  courseId: z.string().uuid().optional().nullable(),
  semesterId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  coverImageUrl: z.string().optional().nullable(),
  defaultShelfId: z.string().uuid().optional().nullable(),
  initialCopies: z.coerce.number().int().min(0).max(200).default(1),
  purchaseDate: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().min(0).optional().nullable(),
  supplier: z.string().optional().nullable(),
  physicalBarcode: z.string().max(120).optional().nullable(),
});

async function findOrCreateAuthor(orgId: string, authorName?: string | null): Promise<string | null> {
  const clean = authorName?.trim();
  if (!clean) return null;
  const existing = await db
    .select({ id: authors.id })
    .from(authors)
    .where(and(eq(authors.organizationId, orgId), ilike(authors.name, clean)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(authors)
    .values({ organizationId: orgId, name: clean })
    .returning();
  return created.id;
}

async function findOrCreatePublisher(orgId: string, publisherName?: string | null): Promise<string | null> {
  const clean = publisherName?.trim();
  if (!clean) return null;
  const existing = await db
    .select({ id: publishers.id })
    .from(publishers)
    .where(and(eq(publishers.organizationId, orgId), ilike(publishers.name, clean)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(publishers)
    .values({ organizationId: orgId, name: clean })
    .returning();
  return created.id;
}

async function findOrCreateCategory(orgId: string, categoryName?: string | null): Promise<string | null> {
  const clean = categoryName?.trim();
  if (!clean) return null;
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.organizationId, orgId), ilike(categories.name, clean)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const code =
    clean
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6) || `CAT${Math.floor(100 + Math.random() * 900)}`;
  const [created] = await db
    .insert(categories)
    .values({ organizationId: orgId, name: clean, code: `${code}-${Math.floor(10 + Math.random() * 89)}` })
    .returning();
  return created.id;
}

booksAndCirculationRouter.post(
  '/org/books',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const parsed = createBookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid book input.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;
      const normalizedIsbn = normalizeIsbn(d.isbn) || d.isbn.trim().toUpperCase();

      const rawPhysicalBarcode = d.physicalBarcode?.trim() || '';
      if (rawPhysicalBarcode) {
        const dupBarcode = await db
          .select({ id: bookCopies.id, barcode: bookCopies.barcode })
          .from(bookCopies)
          .where(and(eq(bookCopies.organizationId, orgId), eq(bookCopies.barcode, rawPhysicalBarcode)))
          .limit(1);
        if (dupBarcode.length > 0) {
          return res.status(409).json({
            error: `Physical barcode "${rawPhysicalBarcode}" is already registered to another book copy in this library.`,
          });
        }
      }

      const authorId = d.authorId || (await findOrCreateAuthor(orgId, d.authorName));
      const publisherId = d.publisherId || (await findOrCreatePublisher(orgId, d.publisherName));
      const categoryId = d.categoryId || (await findOrCreateCategory(orgId, d.categoryName));

      const result = await db.transaction(async (tx) => {
        const [book] = await tx
          .insert(books)
          .values({
            organizationId: orgId,
            isbn: normalizedIsbn,
            title: d.title.trim(),
            subtitle: d.subtitle?.trim() || null,
            authorId,
            publisherId,
            categoryId,
            edition: d.edition?.trim() || null,
            publicationYear: d.publicationYear || null,
            language: d.language || 'English',
            subject: d.subject?.trim() || null,
            courseId: d.courseId || null,
            semesterId: d.semesterId || null,
            description: d.description?.trim() || null,
            coverImageUrl: d.coverImageUrl || null,
            defaultShelfId: d.defaultShelfId || null,
            status: 'active',
          })
          .returning();

        const createdCopies = [];
        const batchPrefix = `BK-${Date.now().toString().slice(-6)}`;
        for (let i = 1; i <= d.initialCopies; i++) {
          const seq = String(i).padStart(3, '0');
          const barcode = rawPhysicalBarcode
            ? i === 1
              ? rawPhysicalBarcode
              : `${rawPhysicalBarcode}-${seq}`
            : `${batchPrefix}-${seq}`;
          const accessionNumber = `ACC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}-${seq}`;
          const [copy] = await tx
            .insert(bookCopies)
            .values({
              organizationId: orgId,
              bookId: book.id,
              barcode,
              accessionNumber,
              qrCodeValue: barcode,
              shelfId: d.defaultShelfId || null,
              status: 'available',
              condition: 'new',
              purchaseDate: d.purchaseDate || new Date().toISOString().slice(0, 10),
              purchasePrice: d.purchasePrice != null ? d.purchasePrice.toFixed(2) : null,
              supplier: d.supplier?.trim() || null,
            })
            .returning();
          createdCopies.push(copy);
        }

        if (d.initialCopies > 0) {
          const unitPrice = d.purchasePrice ?? 0;
          await tx.insert(acquisitions).values({
            organizationId: orgId,
            bookId: book.id,
            supplier: d.supplier?.trim() || 'Direct Institutional Purchase',
            quantity: d.initialCopies,
            unitPrice: unitPrice.toFixed(2),
            totalCost: (unitPrice * d.initialCopies).toFixed(2),
            purchasedAt: d.purchaseDate || new Date().toISOString().slice(0, 10),
            recordedByProfileId: req.profile!.id,
          });
        }

        return { book, copies: createdCopies };
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_created',
        entityType: 'book',
        entityId: result.book.id,
        details: { title: result.book.title, isbn: result.book.isbn, copiesAdded: result.copies.length },
      });

      res.status(201).json(result);
    } catch (error) {
      console.error('Create book failed:', error);
      res.status(500).json({ error: 'Unable to create book record.' });
    }
  }
);

const bulkBookItemSchema = createBookSchema.extend({
  initialCopies: z.coerce.number().int().min(1).max(200).default(1),
  mergeIfIsbnExists: z.boolean().optional().default(true),
});

booksAndCirculationRouter.post(
  '/org/books/bulk',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        books: z.array(bulkBookItemSchema).min(1).max(200),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Provide at least one valid book to save.',
        });
      }

      const orgId = req.orgId!;
      const results: Array<{
        isbn: string;
        title: string;
        action: 'created' | 'copies_added';
        bookId: string;
        copiesAdded: number;
        barcodes: string[];
      }> = [];
      let createdBooksCount = 0;
      let updatedBooksCount = 0;
      let totalCopiesAdded = 0;

      for (let idx = 0; idx < parsed.data.books.length; idx++) {
        const d = parsed.data.books[idx];
        const normalizedIsbn = normalizeIsbn(d.isbn) || d.isbn.trim().toUpperCase();
        const isbnCandidates = getIsbnLookupCandidates(normalizedIsbn);

        // Check if active book with equivalent normalized ISBN already exists in org
        const existingBook =
          d.mergeIfIsbnExists && isbnCandidates.length > 0
            ? (
                await db
                  .select()
                  .from(books)
                  .where(
                    and(
                      eq(books.organizationId, orgId),
                      eq(books.status, 'active'),
                      sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) IN (${sql.join(
                        isbnCandidates.map((c) => sql`${c}`),
                        sql`, `
                      )})`
                    )
                  )
                  .limit(1)
              )[0]
            : undefined;

        const authorId = existingBook
          ? existingBook.authorId
          : d.authorId || (await findOrCreateAuthor(orgId, d.authorName));
        const publisherId = existingBook
          ? existingBook.publisherId
          : d.publisherId || (await findOrCreatePublisher(orgId, d.publisherName));
        const categoryId = existingBook
          ? existingBook.categoryId
          : d.categoryId || (await findOrCreateCategory(orgId, d.categoryName));

        const saved = await db.transaction(async (tx) => {
          let bookRow = existingBook;
          let action: 'created' | 'copies_added' = 'copies_added';

          if (!bookRow) {
            action = 'created';
            const [inserted] = await tx
              .insert(books)
              .values({
                organizationId: orgId,
                isbn: normalizedIsbn,
                title: d.title.trim(),
                subtitle: d.subtitle?.trim() || null,
                authorId,
                publisherId,
                categoryId,
                edition: d.edition?.trim() || null,
                publicationYear: d.publicationYear || null,
                language: d.language || 'English',
                subject: d.subject?.trim() || null,
                courseId: d.courseId || null,
                semesterId: d.semesterId || null,
                description: d.description?.trim() || null,
                coverImageUrl: d.coverImageUrl || null,
                defaultShelfId: d.defaultShelfId || null,
                status: 'active',
              })
              .returning();
            bookRow = inserted;
          }

          const barcodes: string[] = [];
          const customPhys = d.physicalBarcode?.trim() || '';
          const batchPrefix = `BK-${Date.now().toString().slice(-6)}-${String(idx + 1).padStart(2, '0')}`;
          for (let i = 1; i <= d.initialCopies; i++) {
            const seq = String(i).padStart(3, '0');
            let barcode = customPhys
              ? i === 1
                ? customPhys
                : `${customPhys}-${seq}`
              : `${batchPrefix}-${seq}`;
            if (customPhys) {
              const dup = await tx
                .select({ id: bookCopies.id })
                .from(bookCopies)
                .where(and(eq(bookCopies.organizationId, orgId), eq(bookCopies.barcode, barcode)))
                .limit(1);
              if (dup.length > 0) {
                barcode = `${batchPrefix}-${seq}`;
              }
            }
            const accessionNumber = `ACC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}-${idx + 1}${seq}`;
            await tx.insert(bookCopies).values({
              organizationId: orgId,
              bookId: bookRow.id,
              barcode,
              accessionNumber,
              qrCodeValue: barcode,
              shelfId: d.defaultShelfId || bookRow.defaultShelfId || null,
              status: 'available',
              condition: 'new',
              purchaseDate: d.purchaseDate || new Date().toISOString().slice(0, 10),
              purchasePrice: d.purchasePrice != null ? d.purchasePrice.toFixed(2) : null,
              supplier: d.supplier?.trim() || null,
            });
            barcodes.push(barcode);
          }

          const unitPrice = d.purchasePrice ?? 0;
          await tx.insert(acquisitions).values({
            organizationId: orgId,
            bookId: bookRow.id,
            supplier: d.supplier?.trim() || 'Bulk Scan Acquisition',
            quantity: d.initialCopies,
            unitPrice: unitPrice.toFixed(2),
            totalCost: (unitPrice * d.initialCopies).toFixed(2),
            purchasedAt: d.purchaseDate || new Date().toISOString().slice(0, 10),
            recordedByProfileId: req.profile!.id,
          });

          return { bookRow, action, barcodes };
        });

        if (saved.action === 'created') createdBooksCount++;
        else updatedBooksCount++;
        totalCopiesAdded += saved.barcodes.length;

        results.push({
          isbn: saved.bookRow.isbn,
          title: saved.bookRow.title,
          action: saved.action,
          bookId: saved.bookRow.id,
          copiesAdded: saved.barcodes.length,
          barcodes: saved.barcodes,
        });
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'books_bulk_created',
        entityType: 'book',
        details: { createdBooksCount, updatedBooksCount, totalCopiesAdded },
      });

      res.status(201).json({
        createdBooksCount,
        updatedBooksCount,
        totalTitlesProcessed: results.length,
        totalCopiesAdded,
        results,
      });
    } catch (error) {
      console.error('Bulk book create failed:', error);
      res.status(500).json({ error: 'Unable to save bulk book batch.' });
    }
  }
);

booksAndCirculationRouter.patch(
  '/org/books/:id/archive',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const nextStatus = req.body?.status === 'active' ? 'active' : 'archived';
      const [updated] = await db
        .update(books)
        .set({
          status: nextStatus,
          archivedAt: nextStatus === 'archived' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(books.id, req.params.id), eq(books.organizationId, req.orgId!)))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Book not found.' });

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: nextStatus === 'archived' ? 'book_archived' : 'book_restored',
        entityType: 'book',
        entityId: updated.id,
        details: { title: updated.title },
      });

      res.json({ book: updated });
    } catch (error) {
      console.error('Archive book failed:', error);
      res.status(500).json({ error: 'Unable to archive book.' });
    }
  }
);

booksAndCirculationRouter.get(
  '/org/books/:id/copies',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const copies = await db
        .select({
          copy: bookCopies,
          rackCode: shelves.rackCode,
          shelfCode: shelves.shelfCode,
          sectionName: shelves.sectionName,
        })
        .from(bookCopies)
        .leftJoin(shelves, eq(bookCopies.shelfId, shelves.id))
        .where(and(eq(bookCopies.bookId, req.params.id), eq(bookCopies.organizationId, orgId)))
        .orderBy(asc(bookCopies.barcode));

      const copyLoans = await db
        .select({
          id: loans.id,
          bookCopyId: loans.bookCopyId,
          status: loans.status,
          issuedAt: loans.issuedAt,
          dueAt: loans.dueAt,
          returnedAt: loans.returnedAt,
          studentName: students.fullName,
          rollNumber: students.collegeRollNumber,
        })
        .from(loans)
        .innerJoin(students, eq(loans.studentId, students.id))
        .where(and(eq(loans.bookId, req.params.id), eq(loans.organizationId, orgId)))
        .orderBy(desc(loans.issuedAt))
        .limit(40);

      res.json({
        copies: copies.map((c) => ({
          ...c.copy,
          rackCode: c.rackCode,
          shelfCode: c.shelfCode,
          sectionName: c.sectionName,
        })),
        history: copyLoans,
      });
    } catch (error) {
      console.error('List book copies failed:', error);
      res.status(500).json({ error: 'Unable to load physical copies.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/books/:id/copies',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        quantity: z.coerce.number().int().min(1).max(100).default(1),
        shelfId: z.string().uuid().optional().nullable(),
        condition: z.enum(['new', 'good', 'fair', 'poor', 'damaged']).default('new'),
        purchaseDate: z.string().optional().nullable(),
        purchasePrice: z.coerce.number().min(0).optional().nullable(),
        supplier: z.string().optional().nullable(),
        barcodePrefix: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid copy batch parameters.' });

      const orgId = req.orgId!;
      const [book] = await db
        .select()
        .from(books)
        .where(and(eq(books.id, req.params.id), eq(books.organizationId, orgId)))
        .limit(1);
      if (!book) return res.status(404).json({ error: 'Master book record not found.' });

      const d = parsed.data;
      const prefix = (d.barcodePrefix?.trim() || `BK-${Date.now().toString().slice(-6)}`).toUpperCase();
      const created = [];

      for (let i = 1; i <= d.quantity; i++) {
        const seq = String(i).padStart(3, '0');
        const barcode = `${prefix}-${seq}`;
        const accessionNumber = `ACC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}-${seq}`;
        const [copy] = await db
          .insert(bookCopies)
          .values({
            organizationId: orgId,
            bookId: book.id,
            barcode,
            accessionNumber,
            qrCodeValue: barcode,
            shelfId: d.shelfId || book.defaultShelfId || null,
            status: 'available',
            condition: d.condition,
            purchaseDate: d.purchaseDate || new Date().toISOString().slice(0, 10),
            purchasePrice: d.purchasePrice != null ? d.purchasePrice.toFixed(2) : null,
            supplier: d.supplier?.trim() || null,
          })
          .returning();
        created.push(copy);
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_copies_added',
        entityType: 'book',
        entityId: book.id,
        details: { quantity: created.length, prefix },
      });

      res.status(201).json({ copies: created });
    } catch (error) {
      console.error('Add book copies failed:', error);
      res.status(409).json({ error: 'Barcode collision or unable to add copies.' });
    }
  }
);

booksAndCirculationRouter.patch(
  '/org/copies/:copyId',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(['available', 'reserved', 'damaged', 'lost', 'under_maintenance']).optional(),
        condition: z.enum(['new', 'good', 'fair', 'poor', 'damaged']).optional(),
        shelfId: z.string().uuid().optional().nullable(),
        notes: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid copy update payload.' });

      const [existing] = await db
        .select()
        .from(bookCopies)
        .where(and(eq(bookCopies.id, req.params.copyId), eq(bookCopies.organizationId, req.orgId!)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: 'Physical copy not found.' });
      if (existing.status === 'issued' && parsed.data.status) {
        return res.status(400).json({
          error: 'Cannot manually change status of an issued copy. Process a book return first.',
        });
      }

      const [updated] = await db
        .update(bookCopies)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(bookCopies.id, existing.id))
        .returning();

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_copy_updated',
        entityType: 'book_copy',
        entityId: updated.id,
        details: parsed.data,
      });

      res.json({ copy: updated });
    } catch (error) {
      console.error('Update copy failed:', error);
      res.status(500).json({ error: 'Unable to update physical copy.' });
    }
  }
);

booksAndCirculationRouter.get(
  '/org/copies/lookup',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const rawCode =
        typeof req.query.code === 'string'
          ? req.query.code.trim()
          : typeof req.query.q === 'string'
            ? req.query.q.trim()
            : '';
      const mode = req.query.mode === 'return' ? 'return' : req.query.mode === 'all' ? 'all' : 'issue';
      if (!rawCode) {
        return res.status(400).json({ error: 'Enter a Copy Barcode, Accession ID, ISBN, or Book Title.' });
      }

      const orgId = req.orgId!;
      let matchedBy: 'barcode' | 'accession' | 'isbn' | 'title' = 'barcode';
      let directCopyId: string | null = null;
      let matchedBookIds: string[] = [];

      // 1. Direct physical copy lookup (case-insensitive exact match on barcode, accessionNumber, or qrCodeValue)
      const directCopyRows = await db
        .select({
          copyId: bookCopies.id,
          bookId: bookCopies.bookId,
          barcode: bookCopies.barcode,
          accessionNumber: bookCopies.accessionNumber,
        })
        .from(bookCopies)
        .where(
          and(
            eq(bookCopies.organizationId, orgId),
            or(
              ilike(bookCopies.barcode, rawCode),
              ilike(bookCopies.accessionNumber, rawCode),
              ilike(bookCopies.qrCodeValue, rawCode)
            )
          )
        )
        .limit(1);

      if (directCopyRows.length > 0) {
        directCopyId = directCopyRows[0].copyId;
        matchedBookIds = [directCopyRows[0].bookId];
        matchedBy =
          directCopyRows[0].accessionNumber.toLowerCase() === rawCode.toLowerCase()
            ? 'accession'
            : 'barcode';
      }

      // 2. Normalized ISBN lookup (strips hyphens/spaces, matches both ISBN-10 and ISBN-13 equivalents)
      if (matchedBookIds.length === 0) {
        const isbnCandidates = getIsbnLookupCandidates(rawCode);
        if (isbnCandidates.length > 0 && isbnCandidates[0].length >= 4) {
          const exactIsbnBooks = await db
            .select({ id: books.id })
            .from(books)
            .where(
              and(
                eq(books.organizationId, orgId),
                eq(books.status, 'active'),
                sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) IN (${sql.join(
                  isbnCandidates.map((c) => sql`${c}`),
                  sql`, `
                )})`
              )
            )
            .orderBy(desc(books.createdAt));

          if (exactIsbnBooks.length > 0) {
            matchedBookIds = exactIsbnBooks.map((b) => b.id);
            matchedBy = 'isbn';
          } else if (isbnCandidates[0].length >= 6) {
            const partialIsbnBooks = await db
              .select({ id: books.id })
              .from(books)
              .where(
                and(
                  eq(books.organizationId, orgId),
                  eq(books.status, 'active'),
                  sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) LIKE ${`%${isbnCandidates[0]}%`}`
                )
              )
              .orderBy(desc(books.createdAt))
              .limit(10);
            if (partialIsbnBooks.length > 0) {
              matchedBookIds = partialIsbnBooks.map((b) => b.id);
              matchedBy = 'isbn';
            }
          }
        }
      }

      // 3. Book Title lookup (case-insensitive)
      if (matchedBookIds.length === 0 && rawCode.length >= 2) {
        const titleBooks = await db
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(
            and(
              eq(books.organizationId, orgId),
              eq(books.status, 'active'),
              ilike(books.title, `%${rawCode}%`)
            )
          )
          .orderBy(desc(books.createdAt))
          .limit(10);

        if (titleBooks.length > 0) {
          const exactTitle = titleBooks.filter((b) => b.title.toLowerCase() === rawCode.toLowerCase());
          matchedBookIds = (exactTitle.length > 0 ? exactTitle : titleBooks).map((b) => b.id);
          matchedBy = 'title';
        }
      }

      if (matchedBookIds.length === 0) {
        return res.status(404).json({
          error: `No book or physical copy found matching "${rawCode}" (checked barcode, accession ID, normalized ISBN, and title).`,
        });
      }

      const [bookRows, copyRows, loanRows] = await Promise.all([
        db
          .select({
            book: books,
            authorName: authors.name,
            publisherName: publishers.name,
            categoryName: categories.name,
          })
          .from(books)
          .leftJoin(authors, eq(books.authorId, authors.id))
          .leftJoin(publishers, eq(books.publisherId, publishers.id))
          .leftJoin(categories, eq(books.categoryId, categories.id))
          .where(and(eq(books.organizationId, orgId), inArray(books.id, matchedBookIds))),
        db
          .select({
            copy: bookCopies,
            rackCode: shelves.rackCode,
            shelfCode: shelves.shelfCode,
          })
          .from(bookCopies)
          .leftJoin(shelves, eq(bookCopies.shelfId, shelves.id))
          .where(and(eq(bookCopies.organizationId, orgId), inArray(bookCopies.bookId, matchedBookIds)))
          .orderBy(asc(bookCopies.barcode)),
        db
          .select({
            loan: loans,
            studentName: students.fullName,
            studentIdCode: students.studentIdCode,
            rollNumber: students.collegeRollNumber,
          })
          .from(loans)
          .innerJoin(students, eq(loans.studentId, students.id))
          .where(
            and(
              eq(loans.organizationId, orgId),
              inArray(loans.bookId, matchedBookIds),
              or(eq(loans.status, 'active'), eq(loans.status, 'overdue'))
            )
          )
          .orderBy(asc(loans.dueAt)),
      ]);

      const bookById = new Map(
        bookRows.map((r) => [
          r.book.id,
          {
            ...r.book,
            authorName: r.authorName,
            publisherName: r.publisherName,
            categoryName: r.categoryName,
          },
        ])
      );

      const loanByCopyId = new Map(
        loanRows.map((r) => [
          r.loan.bookCopyId,
          {
            ...r.loan,
            studentName: r.studentName,
            studentIdCode: r.studentIdCode,
            rollNumber: r.rollNumber,
          },
        ])
      );

      const enrichedCopies = copyRows.map((c) => {
        const b = bookById.get(c.copy.bookId);
        return {
          ...c.copy,
          rackCode: c.rackCode,
          shelfCode: c.shelfCode,
          bookTitle: b?.title || '',
          bookIsbn: b?.isbn || '',
          activeLoan: loanByCopyId.get(c.copy.id) || null,
        };
      });

      let selectedCopy =
        (directCopyId ? enrichedCopies.find((c) => c.id === directCopyId) : undefined) || null;

      if (!selectedCopy && enrichedCopies.length > 0) {
        if (mode === 'return') {
          selectedCopy =
            enrichedCopies.find((c) => Boolean(c.activeLoan)) ||
            enrichedCopies.find((c) => c.status === 'issued') ||
            enrichedCopies[0];
        } else {
          selectedCopy =
            enrichedCopies.find((c) => c.status === 'available') ||
            enrichedCopies.find((c) => c.status === 'reserved') ||
            enrichedCopies[0];
        }
      }

      const primaryBook =
        (selectedCopy ? bookById.get(selectedCopy.bookId) : undefined) ||
        bookById.get(matchedBookIds[0])!;

      const inventory = {
        total: enrichedCopies.length,
        available: enrichedCopies.filter((c) => c.status === 'available').length,
        issued: enrichedCopies.filter((c) => c.status === 'issued').length,
        reserved: enrichedCopies.filter((c) => c.status === 'reserved').length,
      };

      const activeLoans = enrichedCopies
        .filter((c) => Boolean(c.activeLoan))
        .map((c) => ({
          copyId: c.id,
          barcode: c.barcode,
          bookTitle: c.bookTitle,
          bookIsbn: c.bookIsbn,
          loan: c.activeLoan!,
        }));

      let statusMessage = '';
      if (enrichedCopies.length === 0) {
        statusMessage = `Found "${primaryBook.title}" (ISBN ${primaryBook.isbn}), but it has 0 physical copies registered. Add copies in Book Catalog first.`;
      } else if (mode === 'issue') {
        if (selectedCopy && (selectedCopy.status === 'available' || selectedCopy.status === 'reserved')) {
          statusMessage = `Ready to issue (${inventory.available} of ${inventory.total} copy/copies available).`;
        } else {
          const borrowerHint = selectedCopy?.activeLoan
            ? ` Currently issued to ${selectedCopy.activeLoan.studentName} (due ${new Date(selectedCopy.activeLoan.dueAt).toLocaleDateString()}).`
            : '';
          statusMessage = `All ${inventory.total} copy/copies of "${primaryBook.title}" are currently unavailable.${borrowerHint}`;
        }
      } else if (mode === 'return') {
        if (activeLoans.length > 0) {
          statusMessage =
            activeLoans.length === 1
              ? `Active loan found for ${activeLoans[0].loan.studentName}.`
              : `${activeLoans.length} copies of "${primaryBook.title}" are currently issued. Select the copy being returned.`;
        } else {
          statusMessage = `"${primaryBook.title}" has no actively issued copies to return (${inventory.available} available on shelf).`;
        }
      }

      res.json({
        matchedBy,
        statusMessage,
        inventory,
        copy: selectedCopy,
        copies: enrichedCopies,
        book: primaryBook,
        activeLoan: selectedCopy?.activeLoan || null,
        activeLoans,
      });
    } catch (error) {
      console.error('Copy lookup failed:', error);
      res.status(500).json({ error: 'Unable to look up book or physical copy.' });
    }
  }
);

// ============================================================================
// CIRCULATION: ATOMIC ISSUE, RETURN & RENEWAL
// ============================================================================

booksAndCirculationRouter.get(
  '/org/loans',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const rows = await db
        .select({
          loan: loans,
          bookTitle: books.title,
          bookIsbn: books.isbn,
          barcode: bookCopies.barcode,
          accessionNumber: bookCopies.accessionNumber,
          studentName: students.fullName,
          studentIdCode: students.studentIdCode,
          rollNumber: students.collegeRollNumber,
        })
        .from(loans)
        .innerJoin(books, eq(loans.bookId, books.id))
        .innerJoin(bookCopies, eq(loans.bookCopyId, bookCopies.id))
        .innerJoin(students, eq(loans.studentId, students.id))
        .where(eq(loans.organizationId, orgId))
        .orderBy(desc(loans.issuedAt))
        .limit(200);

      const now = new Date();
      res.json({
        loans: rows.map((r) => ({
          ...r.loan,
          isOverdue: r.loan.status !== 'returned' && new Date(r.loan.dueAt) < now,
          bookTitle: r.bookTitle,
          bookIsbn: r.bookIsbn,
          barcode: r.barcode,
          accessionNumber: r.accessionNumber,
          studentName: r.studentName,
          studentIdCode: r.studentIdCode,
          rollNumber: r.rollNumber,
        })),
      });
    } catch (error) {
      console.error('List loans failed:', error);
      res.status(500).json({ error: 'Unable to load circulation records.' });
    }
  }
);

// Resolve Student by Student Digital ID QR, Linked Golden Founder ID QR/Number, Student ID Code, Roll Number, or Email
booksAndCirculationRouter.get(
  '/org/circulation/resolve-student',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!query) return res.status(400).json({ error: 'Scan QR or enter Student ID / Roll Number.' });
      const orgId = req.orgId!;

      // First check if query is a QR token (or full verify URL containing token)
      const tokenCandidate = query.includes('/verify/') ? query.split('/verify/').pop()?.trim() || query : query;
      let studentId: string | null = null;
      let scannedVia: 'student_id' | 'founder_id' | 'manual' = 'manual';

      const [qrMatch] = await db
        .select()
        .from(qrTokens)
        .where(eq(qrTokens.token, tokenCandidate))
        .limit(1);

      if (qrMatch) {
        if (!qrMatch.isActive || qrMatch.revokedAt) {
          return res.status(400).json({ error: 'Scanned Digital ID QR code is revoked or inactive.' });
        }
        if (qrMatch.expiresAt && new Date(qrMatch.expiresAt) < new Date()) {
          return res.status(400).json({ error: 'Scanned Digital ID QR code has expired.' });
        }

        if (qrMatch.entityType === 'student_id') {
          if (qrMatch.organizationId !== orgId) {
            return res.status(403).json({
              error: 'Access denied: this Student Digital ID belongs to a different institution.',
            });
          }
          const [card] = await db.select().from(idCards).where(eq(idCards.id, qrMatch.entityId)).limit(1);
          if (!card || card.status !== 'active' || new Date(card.expiresAt) < new Date()) {
            return res.status(400).json({
              error: `Student Digital ID card is ${card?.status || 'invalid'} or expired.`,
            });
          }
          studentId = card.studentId;
          scannedVia = 'student_id';
        } else if (qrMatch.entityType === 'founder_id') {
          const [founder] = await db
            .select()
            .from(founderIdentities)
            .where(eq(founderIdentities.id, qrMatch.entityId))
            .limit(1);

          if (!founder || founder.status !== 'active') {
            return res.status(400).json({ error: 'Scanned Golden Founder ID is revoked or inactive.' });
          }
          if (!founder.linkedStudentId || founder.linkedOrganizationId !== orgId) {
            return res.status(403).json({
              error: 'This Founder ID does not have a linked student membership at this college.',
            });
          }
          if (founder.collegeLinkStatus !== 'approved') {
            return res.status(403).json({
              error: `Founder ID college link is "${founder.collegeLinkStatus}". College Admin approval is required before borrowing.`,
            });
          }
          studentId = founder.linkedStudentId;
          scannedVia = 'founder_id';
        }
      }

      // Also allow lookup by Founder ID Number (e.g., QIV-FND-2026-2431)
      if (!studentId && /^QIV-FND-|^SHX-FND-/i.test(query)) {
        const [founderByNumber] = await db
          .select()
          .from(founderIdentities)
          .where(eq(founderIdentities.founderNumber, query.toUpperCase()))
          .limit(1);

        if (founderByNumber) {
          if (founderByNumber.status !== 'active') {
            return res.status(400).json({ error: 'This Founder ID is revoked or inactive.' });
          }
          if (!founderByNumber.linkedStudentId || founderByNumber.linkedOrganizationId !== orgId) {
            return res.status(403).json({
              error: 'This Founder ID is not linked to a student account in this institution.',
            });
          }
          if (founderByNumber.collegeLinkStatus !== 'approved') {
            return res.status(403).json({
              error: `Founder ID college link is "${founderByNumber.collegeLinkStatus}". College Admin approval is required.`,
            });
          }
          studentId = founderByNumber.linkedStudentId;
          scannedVia = 'founder_id';
        }
      }

      let studentRow;
      if (studentId) {
        [studentRow] = await db
          .select()
          .from(students)
          .where(and(eq(students.id, studentId), eq(students.organizationId, orgId)))
          .limit(1);
      } else {
        [studentRow] = await db
          .select()
          .from(students)
          .where(
            and(
              eq(students.organizationId, orgId),
              or(
                eq(students.studentIdCode, query),
                eq(students.collegeRollNumber, query),
                eq(students.email, query.toLowerCase())
              )
            )
          )
          .limit(1);
      }

      if (!studentRow) {
        return res.status(404).json({ error: 'No matching student found in this institution.' });
      }

      const [
        activeLoans,
        unpaidFines,
        settingsRow,
        categoryRow,
        courseRow,
        semRow,
        sessRow,
        latestCardRows,
        linkedFounderRows,
      ] = await Promise.all([
        db
          .select()
          .from(loans)
          .where(
            and(
              eq(loans.studentId, studentRow.id),
              eq(loans.organizationId, orgId),
              or(eq(loans.status, 'active'), eq(loans.status, 'overdue'))
            )
          ),
        db
          .select()
          .from(fines)
          .where(
            and(
              eq(fines.studentId, studentRow.id),
              eq(fines.organizationId, orgId),
              inArray(fines.status, ['unpaid', 'partial', 'waiver_requested'])
            )
          ),
        db.select().from(librarySettings).where(eq(librarySettings.organizationId, orgId)).limit(1),
        studentRow.studentCategoryId
          ? db.select().from(studentCategories).where(eq(studentCategories.id, studentRow.studentCategoryId)).limit(1)
          : Promise.resolve([]),
        studentRow.courseId
          ? db.select({ name: courses.name }).from(courses).where(eq(courses.id, studentRow.courseId)).limit(1)
          : Promise.resolve([]),
        studentRow.semesterId
          ? db.select({ name: semesters.name }).from(semesters).where(eq(semesters.id, studentRow.semesterId)).limit(1)
          : Promise.resolve([]),
        studentRow.academicSessionId
          ? db.select({ name: academicSessions.name }).from(academicSessions).where(eq(academicSessions.id, studentRow.academicSessionId)).limit(1)
          : Promise.resolve([]),
        db
          .select()
          .from(idCards)
          .where(and(eq(idCards.studentId, studentRow.id), eq(idCards.organizationId, orgId)))
          .orderBy(desc(idCards.createdAt))
          .limit(1),
        db
          .select({
            founderNumber: founderIdentities.founderNumber,
            designation: founderIdentities.designation,
            editionName: founderIdentities.editionName,
            organizationLabel: founderIdentities.organizationLabel,
          })
          .from(founderIdentities)
          .where(
            and(
              eq(founderIdentities.linkedStudentId, studentRow.id),
              eq(founderIdentities.linkedOrganizationId, orgId),
              eq(founderIdentities.status, 'active'),
              eq(founderIdentities.collegeLinkStatus, 'approved')
            )
          )
          .limit(1),
      ]);

      const settings = settingsRow[0];
      const cat = categoryRow[0];
      const maxBooks = cat?.maxBooksAllowed ?? settings?.maxBooksPerStudent ?? 4;
      const loanDays = cat?.loanDurationDays ?? settings?.defaultLoanDays ?? 14;
      const maxFineAllowed = Number(settings?.maxOutstandingFineForBorrow ?? 100);
      const outstandingFine = unpaidFines.reduce(
        (sum, f) => sum + Math.max(0, Number(f.amount) - Number(f.paidAmount) - Number(f.waivedAmount)),
        0
      );
      const now = new Date();
      const overdueLoansCount = activeLoans.filter((l) => new Date(l.dueAt) < now).length;
      const latestCard = latestCardRows[0];
      const membershipExpired = Boolean(
        latestCard && (latestCard.status === 'expired' || latestCard.status === 'blocked' || latestCard.status === 'suspended' || new Date(latestCard.expiresAt) < now)
      );

      // Strict college governance: Founder designation NEVER bypasses limits, overdue rules, fines, or membership expiry!
      const blockReason =
        studentRow.status !== 'active'
          ? `Student membership status is "${studentRow.status}".`
          : membershipExpired
            ? `Library membership ID (${latestCard?.cardNumber}) is ${latestCard?.status === 'active' ? 'expired' : latestCard?.status}. Renew ID card first.`
            : overdueLoansCount > 0
              ? `Student has ${overdueLoansCount} overdue book(s). Return overdue items before issuing new books.`
              : activeLoans.length >= maxBooks
                ? `Borrowing limit reached (${activeLoans.length}/${maxBooks} active loans).`
                : outstandingFine > maxFineAllowed
                  ? `Outstanding fines (${outstandingFine.toFixed(2)}) exceed borrowing threshold (${maxFineAllowed.toFixed(2)}).`
                  : null;

      const eligible = blockReason === null;
      const linkedFounder = linkedFounderRows[0];

      res.json({
        student: {
          ...studentRow,
          courseName: courseRow[0]?.name || null,
          semesterName: semRow[0]?.name || null,
          sessionName: sessRow[0]?.name || null,
        },
        scannedVia,
        founderBadge: linkedFounder
          ? {
              founderNumber: linkedFounder.founderNumber,
              designation: linkedFounder.designation,
              editionName: linkedFounder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
              organizationLabel: linkedFounder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
              verifiedCreator: true,
            }
          : null,
        eligibility: {
          eligible,
          activeLoansCount: activeLoans.length,
          overdueLoansCount,
          maxBooksAllowed: maxBooks,
          loanDurationDays: loanDays,
          outstandingFine: Number(outstandingFine.toFixed(2)),
          maxFineAllowed,
          blockReason,
        },
      });
    } catch (error) {
      console.error('Resolve student failed:', error);
      res.status(500).json({ error: 'Unable to verify student eligibility.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/circulation/issue',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        studentId: z.string().uuid(),
        bookCopyId: z.string().uuid().optional(),
        barcode: z.string().optional(),
        isbn: z.string().optional(),
        notes: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success || (!parsed.data.bookCopyId && !parsed.data.barcode && !parsed.data.isbn)) {
        return res.status(400).json({ error: 'Student and physical book copy (ID, barcode, or ISBN) are required.' });
      }
      const orgId = req.orgId!;
      const d = parsed.data;

      const result = await db.transaction(async (tx) => {
        const [student] = await tx
          .select()
          .from(students)
          .where(and(eq(students.id, d.studentId), eq(students.organizationId, orgId)))
          .limit(1);
        if (!student) throw new Error('Student not found in this institution.');
        if (student.status !== 'active') {
          throw new Error(`Cannot issue books: student account status is "${student.status}".`);
        }

        let copy = d.bookCopyId
          ? (
              await tx
                .select()
                .from(bookCopies)
                .where(and(eq(bookCopies.organizationId, orgId), eq(bookCopies.id, d.bookCopyId)))
                .limit(1)
            )[0]
          : undefined;

        if (!copy && d.barcode?.trim()) {
          const code = d.barcode.trim();
          copy = (
            await tx
              .select()
              .from(bookCopies)
              .where(
                and(
                  eq(bookCopies.organizationId, orgId),
                  or(
                    ilike(bookCopies.barcode, code),
                    ilike(bookCopies.accessionNumber, code),
                    ilike(bookCopies.qrCodeValue, code)
                  )
                )
              )
              .limit(1)
          )[0];
        }

        // Fallback: resolve an available physical copy by normalized ISBN
        const isbnInput = d.isbn?.trim() || (!copy ? d.barcode?.trim() : '');
        if (!copy && isbnInput) {
          const candidates = getIsbnLookupCandidates(isbnInput);
          if (candidates.length > 0) {
            const isbnBooks = await tx
              .select({ id: books.id })
              .from(books)
              .where(
                and(
                  eq(books.organizationId, orgId),
                  eq(books.status, 'active'),
                  sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) IN (${sql.join(
                    candidates.map((c) => sql`${c}`),
                    sql`, `
                  )})`
                )
              );
            if (isbnBooks.length > 0) {
              const allCopies = await tx
                .select()
                .from(bookCopies)
                .where(
                  and(
                    eq(bookCopies.organizationId, orgId),
                    inArray(bookCopies.bookId, isbnBooks.map((b) => b.id))
                  )
                )
                .orderBy(asc(bookCopies.barcode));
              copy = allCopies.find((c) => c.status === 'available') || allCopies[0];
            }
          }
        }

        if (!copy) throw new Error('Physical book copy not found for the given barcode or ISBN.');

        // Check if reserved specifically for this student
        const [matchingReadyRes] = await tx
          .select()
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, orgId),
              eq(reservations.studentId, student.id),
              eq(reservations.bookId, copy.bookId),
              eq(reservations.status, 'ready')
            )
          )
          .limit(1);

        const canIssueReserved = copy.status === 'reserved' && Boolean(matchingReadyRes);
        if (copy.status !== 'available' && !canIssueReserved) {
          throw new Error(`Physical copy (${copy.barcode}) is currently "${copy.status}" and cannot be issued.`);
        }

        const [settings] = await tx
          .select()
          .from(librarySettings)
          .where(eq(librarySettings.organizationId, orgId))
          .limit(1);
        const [cat] = student.studentCategoryId
          ? await tx.select().from(studentCategories).where(eq(studentCategories.id, student.studentCategoryId)).limit(1)
          : [];

        const maxBooks = cat?.maxBooksAllowed ?? settings?.maxBooksPerStudent ?? 4;
        const loanDays = cat?.loanDurationDays ?? settings?.defaultLoanDays ?? 14;
        const maxFineAllowed = Number(settings?.maxOutstandingFineForBorrow ?? 100);

        const latestCards = await tx
          .select()
          .from(idCards)
          .where(and(eq(idCards.studentId, student.id), eq(idCards.organizationId, orgId)))
          .orderBy(desc(idCards.createdAt))
          .limit(1);
        const latestCard = latestCards[0];
        if (
          latestCard &&
          (latestCard.status === 'expired' ||
            latestCard.status === 'blocked' ||
            latestCard.status === 'suspended' ||
            new Date(latestCard.expiresAt) < new Date())
        ) {
          throw new Error(
            `Cannot issue books: student's Digital Library ID (${latestCard.cardNumber}) is ${latestCard.status === 'active' ? 'expired' : latestCard.status}.`
          );
        }

        const activeLoans = await tx
          .select({ id: loans.id, bookId: loans.bookId, dueAt: loans.dueAt })
          .from(loans)
          .where(
            and(
              eq(loans.studentId, student.id),
              eq(loans.organizationId, orgId),
              or(eq(loans.status, 'active'), eq(loans.status, 'overdue'))
            )
          );

        const now = new Date();
        const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
        if (overdueLoans.length > 0) {
          throw new Error(
            `Cannot issue new books: student has ${overdueLoans.length} overdue loan(s) that must be returned first.`
          );
        }

        const duplicateTitleLoan = activeLoans.find((l) => l.bookId === copy.bookId);
        if (duplicateTitleLoan) {
          throw new Error(
            'Duplicate active loan blocked: this student already has an active copy of this book title checked out.'
          );
        }

        if (activeLoans.length >= maxBooks) {
          throw new Error(`Borrowing limit reached (${activeLoans.length}/${maxBooks} books already issued).`);
        }

        const unpaidFines = await tx
          .select()
          .from(fines)
          .where(
            and(
              eq(fines.studentId, student.id),
              eq(fines.organizationId, orgId),
              inArray(fines.status, ['unpaid', 'partial', 'waiver_requested'])
            )
          );
        const outstanding = unpaidFines.reduce(
          (sum, f) => sum + Math.max(0, Number(f.amount) - Number(f.paidAmount) - Number(f.waivedAmount)),
          0
        );
        if (outstanding > maxFineAllowed) {
          throw new Error(
            `Student has outstanding fines of ${settings?.currencySymbol || '₹'}${outstanding.toFixed(2)}, exceeding the limit of ${maxFineAllowed.toFixed(2)}.`
          );
        }

        // Atomic conditional update prevents double-issuing the same physical copy concurrently!
        const updatedCopies = await tx
          .update(bookCopies)
          .set({ status: 'issued', updatedAt: new Date() })
          .where(
            and(
              eq(bookCopies.id, copy.id),
              eq(bookCopies.organizationId, orgId),
              eq(bookCopies.status, copy.status)
            )
          )
          .returning();

        if (updatedCopies.length === 0) {
          throw new Error('This copy was just issued by another staff member. Please scan another copy.');
        }

        const issuedAt = new Date();
        const dueAt = new Date(issuedAt);
        dueAt.setDate(dueAt.getDate() + loanDays);
        const receiptNumber = `ISS-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

        const [loan] = await tx
          .insert(loans)
          .values({
            organizationId: orgId,
            bookCopyId: copy.id,
            bookId: copy.bookId,
            studentId: student.id,
            issuedByProfileId: req.profile!.id,
            issuedAt,
            dueAt,
            status: 'active',
            receiptNumber,
            notes: d.notes?.trim() || null,
          })
          .returning();

        if (matchingReadyRes) {
          await tx
            .update(reservations)
            .set({ status: 'fulfilled', fulfilledAt: new Date(), updatedAt: new Date() })
            .where(eq(reservations.id, matchingReadyRes.id));
        }

        const [book] = await tx.select().from(books).where(eq(books.id, copy.bookId)).limit(1);

        return { loan, copy: updatedCopies[0], student, book };
      });

      if (result.student.profileId) {
        await createNotification({
          organizationId: orgId,
          recipientProfileId: result.student.profileId,
          type: 'book_issued',
          title: 'Book Issued — Digital Receipt',
          message: `"${result.book?.title}" (${result.copy.barcode}) issued. Due on ${new Date(result.loan.dueAt).toLocaleDateString()}. Receipt: ${result.loan.receiptNumber}`,
          entityType: 'loan',
          entityId: result.loan.id,
        });
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_issued',
        entityType: 'loan',
        entityId: result.loan.id,
        details: {
          receiptNumber: result.loan.receiptNumber,
          barcode: result.copy.barcode,
          studentIdCode: result.student.studentIdCode,
          dueAt: result.loan.dueAt,
        },
      });

      res.status(201).json({
        loan: result.loan,
        receipt: {
          receiptNumber: result.loan.receiptNumber,
          issuedAt: result.loan.issuedAt,
          dueAt: result.loan.dueAt,
          bookTitle: result.book?.title,
          barcode: result.copy.barcode,
          studentName: result.student.fullName,
          studentIdCode: result.student.studentIdCode,
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unable to issue book.';
      res.status(400).json({ error: msg });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/circulation/return',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        loanId: z.string().uuid().optional(),
        barcode: z.string().optional(),
        returnCondition: z.enum(['new', 'good', 'fair', 'poor', 'damaged', 'lost']).default('good'),
        damageDescription: z.string().optional().nullable(),
        damageFineAmount: z.coerce.number().min(0).optional().default(0),
        notes: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success || (!parsed.data.loanId && !parsed.data.barcode)) {
        return res.status(400).json({ error: 'Loan ID or physical book barcode is required.' });
      }
      const orgId = req.orgId!;
      const d = parsed.data;

      const result = await db.transaction(async (tx) => {
        let activeLoan;
        if (d.loanId) {
          [activeLoan] = await tx
            .select()
            .from(loans)
            .where(
              and(
                eq(loans.id, d.loanId),
                eq(loans.organizationId, orgId),
                ne(loans.status, 'returned')
              )
            )
            .limit(1);
        } else {
          const [copy] = await tx
            .select()
            .from(bookCopies)
            .where(and(eq(bookCopies.barcode, d.barcode!.trim()), eq(bookCopies.organizationId, orgId)))
            .limit(1);
          if (!copy) throw new Error(`Book copy "${d.barcode}" not found.`);
          [activeLoan] = await tx
            .select()
            .from(loans)
            .where(
              and(
                eq(loans.bookCopyId, copy.id),
                eq(loans.organizationId, orgId),
                ne(loans.status, 'returned')
              )
            )
            .limit(1);
        }

        if (!activeLoan) throw new Error('No active loan found for this book copy.');

        const [settings] = await tx
          .select()
          .from(librarySettings)
          .where(eq(librarySettings.organizationId, orgId))
          .limit(1);
        const [student] = await tx.select().from(students).where(eq(students.id, activeLoan.studentId)).limit(1);
        const [book] = await tx.select().from(books).where(eq(books.id, activeLoan.bookId)).limit(1);
        const [copy] = await tx.select().from(bookCopies).where(eq(bookCopies.id, activeLoan.bookCopyId)).limit(1);

        const returnedAt = new Date();
        const dueDate = new Date(activeLoan.dueAt);
        const overdueMs = returnedAt.getTime() - dueDate.getTime();
        const overdueDays = overdueMs > 0 ? Math.ceil(overdueMs / (1000 * 60 * 60 * 24)) : 0;
        const finePerDay = Number(settings?.overdueFinePerDay ?? 5);
        const overdueFineAmount = overdueDays * finePerDay;

        let createdFine = null;
        if (overdueFineAmount > 0) {
          [createdFine] = await tx
            .insert(fines)
            .values({
              organizationId: orgId,
              studentId: activeLoan.studentId,
              loanId: activeLoan.id,
              amount: overdueFineAmount.toFixed(2),
              reason: `Overdue return (${overdueDays} day(s) late @ ${settings?.currencySymbol || '₹'}${finePerDay}/day)`,
              status: 'unpaid',
              createdByProfileId: req.profile!.id,
            })
            .returning();
        }

        if (d.returnCondition === 'damaged' || d.returnCondition === 'lost') {
          await tx.insert(damageReports).values({
            organizationId: orgId,
            bookCopyId: activeLoan.bookCopyId,
            loanId: activeLoan.id,
            studentId: activeLoan.studentId,
            severity: d.returnCondition === 'lost' ? 'lost' : 'moderate',
            description: d.damageDescription?.trim() || `Returned in ${d.returnCondition} condition.`,
            assessedFine: d.damageFineAmount.toFixed(2),
            reportedByProfileId: req.profile!.id,
            status: 'open',
          });

          if (d.damageFineAmount > 0) {
            await tx.insert(fines).values({
              organizationId: orgId,
              studentId: activeLoan.studentId,
              loanId: activeLoan.id,
              amount: d.damageFineAmount.toFixed(2),
              reason: `Book ${d.returnCondition} assessment: ${d.damageDescription?.trim() || book?.title}`,
              status: 'unpaid',
              createdByProfileId: req.profile!.id,
            });
          }
        }

        // Check reservation queue if copy is reusable
        let nextCopyStatus: string =
          d.returnCondition === 'lost'
            ? 'lost'
            : d.returnCondition === 'damaged'
              ? 'damaged'
              : 'available';

        let promotedReservation: { studentProfileId: string | null; reservationId: string } | null = null;
        if (nextCopyStatus === 'available') {
          const [nextRes] = await tx
            .select()
            .from(reservations)
            .where(
              and(
                eq(reservations.organizationId, orgId),
                eq(reservations.bookId, activeLoan.bookId),
                eq(reservations.status, 'queued')
              )
            )
            .orderBy(asc(reservations.queuePosition), asc(reservations.createdAt))
            .limit(1);

          if (nextRes) {
            const holdDays = settings?.reservationHoldDays ?? 3;
            const holdUntil = new Date();
            holdUntil.setDate(holdUntil.getDate() + holdDays);
            await tx
              .update(reservations)
              .set({
                status: 'ready',
                assignedCopyId: activeLoan.bookCopyId,
                notifiedAt: new Date(),
                expiresAt: holdUntil,
                updatedAt: new Date(),
              })
              .where(eq(reservations.id, nextRes.id));
            nextCopyStatus = 'reserved';

            const [resStudent] = await tx
              .select({ profileId: students.profileId })
              .from(students)
              .where(eq(students.id, nextRes.studentId))
              .limit(1);
            promotedReservation = {
              studentProfileId: resStudent?.profileId || null,
              reservationId: nextRes.id,
            };
          }
        }

        const [closedLoan] = await tx
          .update(loans)
          .set({
            status: d.returnCondition === 'lost' ? 'lost' : 'returned',
            returnedAt,
            returnedToProfileId: req.profile!.id,
            returnCondition: d.returnCondition,
            notes: d.notes || activeLoan.notes,
            updatedAt: new Date(),
          })
          .where(eq(loans.id, activeLoan.id))
          .returning();

        await tx
          .update(bookCopies)
          .set({
            status: nextCopyStatus,
            condition: d.returnCondition === 'lost' ? 'damaged' : d.returnCondition,
            updatedAt: new Date(),
          })
          .where(eq(bookCopies.id, activeLoan.bookCopyId));

        return {
          closedLoan,
          overdueDays,
          overdueFineAmount,
          createdFine,
          student,
          book,
          copy,
          promotedReservation,
          nextCopyStatus,
        };
      });

      if (result.student?.profileId) {
        await createNotification({
          organizationId: orgId,
          recipientProfileId: result.student.profileId,
          type: 'book_returned',
          title: 'Book Returned — Receipt Confirmed',
          message: `"${result.book?.title}" (${result.copy?.barcode}) returned.${result.overdueFineAmount > 0 ? ` Overdue fine generated: ${result.overdueFineAmount.toFixed(2)}.` : ''}`,
          entityType: 'loan',
          entityId: result.closedLoan.id,
        });
      }

      if (result.promotedReservation?.studentProfileId) {
        await createNotification({
          organizationId: orgId,
          recipientProfileId: result.promotedReservation.studentProfileId,
          type: 'reservation_available',
          title: 'Reserved Book Available for Pickup',
          message: `"${result.book?.title}" is now held for you at the circulation desk. Please collect it before the hold window expires.`,
          entityType: 'reservation',
          entityId: result.promotedReservation.reservationId,
        });
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_returned',
        entityType: 'loan',
        entityId: result.closedLoan.id,
        details: {
          barcode: result.copy?.barcode,
          returnCondition: d.returnCondition,
          overdueDays: result.overdueDays,
          overdueFineAmount: result.overdueFineAmount,
          nextCopyStatus: result.nextCopyStatus,
        },
      });

      res.json({
        loan: result.closedLoan,
        overdueDays: result.overdueDays,
        overdueFineAmount: result.overdueFineAmount,
        nextCopyStatus: result.nextCopyStatus,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unable to process book return.';
      res.status(400).json({ error: msg });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/circulation/renew',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const loanId = req.body?.loanId;
      if (!loanId) return res.status(400).json({ error: 'loanId is required.' });
      const orgId = req.orgId!;

      const result = await db.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(loans)
          .where(and(eq(loans.id, loanId), eq(loans.organizationId, orgId)))
          .limit(1);
        if (!loan || loan.status === 'returned') {
          throw new Error('Active loan not found.');
        }

        const [settings] = await tx
          .select()
          .from(librarySettings)
          .where(eq(librarySettings.organizationId, orgId))
          .limit(1);
        const [student] = await tx.select().from(students).where(eq(students.id, loan.studentId)).limit(1);

        if (!student || student.status !== 'active') {
          throw new Error('Student is not eligible for book renewal.');
        }

        const maxRenewals = settings?.maxRenewals ?? 2;
        if (loan.renewalCount >= maxRenewals) {
          throw new Error(`Maximum renewal limit reached (${loan.renewalCount}/${maxRenewals}).`);
        }

        const isOverdue = new Date(loan.dueAt) < new Date();
        if (isOverdue && !settings?.allowRenewalWhenOverdue) {
          throw new Error('Library rules prohibit renewing overdue books. Process return and settle fines.');
        }

        const activeRes = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, orgId),
              eq(reservations.bookId, loan.bookId),
              eq(reservations.status, 'queued')
            )
          )
          .limit(1);
        if (activeRes.length > 0 && !settings?.allowRenewalWhenReserved) {
          throw new Error('Renewal blocked: another student is waiting in the reservation queue for this title.');
        }

        const extensionDays = settings?.renewalExtensionDays ?? 7;
        const previousDueAt = new Date(loan.dueAt);
        const newDueAt = new Date(Math.max(previousDueAt.getTime(), Date.now()));
        newDueAt.setDate(newDueAt.getDate() + extensionDays);
        const nextRenewalNum = loan.renewalCount + 1;

        const [updatedLoan] = await tx
          .update(loans)
          .set({
            dueAt: newDueAt,
            renewalCount: nextRenewalNum,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(loans.id, loan.id))
          .returning();

        await tx.insert(renewals).values({
          organizationId: orgId,
          loanId: loan.id,
          renewedByProfileId: req.profile!.id,
          previousDueAt,
          newDueAt,
          renewalNumber: nextRenewalNum,
        });

        return { updatedLoan, previousDueAt, newDueAt };
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'book_renewed',
        entityType: 'loan',
        entityId: result.updatedLoan.id,
        details: { previousDueAt: result.previousDueAt, newDueAt: result.newDueAt },
      });

      res.json({ loan: result.updatedLoan });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unable to renew loan.';
      res.status(400).json({ error: msg });
    }
  }
);

// ============================================================================
// RESERVATION QUEUE SYSTEM
// ============================================================================

booksAndCirculationRouter.get(
  '/org/reservations',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select({
          reservation: reservations,
          bookTitle: books.title,
          bookIsbn: books.isbn,
          studentName: students.fullName,
          studentIdCode: students.studentIdCode,
          rollNumber: students.collegeRollNumber,
        })
        .from(reservations)
        .innerJoin(books, eq(reservations.bookId, books.id))
        .innerJoin(students, eq(reservations.studentId, students.id))
        .where(eq(reservations.organizationId, req.orgId!))
        .orderBy(asc(reservations.queuePosition), desc(reservations.createdAt));

      res.json({
        reservations: rows.map((r) => ({
          ...r.reservation,
          bookTitle: r.bookTitle,
          bookIsbn: r.bookIsbn,
          studentName: r.studentName,
          studentIdCode: r.studentIdCode,
          rollNumber: r.rollNumber,
        })),
      });
    } catch (error) {
      console.error('List reservations failed:', error);
      res.status(500).json({ error: 'Unable to load reservations.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/reservations',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const bookId = req.body?.bookId;
      if (!bookId) return res.status(400).json({ error: 'bookId is required.' });

      let studentId = req.body?.studentId;
      if (req.orgRole === 'student') {
        const [self] = await db
          .select()
          .from(students)
          .where(and(eq(students.organizationId, orgId), eq(students.profileId, req.profile!.id)))
          .limit(1);
        if (!self) return res.status(404).json({ error: 'Student profile not found.' });
        if (self.status !== 'active') {
          return res.status(403).json({ error: 'Only active students can reserve books.' });
        }
        studentId = self.id;
      }
      if (!studentId) return res.status(400).json({ error: 'studentId is required.' });

      const existing = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, orgId),
            eq(reservations.bookId, bookId),
            eq(reservations.studentId, studentId),
            inArray(reservations.status, ['queued', 'ready'])
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: 'An active reservation for this title already exists.' });
      }

      const queueRows = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, orgId),
            eq(reservations.bookId, bookId),
            inArray(reservations.status, ['queued', 'ready'])
          )
        );

      const [created] = await db
        .insert(reservations)
        .values({
          organizationId: orgId,
          bookId,
          studentId,
          queuePosition: queueRows.length + 1,
          status: 'queued',
        })
        .returning();

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'reservation_created',
        entityType: 'reservation',
        entityId: created.id,
        details: { bookId, studentId, queuePosition: created.queuePosition },
      });

      res.status(201).json({ reservation: created });
    } catch (error) {
      console.error('Create reservation failed:', error);
      res.status(500).json({ error: 'Unable to create reservation.' });
    }
  }
);

booksAndCirculationRouter.patch(
  '/org/reservations/:id/status',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const nextStatus = req.body?.status as string;
      if (!['ready', 'fulfilled', 'cancelled', 'expired'].includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid reservation status.' });
      }

      const orgId = req.orgId!;
      const [existing] = await db
        .select()
        .from(reservations)
        .where(and(eq(reservations.id, req.params.id), eq(reservations.organizationId, orgId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Reservation not found.' });

      if (req.orgRole === 'student') {
        const [self] = await db
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.organizationId, orgId), eq(students.profileId, req.profile!.id)))
          .limit(1);
        if (!self || existing.studentId !== self.id || nextStatus !== 'cancelled') {
          return res.status(403).json({ error: 'Students may only cancel their own reservations.' });
        }
      }

      const [settings] = await db
        .select()
        .from(librarySettings)
        .where(eq(librarySettings.organizationId, orgId))
        .limit(1);

      const expiresAt =
        nextStatus === 'ready'
          ? new Date(Date.now() + (settings?.reservationHoldDays ?? 3) * 86400000)
          : existing.expiresAt;

      const [updated] = await db
        .update(reservations)
        .set({
          status: nextStatus,
          notifiedAt: nextStatus === 'ready' ? new Date() : existing.notifiedAt,
          expiresAt,
          fulfilledAt: nextStatus === 'fulfilled' ? new Date() : existing.fulfilledAt,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, existing.id))
        .returning();

      if (nextStatus === 'ready') {
        const [stu] = await db.select().from(students).where(eq(students.id, existing.studentId)).limit(1);
        const [bk] = await db.select().from(books).where(eq(books.id, existing.bookId)).limit(1);
        if (stu?.profileId) {
          await createNotification({
            organizationId: orgId,
            recipientProfileId: stu.profileId,
            type: 'reservation_available',
            title: 'Book Ready for Pickup',
            message: `Your reserved copy of "${bk?.title}" is ready at the library desk until ${expiresAt?.toLocaleDateString()}.`,
            entityType: 'reservation',
            entityId: updated.id,
          });
        }
      }

      res.json({ reservation: updated });
    } catch (error) {
      console.error('Update reservation status failed:', error);
      res.status(500).json({ error: 'Unable to update reservation.' });
    }
  }
);

// ============================================================================
// LIBRARY FINES & OPERATIONAL PAYMENTS
// ============================================================================

booksAndCirculationRouter.get(
  '/org/fines',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [fineRows, paymentRows] = await Promise.all([
        db
          .select({
            fine: fines,
            studentName: students.fullName,
            studentIdCode: students.studentIdCode,
            rollNumber: students.collegeRollNumber,
          })
          .from(fines)
          .innerJoin(students, eq(fines.studentId, students.id))
          .where(eq(fines.organizationId, orgId))
          .orderBy(desc(fines.createdAt)),
        db
          .select({
            payment: payments,
            studentName: students.fullName,
          })
          .from(payments)
          .innerJoin(students, eq(payments.studentId, students.id))
          .where(eq(payments.organizationId, orgId))
          .orderBy(desc(payments.paidAt))
          .limit(100),
      ]);

      res.json({
        fines: fineRows.map((r) => ({
          ...r.fine,
          studentName: r.studentName,
          studentIdCode: r.studentIdCode,
          rollNumber: r.rollNumber,
          balance: Math.max(
            0,
            Number(r.fine.amount) - Number(r.fine.paidAmount) - Number(r.fine.waivedAmount)
          ),
        })),
        payments: paymentRows.map((p) => ({
          ...p.payment,
          studentName: p.studentName,
        })),
      });
    } catch (error) {
      console.error('List fines failed:', error);
      res.status(500).json({ error: 'Unable to load fines.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/fines',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        studentId: z.string().uuid(),
        amount: z.coerce.number().positive(),
        reason: z.string().min(3),
        loanId: z.string().uuid().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Student, positive amount, and reason required.' });

      const [fine] = await db
        .insert(fines)
        .values({
          organizationId: req.orgId!,
          studentId: parsed.data.studentId,
          loanId: parsed.data.loanId || null,
          amount: parsed.data.amount.toFixed(2),
          reason: parsed.data.reason.trim(),
          status: 'unpaid',
          createdByProfileId: req.profile!.id,
        })
        .returning();

      const [stu] = await db.select().from(students).where(eq(students.id, parsed.data.studentId)).limit(1);
      if (stu?.profileId) {
        await createNotification({
          organizationId: req.orgId!,
          recipientProfileId: stu.profileId,
          type: 'fine_generated',
          title: 'Library Fine Recorded',
          message: `A library fine of ${parsed.data.amount.toFixed(2)} was recorded. Reason: ${parsed.data.reason.trim()}`,
          entityType: 'fine',
          entityId: fine.id,
        });
      }

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'fine_created',
        entityType: 'fine',
        entityId: fine.id,
        details: parsed.data,
      });

      res.status(201).json({ fine });
    } catch (error) {
      console.error('Create fine failed:', error);
      res.status(500).json({ error: 'Unable to record fine.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/fines/:id/pay',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        amount: z.coerce.number().positive(),
        paymentMethod: z.enum(['cash', 'card_counter', 'bank_transfer', 'upi_counter']).default('cash'),
        referenceNote: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Valid payment amount and counter method required.' });

      const orgId = req.orgId!;
      const [fine] = await db
        .select()
        .from(fines)
        .where(and(eq(fines.id, req.params.id), eq(fines.organizationId, orgId)))
        .limit(1);
      if (!fine) return res.status(404).json({ error: 'Fine record not found.' });

      const remaining = Math.max(
        0,
        Number(fine.amount) - Number(fine.paidAmount) - Number(fine.waivedAmount)
      );
      if (parsed.data.amount > remaining + 0.01) {
        return res.status(400).json({ error: `Payment exceeds remaining balance (${remaining.toFixed(2)}).` });
      }

      const newPaid = Number(fine.paidAmount) + parsed.data.amount;
      const newRemaining = Number(fine.amount) - newPaid - Number(fine.waivedAmount);
      const nextStatus = newRemaining <= 0.01 ? 'paid' : 'partial';
      const receiptNumber = `FIN-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

      const [payment] = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(payments)
          .values({
            organizationId: orgId,
            fineId: fine.id,
            studentId: fine.studentId,
            amount: parsed.data.amount.toFixed(2),
            paymentMethod: parsed.data.paymentMethod,
            receiptNumber,
            referenceNote: parsed.data.referenceNote?.trim() || null,
            recordedByProfileId: req.profile!.id,
          })
          .returning();

        await tx
          .update(fines)
          .set({
            paidAmount: newPaid.toFixed(2),
            status: nextStatus,
            updatedAt: new Date(),
          })
          .where(eq(fines.id, fine.id));

        return [p];
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'fine_payment_recorded',
        entityType: 'payment',
        entityId: payment.id,
        details: {
          fineId: fine.id,
          amount: parsed.data.amount,
          paymentMethod: parsed.data.paymentMethod,
          receiptNumber,
        },
      });

      res.status(201).json({ payment });
    } catch (error) {
      console.error('Record fine payment failed:', error);
      res.status(500).json({ error: 'Unable to record fine payment.' });
    }
  }
);

booksAndCirculationRouter.post(
  '/org/fines/:id/waive',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 3
        ? req.body.reason.trim()
        : null;
      if (!reason) return res.status(400).json({ error: 'Waiver reason (min 3 characters) is required.' });

      const orgId = req.orgId!;
      const [fine] = await db
        .select()
        .from(fines)
        .where(and(eq(fines.id, req.params.id), eq(fines.organizationId, orgId)))
        .limit(1);
      if (!fine) return res.status(404).json({ error: 'Fine not found.' });

      if (req.orgRole === 'librarian') {
        // Librarians request waiver; College Admin approves
        const [updated] = await db
          .update(fines)
          .set({
            status: 'waiver_requested',
            waiverReason: reason,
            waiverRequestedByProfileId: req.profile!.id,
            updatedAt: new Date(),
          })
          .where(eq(fines.id, fine.id))
          .returning();

        await logAudit({
          organizationId: orgId,
          actorProfile: req.profile,
          actorRole: req.orgRole,
          action: 'fine_waiver_requested',
          entityType: 'fine',
          entityId: fine.id,
          details: { reason },
        });
        return res.json({ fine: updated, message: 'Waiver request submitted for College Admin approval.' });
      }

      // College Admin approves waiver directly
      const remaining = Math.max(0, Number(fine.amount) - Number(fine.paidAmount));
      const [updated] = await db
        .update(fines)
        .set({
          waivedAmount: remaining.toFixed(2),
          status: 'waived',
          waiverReason: reason,
          waiverApprovedByProfileId: req.profile!.id,
          updatedAt: new Date(),
        })
        .where(eq(fines.id, fine.id))
        .returning();

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'fine_waiver_approved',
        entityType: 'fine',
        entityId: fine.id,
        details: { waivedAmount: remaining, reason },
      });

      res.json({ fine: updated, message: 'Fine waived and logged in audit trail.' });
    } catch (error) {
      console.error('Waive fine failed:', error);
      res.status(500).json({ error: 'Unable to process waiver.' });
    }
  }
);

// ============================================================================
// ATTENDANCE CHECK-IN (Basic Part 1 support, extensible for Part 2 QR gate)
// ============================================================================

booksAndCirculationRouter.post(
  '/org/attendance/check-in',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const studentId = req.body?.studentId;
      if (!studentId) return res.status(400).json({ error: 'studentId required.' });
      const [entry] = await db
        .insert(attendance)
        .values({
          organizationId: req.orgId!,
          studentId,
          method: req.body?.method === 'manual' ? 'manual' : 'qr',
          recordedByProfileId: req.profile!.id,
          notes: req.body?.notes || null,
        })
        .returning();
      res.status(201).json({ attendance: entry });
    } catch (error) {
      console.error('Attendance check-in failed:', error);
      res.status(500).json({ error: 'Unable to record attendance.' });
    }
  }
);

// ============================================================================
// STUDENT SELF-SERVICE PORTAL (Strictly Own Records ONLY)
// ============================================================================

booksAndCirculationRouter.get(
  '/student/dashboard',
  requireAuth,
  requireOrgRole(['student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [student] = await db
        .select()
        .from(students)
        .where(and(eq(students.organizationId, orgId), eq(students.profileId, req.profile!.id)))
        .limit(1);

      if (!student) {
        return res.status(404).json({ error: 'Student membership record not found for this institution.' });
      }

      const [
        courseRow,
        semRow,
        sessRow,
        brandingRow,
        settingsRow,
        catRow,
        cardRows,
        linkedFounderRows,
        myLoans,
        myReservations,
        myFines,
        myAttendance,
      ] = await Promise.all([
        student.courseId ? db.select().from(courses).where(eq(courses.id, student.courseId)).limit(1) : Promise.resolve([]),
        student.semesterId ? db.select().from(semesters).where(eq(semesters.id, student.semesterId)).limit(1) : Promise.resolve([]),
        student.academicSessionId ? db.select().from(academicSessions).where(eq(academicSessions.id, student.academicSessionId)).limit(1) : Promise.resolve([]),
        db.select().from(organizationBranding).where(eq(organizationBranding.organizationId, orgId)).limit(1),
        db.select().from(librarySettings).where(eq(librarySettings.organizationId, orgId)).limit(1),
        student.studentCategoryId ? db.select().from(studentCategories).where(eq(studentCategories.id, student.studentCategoryId)).limit(1) : Promise.resolve([]),
        db
          .select({
            card: idCards,
            template: idTemplates,
            qrToken: qrTokens.token,
          })
          .from(idCards)
          .innerJoin(idTemplates, eq(idCards.templateId, idTemplates.id))
          .leftJoin(
            qrTokens,
            and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, idCards.id))
          )
          .where(and(eq(idCards.studentId, student.id), eq(idCards.organizationId, orgId)))
          .orderBy(desc(idCards.createdAt))
          .limit(1),
        db
          .select({
            founder: founderIdentities,
            qrToken: qrTokens.token,
          })
          .from(founderIdentities)
          .leftJoin(qrTokens, eq(founderIdentities.qrTokenId, qrTokens.id))
          .where(
            and(
              eq(founderIdentities.linkedStudentId, student.id),
              eq(founderIdentities.linkedOrganizationId, orgId),
              eq(founderIdentities.status, 'active')
            )
          )
          .limit(1),
        db
          .select({
            loan: loans,
            bookTitle: books.title,
            bookIsbn: books.isbn,
            coverImageUrl: books.coverImageUrl,
            barcode: bookCopies.barcode,
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .innerJoin(bookCopies, eq(loans.bookCopyId, bookCopies.id))
          .where(and(eq(loans.studentId, student.id), eq(loans.organizationId, orgId)))
          .orderBy(desc(loans.issuedAt)),
        db
          .select({
            reservation: reservations,
            bookTitle: books.title,
            bookIsbn: books.isbn,
          })
          .from(reservations)
          .innerJoin(books, eq(reservations.bookId, books.id))
          .where(and(eq(reservations.studentId, student.id), eq(reservations.organizationId, orgId)))
          .orderBy(desc(reservations.createdAt)),
        db
          .select()
          .from(fines)
          .where(and(eq(fines.studentId, student.id), eq(fines.organizationId, orgId)))
          .orderBy(desc(fines.createdAt)),
        db
          .select()
          .from(attendance)
          .where(and(eq(attendance.studentId, student.id), eq(attendance.organizationId, orgId)))
          .orderBy(desc(attendance.checkInAt))
          .limit(30),
      ]);

      const now = new Date();
      const activeLoans = myLoans.filter((l) => l.loan.status !== 'returned');
      const overdueLoans = activeLoans.filter((l) => new Date(l.loan.dueAt) < now);
      const upcomingDue = activeLoans
        .filter((l) => new Date(l.loan.dueAt) >= now)
        .sort((a, b) => new Date(a.loan.dueAt).getTime() - new Date(b.loan.dueAt).getTime());

      const outstandingFinesTotal = myFines.reduce(
        (sum, f) => sum + Math.max(0, Number(f.amount) - Number(f.paidAmount) - Number(f.waivedAmount)),
        0
      );

      const maxBooksAllowed =
        catRow[0]?.maxBooksAllowed ?? settingsRow[0]?.maxBooksPerStudent ?? 4;

      const latestCard = cardRows[0]
        ? {
            ...cardRows[0].card,
            template: cardRows[0].template,
            qrToken: cardRows[0].qrToken,
          }
        : null;

      const linkedFounder = linkedFounderRows[0]
        ? {
            ...linkedFounderRows[0].founder,
            organizationLabel: linkedFounderRows[0].founder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
            editionName: linkedFounderRows[0].founder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
            qrToken: linkedFounderRows[0].qrToken,
            linkedCollege: {
              studentId: student.id,
              organizationId: orgId,
              collegeName: brandingRow[0]?.collegeName || 'Registered Institution',
              studentIdCode: student.studentIdCode,
              collegeRollNumber: student.collegeRollNumber,
              courseName: courseRow[0]?.name || null,
              semesterName: semRow[0]?.name || null,
              academicSession: sessRow[0]?.name || null,
              photoUrl: student.photoUrl,
              membershipStatus: student.status,
              collegeLinkStatus: linkedFounderRows[0].founder.collegeLinkStatus,
              collegeApprovedAt: linkedFounderRows[0].founder.collegeApprovedAt,
            },
          }
        : null;

      res.json({
        student: {
          ...student,
          courseName: courseRow[0]?.name || null,
          semesterName: semRow[0]?.name || null,
          sessionName: sessRow[0]?.name || null,
        },
        branding: brandingRow[0] || null,
        digitalId: latestCard,
        linkedFounderIdentity: linkedFounder,
        premiumStudent: student.isPremium
          ? {
              isPremium: true,
              premiumTier: student.premiumTier || 'obsidian_platinum',
              premiumDesign: student.premiumDesign || student.premiumTier || 'obsidian_platinum',
              premiumBadgeLabel: student.premiumBadgeLabel || 'PREMIUM SCHOLAR',
              premiumGrantedAt: student.premiumGrantedAt,
              premiumNote: student.premiumNote,
            }
          : null,
        summary: {
          currentlyIssuedCount: activeLoans.length,
          maxBooksAllowed,
          overdueCount: overdueLoans.length,
          upcomingDueCount: upcomingDue.length,
          nextDueDate: upcomingDue[0]?.loan.dueAt || null,
          outstandingFines: Number(outstandingFinesTotal.toFixed(2)),
          activeReservationsCount: myReservations.filter((r) =>
            ['queued', 'ready'].includes(r.reservation.status)
          ).length,
        },
        loans: myLoans.map((l) => ({
          ...l.loan,
          isOverdue: l.loan.status !== 'returned' && new Date(l.loan.dueAt) < now,
          bookTitle: l.bookTitle,
          bookIsbn: l.bookIsbn,
          coverImageUrl: l.coverImageUrl,
          barcode: l.barcode,
        })),
        reservations: myReservations.map((r) => ({
          ...r.reservation,
          bookTitle: r.bookTitle,
          bookIsbn: r.bookIsbn,
        })),
        fines: myFines.map((f) => ({
          ...f,
          balance: Math.max(0, Number(f.amount) - Number(f.paidAmount) - Number(f.waivedAmount)),
        })),
        attendance: myAttendance,
      });
    } catch (error) {
      console.error('Student dashboard failed:', error);
      res.status(500).json({ error: 'Unable to load student portal.' });
    }
  }
);

booksAndCirculationRouter.get(
  '/student/books',
  requireAuth,
  requireOrgRole(['student']),
  async (req: AuthRequest, res) => {
    try {
      const list = await listOrgBooksWithAvailability(req.orgId!, false);
      res.json({ books: list });
    } catch (error) {
      console.error('Student explore books failed:', error);
      res.status(500).json({ error: 'Unable to load library catalog.' });
    }
  }
);
