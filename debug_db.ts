
import { db } from './src/local-db';

async function debugProducts() {
    try {
        const products = await db.products.limit(10).toArray();
        console.log('Sample Products:', JSON.stringify(products.map(p => ({ id: p.id, name: p.name, imageUrl: p.imageUrl })), null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

debugProducts();
