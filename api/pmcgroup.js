export default async function handler(req, res) {
    try {
        const response = await fetch('https://t.me/s/PMCgroup', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        const data = await response.text();
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.status(response.status).send(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
