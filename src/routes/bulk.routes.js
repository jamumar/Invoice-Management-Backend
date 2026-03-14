import express from 'express';
import multer from 'multer';
import os from 'os';
import * as bulkController from '../controllers/bulk.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.use(protect);

router.post('/customers', upload.single('file'), bulkController.bulkUploadCustomers);
router.post('/products', upload.single('file'), bulkController.bulkUploadProducts);

export default router;
