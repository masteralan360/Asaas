export default async function handler(req, res) {
    try {
        const { path = '' } = req.query;
        // Remove leading slash if any
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        const targetUrl = `https://xeiqd.com${cleanPath}`;

        const response = await fetch(targetUrl, {
            headers: {
                'Referer': 'https://xeiqd.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        const data = await response.text();
        res.setHeader('Content-Type', 'text/html');
        res.status(response.status).send(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
