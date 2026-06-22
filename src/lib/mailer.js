import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Helper to check connection/config on start.
 * Since Resend is an HTTP-based service, we just verify the API key is present.
 */
if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY is not defined in environment variables.');
} else {
    console.log('📧  Resend email client initialized');
}

/**
 * General helper to send emails via Resend.
 */
export async function sendMailViaResend({ to, subject, html, cc }) {
    const companyName = 'novaconsumables';
    const senderEmail = process.env.SENDER_EMAIL || 'accounts@novaconsumables.co.uk';

    try {
        const { data, error } = await resend.emails.send({
            from: `"${companyName}" <${senderEmail}>`,
            to: Array.isArray(to) ? to : [to],
            cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
            subject,
            html,
        });

        if (error) {
            console.error(`❌ Resend API error:`, error);
            throw new Error(error.message || 'Failed to send email via Resend');
        }

        console.log(`📧 Email sent successfully via Resend: ${data.id}`);
        return data;
    } catch (error) {
        console.error(`❌ Email failed to ${to}:`, error.message);
        throw error;
    }
}

/**
 * Sends an invoice email to a customer.
 * @param {Object} opts
 * @param {string} opts.to - Recipient email address
 * @param {string} opts.customerName - Name shown in the greeting
 * @param {Object} opts.invoice - The invoice object from Prisma
 * @param {Object} opts.user - The business owner (sender) object
 */
