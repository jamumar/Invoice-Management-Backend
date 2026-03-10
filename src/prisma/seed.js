import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

// Paths to CSV files in the backend root
const customersCsvPath = path.resolve(__dirname, '../../customers - Sheet1.csv');
const productsCsvPath = path.resolve(__dirname, '../../products - Sheet1.csv');

async function seed() {
    console.log('🌱 Starting database seed...');

    // 1. Ensure a test user exists to own these records
    const email = 'admin@invoicemanagement.com';
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        console.log(`Creating default user (${email})...`);
        const hashedPassword = await bcrypt.hash('password123', 10);
        user = await prisma.user.create({
            data: {
                name: 'System Admin',
                email,
                password: hashedPassword,
                businessName: 'My Awesome Business',
            },
        });
    } else {
        console.log(`Using existing user (${email})...`);
    }

    // 2. Read Customers CSV
    const customers = [];
    if (fs.existsSync(customersCsvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(customersCsvPath)
                .pipe(csv())
                .on('data', (row) => {
                    if (row['COMPANY NAME'] && row['EMAIL']) {
                        customers.push({
                            companyName: row['COMPANY NAME'].trim(),
                            contactInfo: row['CONTACT INFO'] ? row['CONTACT INFO'].trim() : null,
                            address: row['ADDRESS'] ? row['ADDRESS'].trim() : null,
                            address2: row['ADDRESS2'] ? row['ADDRESS2'].trim() : null,
                            city: row['CITY'] ? row['CITY'].trim() : null,
                            county: row['County'] ? row['County'].trim() : null,
                            postcode: row['POSTCODE'] ? row['POSTCODE'].trim() : null,
                            phone: row['PHONE'] ? row['PHONE'].trim() : null,
                            paymentTerms: row['Payment Terms'] ? row['Payment Terms'].trim() : '14',
                            email: row['EMAIL'].trim(),
                            userId: user.id,
                        });
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Parsed ${customers.length} customers from CSV.`);
    } else {
        console.warn(`⚠️ Customers CSV not found at ${customersCsvPath}`);
    }

    // 3. Read Products CSV
    const products = [];
    if (fs.existsSync(productsCsvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(productsCsvPath)
                .pipe(csv())
                .on('data', (row) => {
                    const productCode = row['Product Code'];
                    const description = row['Description'];
                    const unitPriceRaw = row['Unit Price'];

                    if (productCode && unitPriceRaw) {
                        // Clean price string (e.g. "£16.40 " -> 16.4)
                        const cleanPrice = parseFloat(unitPriceRaw.replace(/[^0-9.]/g, ''));

                        if (!isNaN(cleanPrice)) {
                            products.push({
                                productCode: productCode.trim(),
                                name: description ? description.trim() : productCode.trim(), // Using description as name if available
                                description: description ? description.trim() : null,
                                unitPrice: cleanPrice,
                                unit: 'per unit',
                                userId: user.id,
                            });
                        }
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Parsed ${products.length} products from CSV.`);
    } else {
        console.warn(`⚠️ Products CSV not found at ${productsCsvPath}`);
    }

    // 4. Insert into DB inside a transaction to ensure clean slate
    try {
        await prisma.$transaction(async (tx) => {
            // Optional: clear existing records for this user to avoid duplicates on re-run
            await tx.customer.deleteMany({ where: { userId: user.id } });
            await tx.product.deleteMany({ where: { userId: user.id } });

            if (customers.length > 0) {
                await tx.customer.createMany({ data: customers });
                console.log(`✅ Inserted ${customers.length} customers.`);
            }

            if (products.length > 0) {
                await tx.product.createMany({ data: products });
                console.log(`✅ Inserted ${products.length} products.`);
            }
        });
        console.log('🎉 Seed completed successfully!');
    } catch (e) {
        console.error('❌ Error inserting data:', e);
    } finally {
        await prisma.$disconnect();
    }
}

seed().catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
