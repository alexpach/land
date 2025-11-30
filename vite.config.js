import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
    base: '/land/', // Repo name
    plugins: [
        {
            name: 'serve-static-root',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    if (req.url.startsWith('/music/') || req.url.startsWith('/images/') || req.url.endsWith('CHANGES.md')) {
                        const filePath = path.join(__dirname, req.url);
                        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                            res.setHeader('Content-Type', getContentType(filePath));
                            fs.createReadStream(filePath).pipe(res);
                            return;
                        }
                    }
                    next();
                });
            }
        }
    ]
});

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.mid': return 'audio/midi';
        case '.png': return 'image/png';
        case '.jpg': return 'image/jpeg';
        case '.svg': return 'image/svg+xml';
        default: return 'application/octet-stream';
    }
}
