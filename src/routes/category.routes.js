import { Router } from 'express';
import {
    getCategories,
    getCategoryTree,
    createCategory,
    updateCategory,
    deleteCategory,
} from '../controllers/category.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.use(protect);

router.route('/').get(getCategories).post(createCategory);
router.route('/tree').get(getCategoryTree);
router.route('/:id').patch(updateCategory).delete(deleteCategory);

export default router;
