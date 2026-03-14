import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';
import { getIO } from '../lib/socket.js';
import csv from 'csv-parser';
import fs from 'fs';

export const bulkUploadCustomers = async (req, res, next) => {
    try {
        if (!req.file) return next(new AppError('Please upload a CSV file.', 400));

        const customers = [];
        const results = [];

        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                try {
                    for (const row of results) {
                        const companyName = row['COMPANY NAME'] || row['companyName'];
                        const email = row['EMAIL'] || row['email'];

                        if (!companyName || !email) continue;

                        // Check if customer already exists (duplicate detection)
                        const existingCustomer = await prisma.customer.findFirst({
                            where: {
                                userId: req.user.id,
                                email: email
                            }
                        });

                        if (existingCustomer) {
                            // Skip duplicate
                            console.log(`[Bulk Import] Skipping duplicate customer: ${email}`);
                            continue;
                        }

                        // Basic mapping
                        const customerData = {
                            companyName,
                            email,
                            contactInfo: row['CONTACT INFO'] || row['contactInfo'] || null,
                            phone: row['PHONE'] || row['phone'] || null,
                            address: row['ADDRESS'] || row['address'] || null,
                            address2: row['ADDRESS2'] || row['address2'] || null,
                            city: row['CITY'] || row['city'] || null,
                            county: row['County'] || row['county'] || null,
                            postcode: row['POSTCODE'] || row['postcode'] || null,
                            paymentTerms: row['Payment Terms'] ? (row['Payment Terms'].includes('30') ? 'net_30' : (row['Payment Terms'].includes('14') ? 'net_14' : 'net_30')) : 'net_30',
                            userId: req.user.id
                        };

                        const customer = await prisma.customer.create({
                            data: customerData
                        });
                        customers.push(customer);

                        // Emit socket event for each if needed, or one big sync event later
                        getIO().emit('customer:created', customer);
                    }

                    // Clean up file
                    fs.unlinkSync(req.file.path);

                    res.json({ success: true, count: customers.length, data: customers });
                } catch (err) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    next(err);
                }
            });
    } catch (err) {
        next(err);
    }
};

export const bulkUploadProducts = async (req, res, next) => {
    try {
        if (!req.file) return next(new AppError('Please upload a CSV file.', 400));

        const products = [];
        const results = [];

        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                try {
                    for (const row of results) {
                        const mainCatName = row['Main Category'];
                        const subCatName = row['Subcategory'];
                        const typeName = row['Type'];
                        const productName = row['Description']; // Using Description as name if not available
                        const productCode = row['Product Code'];
                        const unitPrice = parseFloat(row['Unit Price'] || 0);
                        const stock = parseInt(row['Stock'] || 0, 10);

                        if (!productName || !mainCatName) continue;

                        // Check if product already exists (duplicate detection)
                        const existingProduct = await prisma.product.findFirst({
                            where: {
                                userId: req.user.id,
                                productCode: productCode || undefined,
                                name: productName
                            }
                        });

                        if (existingProduct) {
                            console.log(`[Bulk Import] Skipping duplicate product: ${productName} (${productCode})`);
                            continue;
                        }

                        // 1. Handle Categories
                        let parentId = null;

                        // Main Category
                        let mainCat = await prisma.category.findFirst({
                            where: { userId: req.user.id, name: mainCatName, parentId: null }
                        });
                        if (!mainCat) {
                            mainCat = await prisma.category.create({
                                data: { name: mainCatName, userId: req.user.id }
                            });
                        }
                        parentId = mainCat.id;

                        // Subcategory
                        if (subCatName) {
                            let subCat = await prisma.category.findFirst({
                                where: { userId: req.user.id, name: subCatName, parentId }
                            });
                            if (!subCat) {
                                subCat = await prisma.category.create({
                                    data: { name: subCatName, userId: req.user.id, parentId }
                                });
                            }
                            parentId = subCat.id;
                        }

                        // Type (Level 3)
                        if (typeName) {
                            let typeCat = await prisma.category.findFirst({
                                where: { userId: req.user.id, name: typeName, parentId }
                            });
                            if (!typeCat) {
                                typeCat = await prisma.category.create({
                                    data: { name: typeName, userId: req.user.id, parentId }
                                });
                            }
                            parentId = typeCat.id;
                        }

                        // 2. Create Product
                        const product = await prisma.product.create({
                            data: {
                                productCode: productCode || '',
                                name: productName,
                                description: row['Description'] || '',
                                unitPrice,
                                stock,
                                userId: req.user.id,
                                categoryId: parentId,
                                unit: 'per unit'
                            }
                        });
                        products.push(product);
                        getIO().emit('product:created', product);
                    }

                    // Clean up file
                    fs.unlinkSync(req.file.path);

                    res.json({ success: true, count: products.length, data: products });
                } catch (err) {
                    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                    next(err);
                }
            });
    } catch (err) {
        next(err);
    }
};
