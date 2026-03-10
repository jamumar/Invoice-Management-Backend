import prisma from '../lib/prisma.js';
import { sendInvoiceEmail } from '../lib/mailer.js';
import { AppError } from '../middleware/error.middleware.js';

// ─── Helper: generate invoice number ─────────────────────────────────────────
const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const count = await prisma.invoice.count();
    return `INV-${year}-${String(count + 1).padStart(3, '0')}`;
};

// GET /api/invoices
export const getInvoices = async (req, res, next) => {
    try {
        const { status } = req.query;
        const invoices = await prisma.invoice.findMany({
            where: {
                userId: req.user.id,
                ...(status && { status: status.toUpperCase() }),
            },
            include: { customer: { select: { companyName: true, email: true, address: true, city: true, postcode: true } }, items: true },
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
            where: { id: req.params.id, userId: req.user.id },
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
        const { customerId, items, dueDate, notes, tax } = req.body;

        if (!customerId || !items || !items.length) {
            return next(new AppError('Customer and at least one item are required.', 400));
        }

        const customer = await prisma.customer.findFirst({ where: { id: customerId, userId: req.user.id } });
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

        // ─── Upsert Custom Prices ──────────────────────────────────────────────
        // If an item has a productId, we save this unitPrice as the "custom" price for this customer
        const customPricePromises = items
            .filter((item) => item.productId)
            .map((item) => {
                return prisma.customPrice.upsert({
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
                });
            });

        if (customPricePromises.length > 0) {
            await Promise.all(customPricePromises);
            console.log(`[CustomPrices] Updated ${customPricePromises.length} custom prices for customer: ${customerId}`);
        }

        console.log(`[Invoices] Created: ${invoice.invoiceNumber} (Total: £${total.toFixed(2)})`);
        res.status(201).json({ success: true, data: invoice });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/invoices/:id/status
export const updateInvoiceStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const validStatuses = ['OUTSTANDING', 'PAID', 'OVERDUE', 'DRAFT'];
        if (!validStatuses.includes(status)) {
            return next(new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400));
        }

        const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Invoice not found.', 404));

        const updated = await prisma.invoice.update({
            where: { id: req.params.id },
            data: {
                status,
                ...(status === 'PAID' && { paidAt: new Date() }),
            },
        });

        console.log(`[Invoices] Updated status of ${updated.invoiceNumber} to ${status}`);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// POST /api/invoices/:id/send
export const sendInvoice = async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findFirst({
            where: { id: req.params.id, userId: req.user.id },
            include: { customer: true, items: true },
        });
        if (!invoice) return next(new AppError('Invoice not found.', 404));

        await sendInvoiceEmail({
            to: invoice.customer.email,
            customerName: invoice.customer.companyName,
            invoice,
            user: req.user,
        });

        await prisma.invoice.update({
            where: { id: req.params.id },
            data: { sentAt: new Date(), status: 'OUTSTANDING' },
        });

        res.json({ success: true, message: `Invoice sent to ${invoice.customer.email}` });
    } catch (err) {
        next(err);
    }
};

import PDFDocument from 'pdfkit';

// GET /api/invoices/:id/download
export const downloadInvoice = async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findFirst({
            where: { id: req.params.id, userId: req.user.id },
            include: { customer: true, items: true },
        });

        if (!invoice) return next(new AppError('Invoice not found.', 404));

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const business = req.user;
        const customer = invoice.customer;

        // HTTP Headers for PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice_${invoice.invoiceNumber}.pdf`);
        doc.pipe(res);

        // ─── Header Section (Premium Dark Theme) ───────────────────────────
        doc.rect(0, 0, 600, 140).fill('#111111');

        // Logo (NOVA CONSUMABLES style)
        doc.rect(50, 45, 60, 35).fill('#DC2626');
        doc.fillColor('#FFFFFF')
            .fontSize(18)
            .font('Helvetica-Bold')
            .text('NOVA', 55, 55);

        doc.fillColor('#DC2626')
            .fontSize(8)
            .font('Helvetica-Bold')
            .text('CONSUMABLES', 50, 85, { characterSpacing: 1 });

        // Company Address (Center)
        doc.fillColor('#B5B5B5')
            .fontSize(9)
            .font('Helvetica')
            .text('Unit 16 Freeland Park\nWareham Road, Poole, BH16 6FH', 0, 55, { align: 'center', width: 600 });

        // Company Contact (Right)
        doc.fillColor('#B5B5B5')
            .fontSize(9)
            .text('sales@novaconsumables.co.uk\nwww.novaconsumables.co.uk', 400, 55, { align: 'right', width: 150 });

        // ─── Billing Section ───────────────────────────────────────────────
        doc.fillColor('#111111').moveDown(8);
        const startY = 180;

        // Bill To
        doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold').text('BILL TO', 50, startY);
        doc.fontSize(12).fillColor('#111111').font('Helvetica-Bold').text(customer.companyName, 50, startY + 15);

        let customerAddress = customer.address || '';
        if (customer.city) customerAddress += `\n${customer.city}`;
        if (customer.postcode) customerAddress += `\n${customer.postcode}`;
        doc.fontSize(10).font('Helvetica').fillColor('#555555').text(customerAddress, 50, startY + 32, { lineGap: 2 });

        // Invoice Meta (Right side)
        const metaX = 400;
        doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold').text('INVOICE #', metaX, startY);
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(invoice.invoiceNumber, metaX + 80, startY, { align: 'right', width: 70 });

        doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold').text('ISSUE DATE', metaX, startY + 20);
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(new Date(invoice.createdAt).toLocaleDateString('en-GB'), metaX + 80, startY + 20, { align: 'right', width: 70 });

        doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold').text('DUE DATE', metaX, startY + 40);
        doc.fontSize(10).fillColor('#DC2626').font('Helvetica-Bold').text(new Date(invoice.dueDate).toLocaleDateString('en-GB'), metaX + 80, startY + 40, { align: 'right', width: 70 });

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
        const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Invoice not found.', 404));

        await prisma.invoice.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Invoice deleted.' });
    } catch (err) {
        next(err);
    }
};