export async function sendInvoiceEmail({ to, customerName, invoice, user, isReminder = false }) {
    const subtotal = invoice.subtotal || 0;
    const tax = invoice.tax || 0;
    const total = invoice.total || 0;

    const companyName = 'novaconsumables';
    const companyEmail = 'accounts@novaconsumables.co.uk';

    const itemsHtml = invoice.items
        .map(
            (item) => {
                const itemCode = item.product?.productCode || (item.name.includes(' - ') ? item.name.split(' - ')[0] : '—');
                const itemDesc = item.product?.description || (item.name.includes(' - ') ? item.name.split(' - ').slice(1).join(' - ') : item.name);
                
                return `
                <tr style="border-bottom: 1px solid #f0f0f0;">
                    <td style="padding: 12px 4px; font-size: 13px; color: #111111; font-family: 'Roboto', Helvetica, Arial, sans-serif;">
                        <div style="font-weight: 700; margin-bottom: 2px;">${itemCode}</div>
                        <div style="font-size: 12px; color: #555555;">${itemDesc}</div>
                    </td>
                    <td style="padding: 12px 4px; text-align: center; color: #555555; font-size: 13px; font-family: 'Roboto', sans-serif;">${item.quantity}</td>
                    <td style="padding: 12px 4px; text-align: right; color: #555555; font-size: 13px; font-family: 'Roboto', sans-serif;">£${item.unitPrice.toFixed(2)}</td>
                    <td style="padding: 12px 4px; text-align: right; font-weight: 700; color: #111111; font-size: 13px; font-family: 'Roboto', sans-serif;">£${item.total.toFixed(2)}</td>
                </tr>
                `;
            }
        )
        .join('');

    // Generate a token for the download link (valid for 30 days to match the invoice)
    const downloadToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Use absolute URL from environment for static assets
    const logoUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/assets/logo.jpeg`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
    </head>
    <body style="font-family: 'Roboto', Helvetica, Arial, sans-serif; background-color: #f4f7f9; margin: 0; padding: 40px 0;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
            <!-- Header -->
            <tr>
                <td style="background-color: #111111; padding: 32px 40px; text-align: center;">
                    <div style="margin-bottom: 0;">
                        <img src="${logoUrl}" alt="Logo" width="56" style="display: block; margin: 0 auto; border-radius: 14px;" />
                    </div>
                    <p style="color: #b5b5b5; margin: 4px 0 0; font-size: 12px; font-family: 'Roboto', sans-serif;">${companyEmail}</p>
                </td>
            </tr>

            <!-- Content -->
            <tr>
                <td style="padding: 32px 40px;">
                    <p style="font-size: 16px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #111111; margin-bottom: 8px;">Hi ${customerName},</p>
                    <p style="font-size: 14px; font-family: 'Roboto', sans-serif; color: #555555; line-height: 1.6; margin-bottom: 24px;">
                        Please find your invoice attached. A summary is shown below. Payment is due by <strong style="color: #DC2626;">${new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>.
                    </p>

                    <!-- Summary Box -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                        ${invoice.purchaseOrder ? `
                        <tr>
                            <td colspan="2" style="padding-bottom: 16px;">
                                <p style="font-size: 10px; color: #b5b5b5; margin: 0 0 4px; font-family: 'Roboto', sans-serif; letter-spacing: 0.5px;">PURCHASE ORDER #</p>
                                <p style="font-size: 14px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #111111; margin: 0;">${invoice.purchaseOrder}</p>
                            </td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td width="50%" style="padding-bottom: 16px;">
                                <p style="font-size: 10px; color: #b5b5b5; margin: 0 0 4px; font-family: 'Roboto', sans-serif; letter-spacing: 0.5px;">INVOICE NO.</p>
                                <p style="font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #111111; margin: 0;">${invoice.invoiceNumber}</p>
                            </td>
                            <td width="50%" style="padding-bottom: 16px;">
                                <p style="font-size: 10px; color: #b5b5b5; margin: 0 0 4px; font-family: 'Roboto', sans-serif; letter-spacing: 0.5px;">ISSUE DATE</p>
                                <p style="font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #111111; margin: 0;">${new Date(invoice.issueDate || invoice.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                            </td>
                        </tr>
                        <tr>
                            <td width="50%">
                                <p style="font-size: 10px; color: #b5b5b5; margin: 0 0 4px; font-family: 'Roboto', sans-serif; letter-spacing: 0.5px;">DUE DATE</p>
                                <p style="font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #DC2626; margin: 0;">${new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                            </td>
                            <td width="50%">
                                <p style="font-size: 10px; color: #b5b5b5; margin: 0 0 4px; font-family: 'Roboto', sans-serif; letter-spacing: 0.5px;">BILL TO</p>
                                <p style="font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #111111; margin: 0;">${invoice.customer.companyName}</p>
                            </td>
                        </tr>
                    </table>

                    <!-- Items Table -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <thead>
                            <tr style="border-bottom: 2px solid #111111;">
                                <th style="padding: 8px 4px; text-align: left; font-size: 11px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #111111; text-transform: uppercase;">Description</th>
                                <th style="padding: 8px 4px; text-align: center; font-size: 11px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #111111; text-transform: uppercase;">Qty</th>
                                <th style="padding: 8px 4px; text-align: right; font-size: 11px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #111111; text-transform: uppercase;">Price</th>
                                <th style="padding: 8px 4px; text-align: right; font-size: 11px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #111111; text-transform: uppercase;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <!-- Totals -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px; border-top: 1px solid #e5e5e5; padding-top: 16px;">
                        <tr>
                            <td width="60%"></td>
                            <td width="40%">
                                <table width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td style="font-size: 13px; color: #777777; padding-bottom: 8px; font-family: 'Roboto', sans-serif;">Subtotal</td>
                                        <td style="font-size: 13px; color: #111111; text-align: right; padding-bottom: 8px; font-family: 'Roboto', sans-serif;">£${subtotal.toFixed(2)}</td>
                                    </tr>
                                    ${tax > 0 ? `
                                    <tr>
                                        <td style="font-size: 13px; color: #777777; padding-bottom: 8px; font-family: 'Roboto', sans-serif;">Tax</td>
                                        <td style="font-size: 13px; color: #111111; text-align: right; padding-bottom: 8px; font-family: 'Roboto', sans-serif;">£${tax.toFixed(2)}</td>
                                    </tr>
                                    ` : ''}
                                    <tr>
                                        <td colspan="2" style="padding-top: 8px;">
                                            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #111111; border-radius: 8px; padding: 12px 14px;">
                                                <tr>
                                                    <td style="font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #ffffff;">Total Due</td>
                                                    <td style="font-size: 18px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #DC2626; text-align: right;">£${total.toFixed(2)}</td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <!-- CTA -->
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${process.env.BACKEND_URL || 'http://localhost:5000'}/api/invoices/${invoice.id}/download?token=${downloadToken}" style="display: inline-block; background-color: #DC2626; color: #ffffff; padding: 14px 32px; border-radius: 10px; font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 14px; text-decoration: none; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);">
                            Download PDF Invoice
                        </a>
                    </div>

                    <!-- Footer Note -->
                    <div style="border-top: 1px solid #f0f0f0; padding-top: 24px; font-size: 12px; color: #999999; font-family: 'Roboto', sans-serif; line-height: 1.6;">
                        If you have any questions about this invoice, please don't hesitate to get in touch at <span style="color: #DC2626;">${companyEmail}</span>.
                    </div>
                </td>
            </tr>

            <!-- Footer -->
            <tr>
                <td style="background-color: #f7f7f7; padding: 24px 40px; text-align: center; font-size: 11px; color: #b5b5b5; font-family: 'Roboto', sans-serif; border-top: 1px solid #e5e5e5;">
                    ${companyName} ${user.businessAddress ? `· ${user.businessAddress}` : ''}
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

    return sendMailViaResend({
        to,
        cc: isReminder ? undefined : companyEmail,
        subject: `${isReminder ? 'PAYMENT REMINDER: ' : ''}Invoice ${invoice.invoiceNumber} from ${companyName}`,
        html,
    });
}

/**
 * Sends a password reset email.
 */
export async function sendPasswordResetEmail({ to, newPassword }) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
    </head>
    <body style="font-family: 'Roboto', Helvetica, Arial, sans-serif; background-color: #f4f7f9; margin: 0; padding: 40px 0;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
            <tr>
                <td style="padding: 32px 40px;">
                    <p style="font-size: 16px; font-family: 'Poppins', sans-serif; font-weight: 600; color: #111111; margin-bottom: 8px;">Password Reset</p>
                    <p style="font-size: 14px; font-family: 'Roboto', sans-serif; color: #555555; line-height: 1.6; margin-bottom: 24px;">
                        Your password has been reset. Please use the following temporary password to log in:
                    </p>
                    <p style="font-size: 18px; font-family: 'Poppins', sans-serif; font-weight: 700; color: #DC2626; margin: 0;">${newPassword}</p>
                    <p style="font-size: 14px; font-family: 'Roboto', sans-serif; color: #555555; line-height: 1.6; margin-top: 24px;">
                        We recommend updating your password once you log in (if applicable).
                    </p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

    return sendMailViaResend({
        to,
        subject: 'Password Reset',
        html,
    });
}
