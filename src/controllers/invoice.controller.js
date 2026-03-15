import prisma from '../lib/prisma.js';
import { sendInvoiceEmail } from '../lib/mailer.js';
import { AppError } from '../middleware/error.middleware.js';
import { createInternalNotification } from './notification.controller.js';
import { getIO } from '../lib/socket.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Helper: generate invoice number ─────────────────────────────────────────
const generateInvoiceNumber = async () => {
    // Generate Invoice Number (Format: #001)
    const count = await prisma.invoice.count();
    const invoiceNumber = `#${(count + 1).toString().padStart(3, '0')}`;
    return invoiceNumber;
};

// ─── Helper: check for overdue invoices and create notifications ─────────────
const checkAndNotifyOverdueInvoices = async (userId) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 1. Mark as OVERDUE if OUTSTANDING and dueDate is before today start
        const overdueInvoices = await prisma.invoice.findMany({
            where: {
                status: 'OUTSTANDING',
                dueDate: { lt: todayStart }
            },
            include: { customer: true }
        });

        for (const inv of overdueInvoices) {
            await prisma.invoice.update({
                where: { id: inv.id },
                data: { status: 'OVERDUE' }
            });

            await createInternalNotification({
                userId,
                type: 'INVOICE_OVERDUE',
                title: 'Invoice overdue',
                body: `${inv.invoiceNumber} · ${inv.customer.companyName} — £${inv.total.toFixed(2)}`,
                invoiceId: inv.id
            });

            console.log(`[Notification] Overdue notification created for ${inv.invoiceNumber}`);
        }

        // 2. REVERT to OUTSTANDING if OVERDUE but dueDate is today or in the future
        // This fixes records incorrectly marked by the previous buggy logic
        await prisma.invoice.updateMany({
            where: {
                status: 'OVERDUE',
                dueDate: { gte: todayStart }
            },
            data: { status: 'OUTSTANDING' }
        });
    } catch (err) {
        console.error('[Notification] Error checking overdue invoices:', err);
    }
};

// ─── Helper: check and send email reminders ──────────────────────────────────
const checkAndSendReminders = async () => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Find OUTSTANDING/OVERDUE invoices that haven't had a reminder yet
        const invoices = await prisma.invoice.findMany({
            where: {
                status: { in: ['OUTSTANDING', 'OVERDUE'] },
                reminderSentAt: null,
                sentAt: { not: null },
            },
            include: { customer: true, items: true, user: true }
        });

        for (const inv of invoices) {
            const terms = inv.customer.paymentTerms || 'net_30';
            let shouldRemind = false;

            if (terms === 'payment_in_advance') continue;

            if (terms === 'due_on_receipt') {
                // Follow up 7 days after initial send
                if (new Date(inv.sentAt) < sevenDaysAgo) {
                    shouldRemind = true;
                }
            } else {
                // For Net 30, 14, etc - remind if past due date
                if (new Date(inv.dueDate) < now) {
                    shouldRemind = true;
                }
            }

            if (shouldRemind) {
                console.log(`[Reminders] Triggering reminder for ${inv.invoiceNumber}`);
                
                sendInvoiceEmail({
                    to: inv.customer.email,
                    customerName: inv.customer.companyName,
                    invoice: inv,
                    user: inv.user,
                    isReminder: true
                }).catch(err => {
                    console.error(`[Reminders Failed] Invoice ${inv.invoiceNumber}:`, err.message);
                });

                await prisma.invoice.update({
                    where: { id: inv.id },
                    data: { reminderSentAt: new Date() }
                });
            }
        }
    } catch (err) {
        console.error('[Reminders] Global error:', err);
    }
};

