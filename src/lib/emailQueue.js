import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { sendInvoiceEmail } from './mailer.js';
import prisma from './prisma.js';

dotenv.config();

// Create a reusable Redis connection for BullMQ
const connection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null, // Mandatory for BullMQ compatibility
});

// Configure Queue
const emailQueue = new Queue('email-queue', { connection });

/**
 * Adds an email job to the queue.
 * @param {Object} opts
 * @param {string} opts.invoiceId - ID of the invoice to process
 * @param {string} opts.userId - ID of the user triggering the email
 * @param {boolean} opts.isReminder - True if this is a payment reminder
 */
export async function addEmailToQueue({ invoiceId, isReminder, userId }) {
    console.log(`[Queue] Adding invoice-email job to queue. Invoice: ${invoiceId}, Reminder: ${isReminder}`);
    return emailQueue.add(
        'invoice-email',
        { invoiceId, isReminder, userId },
        {
            attempts: 3, // Retry up to 3 times on failure
            backoff: {
                type: 'exponential',
                delay: 5000, // Backoff starting at 5s, then 10s, then 20s...
            },
        }
    );
}

let worker;

/**
 * Initializes the background email queue worker.
 */
export function initEmailWorker() {
    if (worker) return worker;

    console.log('👷 Email queue worker starting up...');

    worker = new Worker(
        'email-queue',
        async (job) => {
            const { invoiceId, isReminder, userId } = job.data;
            console.log(`[Worker] Job ${job.id} in progress... processing invoice ID ${invoiceId}`);

            // Fetch absolute latest invoice data from DB
            const invoice = await prisma.invoice.findUnique({
                where: { id: invoiceId },
                include: {
                    customer: true,
                    items: {
                        include: {
                            product: true,
                        },
                    },
                },
            });

            if (!invoice) {
                throw new Error(`Invoice with ID ${invoiceId} not found in database.`);
            }

            // Fetch owner/user details
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    businessAddress: true,
                },
            });

            if (!user) {
                throw new Error(`User with ID ${userId} not found in database.`);
            }

            // Send via Resend Mailer
            await sendInvoiceEmail({
                to: invoice.customer.email,
                customerName: invoice.customer.companyName,
                invoice,
                user,
                isReminder,
            });

            console.log(`[Worker] Job ${job.id} completed successfully for invoice ${invoice.invoiceNumber}`);
        },
        {
            connection,
            concurrency: 1, // Process one email at a time to prevent rate limits
        }
    );

    worker.on('failed', (job, err) => {
        if (job) {
            console.error(`❌ [Worker] Job ${job.id} failed: ${err.message}. Attempts made: ${job.attemptsMade}`);
        } else {
            console.error(`❌ [Worker] Job failed: ${err.message}`);
        }
    });

    worker.on('error', (err) => {
        console.error('❌ [Worker] Global worker error:', err.message);
    });

    return worker;
}

export default emailQueue;
