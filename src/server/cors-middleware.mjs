/**
 * Shared CORS middleware for all Express servers.
 *
 * Allows requests from localhost/127.0.0.1 origins only.
 * Handles preflight OPTIONS requests with a 204 No Content response.
 *
 * @module src/server/cors-middleware
 */

/**
 * Create an Express middleware that enables CORS for localhost origins.
 *
 * @returns {import('express').RequestHandler}
 */
export function localhostCors() {
    return (req, res, next) => {
        const origin = req.headers.origin;
        const isLocalhost =
            origin &&
            (origin.startsWith('http://localhost:') ||
                origin.startsWith('http://127.0.0.1:') ||
                origin === 'http://localhost' ||
                origin === 'http://127.0.0.1');

        if (isLocalhost) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
            res.header(
                'Access-Control-Allow-Methods',
                'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            );
            res.header(
                'Access-Control-Allow-Headers',
                'Origin, X-Requested-With, Content-Type, Accept, Authorization',
            );
            // Handle preflight OPTIONS requests immediately
            if (req.method === 'OPTIONS') {
                return res.sendStatus(204);
            }
        }
        next();
    };
}