// GET /api/invoices
export const getInvoices = async (req, res, next) => {
    try {
        await checkAndNotifyOverdueInvoices(req.user.id);
        await checkAndSendReminders();
        const { status } = req.query;
        const invoices = await prisma.invoice.findMany({
            where: {
                ...(status && { status: status.toUpperCase() }),
            },
            include: { customer: { select: { companyName: true, email: true, address: true, city: true, postcode: true, isConsignment: true } }, items: true },
            orderBy: { createdAt: 'desc' },
        });
        console.log(`[Invoices] Fetching invoices for user: ${req.user.id}${status ? ` (Status: ${status})` : ''}`);
        res.json({ success: true, data: invoices });
    } catch (err) {
        next(err);
    }
};

// GET /api/invoices/:id
export const getInvoice = async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findFirst({
            where: { id: req.params.id },
            include: { customer: true, items: true },
        });
        if (!invoice) return next(new AppError('Invoice not found.', 404));
        res.json({ success: true, data: invoice });
    } catch (err) {
        next(err);
    }
};

// POST /api/invoices
export const createInvoice = async (req, res, next) => {
    try {
        const { customerId, items, dueDate, notes, tax, purchaseOrder } = req.body;

        if (!customerId || !items || !items.length) {
            return next(new AppError('Customer and at least one item are required.', 400));
        }

        const customer = await prisma.customer.findFirst({ where: { id: customerId } });
        if (!customer) return next(new AppError('Customer not found.', 404));

        const invoiceItems = items.map((item) => ({
            name: item.name,
            description: item.description || null,
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice),
            total: parseFloat(item.unitPrice) * item.quantity,
            productId: item.productId || null,
        }));

        const subtotal = invoiceItems.reduce((sum, i) => sum + i.total, 0);
        const taxAmount = parseFloat(tax || 0);
        const total = subtotal + taxAmount;
        const invoiceNumber = await generateInvoiceNumber();

        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber,
                purchaseOrder: purchaseOrder || null,
                userId: req.user.id,
                customerId,
                dueDate: new Date(dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
                notes,
                subtotal,
                tax: taxAmount,
                total,
                items: { create: invoiceItems },
            },
            include: { customer: true, items: true },
        });

        // ─── Upsert Custom Prices & Update Stock ───────────────────────────────
        const customPricePromises = [];
        const stockUpdatePromises = [];

        items.forEach((item) => {
            if (item.productId) {
                // Prepare custom price upsert
                customPricePromises.push(
                    prisma.customPrice.upsert({
                        where: {
                            customerId_productId: {
                                customerId,
                                productId: item.productId,
                            },
                        },
                        update: { price: parseFloat(item.unitPrice) },
                        create: {
                            price: parseFloat(item.unitPrice),
                            customerId,
                            productId: item.productId,
                            userId: req.user.id,
                        },
                    })
                );

                // Prepare stock deduction
                stockUpdatePromises.push(
                    prisma.product.update({
                        where: { id: item.productId },
                        data: {
                            stock: {
                                decrement: item.quantity
                            }
                        }
                    })
                );
            }
        });

        if (customPricePromises.length > 0) {
            await Promise.all(customPricePromises);
            console.log(`[CustomPrices] Updated ${customPricePromises.length} custom prices for customer: ${customerId}`);
        }

        if (stockUpdatePromises.length > 0) {
            await Promise.all(stockUpdatePromises);
            console.log(`[Inventory] Deducted stock for ${stockUpdatePromises.length} products.`);
        }

        // Create Notification
        await createInternalNotification({
            userId: req.user.id,
            type: 'INVOICE_CREATED',
            title: 'Invoice created',
            body: `${invoice.invoiceNumber} · ${invoice.customer.companyName} — £${total.toFixed(2)}`,
            invoiceId: invoice.id
        });

        console.log(`[Invoices] Created: ${invoice.invoiceNumber} (Total: £${total.toFixed(2)})`);
        res.status(201).json({ success: true, data: invoice });
        try {
            getIO().emit('invoice:created', invoice);
        } catch (err) {
            console.error('Socket emit error:', err.message);
        }
    } catch (err) {
        next(err);
    }
};

// PATCH /api/invoices/:id/status
export const updateInvoiceStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const normalizedStatus = (status || '').toUpperCase();
        const validStatuses = ['OUTSTANDING', 'PAID', 'OVERDUE', 'DRAFT', 'SENT', 'UNPAID'];

        if (!validStatuses.includes(normalizedStatus)) {
            return next(new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400));
        }

        const existing = await prisma.invoice.findFirst({ where: { id: req.params.id } });
        if (!existing) return next(new AppError('Invoice not found.', 404));

        const updated = await prisma.invoice.update({
            where: { id: req.params.id },
            data: {
                status: normalizedStatus,
                ...(normalizedStatus === 'PAID' && { paidAt: new Date() }),
            },
            include: { customer: true }
        });

        if (status === 'PAID') {
            await createInternalNotification({
                userId: req.user.id,
                type: 'INVOICE_PAID',
                title: 'Invoice paid',
                body: `${updated.invoiceNumber} · ${updated.customer.companyName} — £${updated.total.toFixed(2)}`,
                invoiceId: updated.id
            });
        }

        console.log(`[Invoices] Updated status of ${updated.invoiceNumber} to ${status}`);
        // Emit socket event
        try {
            getIO().emit('invoice:updated', updated);
        } catch (err) {
            console.error('Socket emit error:', err.message);
        }

        res.json({
            success: true,
            data: updated
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/invoices/:id/send
export const sendInvoice = async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findFirst({
            where: { id: req.params.id },
            include: { customer: true, items: true },
        });
        if (!invoice) return next(new AppError('Invoice not found.', 404));

        // Update status to OUTSTANDING immediately to give instant feedback
        await prisma.invoice.update({
            where: { id: req.params.id },
            data: {
                sentAt: new Date(),
                status: 'OUTSTANDING'
            },
        });

        // Send email in sequence but WITHOUT awaiting it in the MAIN response cycle
        // This prevents 504 Gateway Timeouts if SMTP is slow
        sendInvoiceEmail({
            to: invoice.customer.email,
            customerName: invoice.customer.companyName,
            invoice,
            user: req.user,
        }).catch(err => {
            console.error(`[Background Email Failed] Invoice ${invoice.invoiceNumber}:`, err.message);
        });

        res.json({
            success: true,
            message: `Invoice send process initiated for ${invoice.customer.email}`
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/invoices/:id/download
export const downloadInvoice = async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findFirst({
            where: { id: req.params.id },
            include: { customer: true, items: true },
        });

        if (!invoice) return next(new AppError('Invoice not found.', 404));

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const customer = invoice.customer;

        const companyName = 'novaconsumables';
        const companyEmail = 'accounts@novaconsumables.co.uk';

        // HTTP Headers for PDF
        res.setHeader('Content-Type', 'application/pdf');
        // Use inline so it opens in the browser, which is more reliable for email links
        res.setHeader('Content-Disposition', `inline; filename="Invoice_${invoice.invoiceNumber}.pdf"`);
        doc.pipe(res);

        // ─── Header Section (Premium Dark Theme) ───────────────────────────
        doc.rect(0, 0, 600, 140).fill('#111111');

        // Logo Image
        try {
            const logoPath = path.resolve(__dirname, '../../assets/logo.jpeg');
            doc.image(logoPath, 50, 40, { width: 60 });
        } catch (e) {
            // Fallback to minimal red box if image fails (no text per user request)
            doc.rect(50, 45, 60, 35).fill('#DC2626');
        }

        // Company Address (Center)
        doc.fillColor('#FFFFFF')
            .fontSize(10)
            .font('Helvetica-Bold')
            .text('Nova Consumables LTD', 0, 40, { align: 'center', width: 600 });

        doc.fillColor('#B5B5B5')
            .fontSize(9)
            .font('Helvetica')
            .text('Unit 16 Freeland Park\nWareham Road, Poole, BH16 6FH\nCompany Number: 14305500', 0, 55, { align: 'center', width: 600 });

        // Company Contact (Right)
        doc.fillColor('#B5B5B5')
            .fontSize(9)
            .text(`${companyEmail}\nwww.novaconsumables.co.uk`, 400, 55, { align: 'right', width: 150 });

        // ─── Billing Section ───────────────────────────────────────────────
        doc.fillColor('#111111').moveDown(8);
        const startY = 180;

        // Bill To
        doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold').text('Bill to:', 50, startY);
        doc.fontSize(12).fillColor('#111111').font('Helvetica-Bold').text(customer.companyName, 50, startY + 15);

        let customerAddress = customer.address || '';
        if (customer.address2) customerAddress += `, ${customer.address2}`;
        if (customer.city) customerAddress += `\n${customer.city}`;
        if (customer.county) customerAddress += `, ${customer.county}`;
        if (customer.postcode) customerAddress += ` ${customer.postcode}`;
        
        doc.fontSize(9).font('Helvetica').fillColor('#555555').text('Address:', 50, startY + 32);
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#111111').text(customerAddress, 110, startY + 32, { lineGap: 2 });

        if (customer.phone) {
            doc.fontSize(9).font('Helvetica').fillColor('#555555').text('Phone:', 50, startY + 74);
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#111111').text(customer.phone, 110, startY + 74);
        }

        if (customer.email) {
            doc.fontSize(9).font('Helvetica').fillColor('#555555').text('Email:', 50, startY + 88);
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#111111').text(customer.email, 110, startY + 88);
        }

        // Invoice Meta (Right side)
        const metaX = 400;
        let currentMetaY = startY;

        // Purchase Order (Only show if not empty)
        if (invoice.purchaseOrder && invoice.purchaseOrder.trim() !== '') {
            doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Purchase Order #:', metaX, currentMetaY);
            doc.fontSize(9).fillColor('#111111').font('Helvetica-Bold').text(invoice.purchaseOrder, metaX + 80, currentMetaY, { align: 'right', width: 90 });
            currentMetaY += 18;
        }

        doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Invoice #:', metaX, currentMetaY);
        doc.fontSize(9).fillColor('#111111').font('Helvetica-Bold').text(invoice.invoiceNumber, metaX + 80, currentMetaY, { align: 'right', width: 70 });
        currentMetaY += 18;

        doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Invoice Date:', metaX, currentMetaY);
        doc.fontSize(9).fillColor('#111111').font('Helvetica-Bold').text(new Date(invoice.createdAt).toLocaleDateString('en-GB'), metaX + 80, currentMetaY, { align: 'right', width: 70 });
        currentMetaY += 18;

        doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Due Date:', metaX, currentMetaY);
        doc.fontSize(9).fillColor('#DC2626').font('Helvetica-Bold').text(new Date(invoice.dueDate).toLocaleDateString('en-GB'), metaX + 80, currentMetaY, { align: 'right', width: 70 });
        currentMetaY += 18;

        doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Contact:', metaX, currentMetaY);
        doc.fontSize(9).fillColor('#111111').font('Helvetica-Bold').text(customer.contactInfo || invoice.user?.name || 'Tony', metaX + 80, currentMetaY, { align: 'right', width: 70 });

        // ─── Items Table ───────────────────────────────────────────────────
        const tableTop = 280;
        doc.rect(50, tableTop, 500, 25).fill('#111111');
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        doc.text('DESCRIPTION', 60, tableTop + 9);
        doc.text('QTY', 320, tableTop + 9, { width: 40, align: 'center' });
        doc.text('PRICE', 370, tableTop + 9, { width: 80, align: 'right' });
        doc.text('TOTAL', 460, tableTop + 9, { width: 80, align: 'right' });

        let currentY = tableTop + 30;
        invoice.items.forEach((item) => {
            doc.fillColor('#111111').fontSize(9).font('Helvetica-Bold').text(item.name, 60, currentY);
            if (item.description) {
                doc.fontSize(8).font('Helvetica').fillColor('#888888').text(item.description, 60, currentY + 12);
            }

            const rowHeight = item.description ? 35 : 25;
            doc.fillColor('#111111').fontSize(9).font('Helvetica');
            doc.text(item.quantity.toString(), 320, currentY, { width: 40, align: 'center' });
            doc.text(`£${item.unitPrice.toFixed(2)}`, 370, currentY, { width: 80, align: 'right' });
            doc.text(`£${item.total.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });

            currentY += rowHeight;
            doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor('#EEEEEE').lineWidth(0.5).stroke();
        });

        // ─── Footer Section ────────────────────────────────────────────────
        const footerStart = currentY + 20;

        // Payment Info (Left)
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#111111').text('Payment Terms', 50, footerStart);
        doc.fontSize(8).font('Helvetica').fillColor('#666666').text('Payment is due in full by the date above.', 50, footerStart + 12);

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text('Nova Consumables LTD', 50, footerStart + 35);
        doc.fontSize(8).font('Helvetica').fillColor('#666666').text('VAT: 437 4345 87 | Acc: 19530839\nSort: 04-06-05 | UTR: 50468 29841', 50, footerStart + 48, { lineGap: 2 });

        // Totals (Right)
        const totalX = 350;
        doc.fontSize(9).font('Helvetica').fillColor('#888888').text('Subtotal', totalX, footerStart);
        doc.fillColor('#111111').font('Helvetica-Bold').text(`£${invoice.subtotal.toFixed(2)}`, 460, footerStart, { width: 80, align: 'right' });

        doc.fontSize(9).font('Helvetica').fillColor('#888888').text('VAT (20%)', totalX, footerStart + 20);
        doc.fillColor('#111111').font('Helvetica-Bold').text(`£${(invoice.tax || 0).toFixed(2)}`, 460, footerStart + 20, { width: 80, align: 'right' });

        // Final Total Box
        doc.rect(totalX - 10, footerStart + 40, 210, 40).fill('#111111');
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text('TOTAL', totalX, footerStart + 55);
        doc.fillColor('#DC2626').fontSize(16).text(`£${invoice.total.toFixed(2)}`, 460, footerStart + 52, { width: 80, align: 'right' });

        // Notes
        if (invoice.notes) {
            const notesY = footerStart + 100;
            doc.rect(50, notesY, 500, 20).fill('#111111');
            doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold').text('NOTES', 60, notesY + 6);
            doc.fillColor('#666666').fontSize(8).font('Helvetica').text(invoice.notes, 50, notesY + 25, { width: 500 });
        }

        doc.end();
    } catch (err) {
        next(err);
    }
};

// DELETE /api/invoices/:id
export const deleteInvoice = async (req, res, next) => {
    try {
        const existing = await prisma.invoice.findFirst({ where: { id: req.params.id } });
        if (!existing) return next(new AppError('Invoice not found.', 404));

        await prisma.invoice.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Invoice deleted.' });
        try {
            getIO().emit('invoice:deleted', req.params.id);
        } catch (err) {
            console.error('Socket emit error:', err.message);
        }
    } catch (err) {
        next(err);
    }
};
// GET /api/invoices/analytics/reports
export const getReportsAnalytics = async (req, res, next) => {
    try {
        const userId = req.user.id;
        await checkAndNotifyOverdueInvoices(userId);
        const { month, year } = req.query;

        const now = new Date();
        const currentYear = now.getFullYear(); // Keep for revenue history
        const currentMonth = now.getMonth(); // Keep for revenue history

        const targetMonth = (month !== undefined && month !== '') ? parseInt(month) : now.getMonth();
        const targetYear = (year !== undefined && year !== '') ? parseInt(year) : now.getFullYear();

        // 1. Fetch all invoices for statistics
        const invoices = await prisma.invoice.findMany({
            include: { customer: { select: { companyName: true } } },
            orderBy: { createdAt: 'desc' }
        });

        // 2. Summary for target month & previous month for trends
        const firstDayTargetMonth = new Date(targetYear, targetMonth, 1);
        const lastDayTargetMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

        const firstDayPrevMonth = new Date(targetYear, targetMonth - 1, 1);
        const lastDayPrevMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59);

        const targetMonthInvoices = invoices.filter(inv => {
            const invDate = new Date(inv.createdAt);
            return invDate >= firstDayTargetMonth && invDate <= lastDayTargetMonth;
        });

        const prevMonthInvoices = invoices.filter(inv => {
            const invDate = new Date(inv.createdAt);
            return invDate >= firstDayPrevMonth && invDate <= lastDayPrevMonth;
        });

        const calcTrend = (curr, prev) => {
            if (prev === 0) return curr > 0 ? '+100%' : '+0%';
            const diff = ((curr - prev) / prev) * 100;
            return (diff >= 0 ? '+' : '') + diff.toFixed(0) + '%';
        };

        const totalInvoiced = targetMonthInvoices.reduce((sum, inv) => sum + inv.total, 0);
        const prevTotalInvoiced = prevMonthInvoices.reduce((sum, inv) => sum + inv.total, 0);

        const collected = targetMonthInvoices.filter(inv => inv.status === 'PAID').reduce((sum, inv) => sum + inv.total, 0);
        const prevCollected = prevMonthInvoices.filter(inv => inv.status === 'PAID').reduce((sum, inv) => sum + inv.total, 0);

        const outstanding = targetMonthInvoices.filter(inv => inv.status === 'OUTSTANDING' || inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);
        const prevOutstanding = prevMonthInvoices.filter(inv => inv.status === 'OUTSTANDING' || inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);

        const overdue = targetMonthInvoices.filter(inv => inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);
        const prevOverdue = prevMonthInvoices.filter(inv => inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);

        const monthName = firstDayTargetMonth.toLocaleString('en-US', { month: 'short' });

        // ... (revenueHistory, statusBreakdown, recentPayments logic remains same)
        const revenueHistory = [];
        for (let i = 11; i >= 0; i--) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const monthLabel = date.toLocaleString('en-US', { month: 'short' });
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            const monthInvoices = invoices.filter(inv => {
                const invDate = new Date(inv.createdAt);
                return invDate >= monthStart && invDate <= monthEnd;
            });

            const paid = monthInvoices.filter(inv => inv.status === 'PAID').reduce((sum, inv) => sum + inv.total, 0);
            const overdue = monthInvoices.filter(inv => inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);
            const outstanding = monthInvoices.filter(inv => inv.status === 'OUTSTANDING').reduce((sum, inv) => sum + inv.total, 0);

            revenueHistory.push({
                month: monthLabel,
                paid: parseFloat(paid.toFixed(2)),
                outstanding: parseFloat(outstanding.toFixed(2)),
                overdue: parseFloat(overdue.toFixed(2))
            });
        }

        const allPaid = invoices.filter(inv => inv.status === 'PAID').reduce((sum, inv) => sum + inv.total, 0);
        const allOutstanding = invoices.filter(inv => inv.status === 'OUTSTANDING').reduce((sum, inv) => sum + inv.total, 0);
        const allOverdue = invoices.filter(inv => inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.total, 0);

        const recentPayments = invoices
            .filter(inv => inv.status === 'PAID')
            .slice(0, 5)
            .map(inv => ({
                id: inv.invoiceNumber,
                customer: inv.customer?.companyName || 'Unknown',
                amount: `£${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                date: new Date(inv.paidAt || inv.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            }));

        res.json({
            success: true,
            data: {
                summary: [
                    { label: `Total Invoiced (${monthName})`, value: `£${totalInvoiced.toLocaleString()}`, sub: `${targetMonthInvoices.length} invoices total`, color: '#111111', trend: calcTrend(totalInvoiced, prevTotalInvoiced), up: totalInvoiced >= prevTotalInvoiced },
                    { label: `Collected (${monthName})`, value: `£${collected.toLocaleString()}`, sub: `${targetMonthInvoices.filter(i => i.status === 'PAID').length} paid invoices`, color: '#22C55E', trend: calcTrend(collected, prevCollected), up: collected >= prevCollected },
                    { label: 'Outstanding', value: `£${outstanding.toLocaleString()}`, sub: `${targetMonthInvoices.filter(i => i.status === 'OUTSTANDING').length} invoices pending`, color: '#F59E0B', trend: calcTrend(outstanding, prevOutstanding), up: outstanding >= prevOutstanding },
                    { label: 'Overdue', value: `£${overdue.toLocaleString()}`, sub: `${targetMonthInvoices.filter(i => i.status === 'OVERDUE').length} invoices overdue`, color: '#EF4444', trend: calcTrend(overdue, prevOverdue), up: overdue < prevOverdue },
                ],
                revenueHistory,
                statusBreakdown: [
                    { label: 'Paid', value: parseFloat(allPaid.toFixed(2)), color: '#22C55E' },
                    { label: 'Outstanding', value: parseFloat(allOutstanding.toFixed(2)), color: '#F59E0B' },
                    { label: 'Overdue', value: parseFloat(allOverdue.toFixed(2)), color: '#EF4444' },
                ],
                recentPayments
            }
        });
    } catch (err) {
        next(err);
    }
};
// GET /api/invoices/analytics/summary
export const getInvoiceAnalytics = async (req, res, next) => {
    try {
        await checkAndNotifyOverdueInvoices(req.user.id);
        await checkAndSendReminders();
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        const invoices = await prisma.invoice.findMany({
            include: { items: true }
        });

        let outstandingAmt = 0;
        let outstandingCount = 0;
        let overdueAmt = 0;
        let overdueCount = 0;
        let paidThisMonthAmt = 0;
        let paidThisMonthCount = 0;
        let totalThisMonthAmt = 0;
        let totalLastMonthAmt = 0;

        invoices.forEach(inv => {
            const amount = inv.total;
            const status = (inv.status || '').toUpperCase();
            const invDate = new Date(inv.createdAt);

            if (invDate >= firstDayThisMonth && invDate <= lastDayThisMonth) {
                totalThisMonthAmt += amount;
            } else if (invDate >= firstDayLastMonth && invDate <= lastDayLastMonth) {
                totalLastMonthAmt += amount;
            }

            if (status === 'PAID') {
                const paidDate = inv.paidAt || inv.updatedAt;
                if (new Date(paidDate) >= firstDayThisMonth) {
                    paidThisMonthAmt += amount;
                    paidThisMonthCount++;
                }
            } else if (status === 'OUTSTANDING' || status === 'OVERDUE' || status === 'SENT' || status === 'UNPAID') {
                const todayForOverdue = new Date();
                todayForOverdue.setHours(0, 0, 0, 0);
                const isOverdueChar = inv.dueDate && new Date(inv.dueDate) < todayForOverdue;
                
                if (isOverdueChar) {
                    overdueAmt += amount;
                    overdueCount++;
                } else {
                    outstandingAmt += amount;
                    outstandingCount++;
                }
            }
        });

        let revenueGrowth = 0;
        if (totalLastMonthAmt > 0) {
            revenueGrowth = ((totalThisMonthAmt - totalLastMonthAmt) / totalLastMonthAmt) * 100;
        } else if (totalThisMonthAmt > 0) {
            revenueGrowth = 100;
        }

        res.json({
            success: true,
            data: {
                outstanding: outstandingAmt,
                outstandingCount,
                overdue: overdueAmt,
                overdueCount,
                paidThisMonth: paidThisMonthAmt,
                paidThisMonthCount,
                totalThisMonth: totalThisMonthAmt,
                revenueGrowth: Math.round(revenueGrowth)
            }
        });
    } catch (err) {
        next(err);
    }
};
