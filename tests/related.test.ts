import request from 'supertest';
import express from 'express';
import pool from '../db';

// Mock the database pool
jest.mock('../db', () => ({
    query: jest.fn(),
}));

const mockedPool = pool as jest.Mocked<typeof pool>;

// Recreate just the related endpoint for testing
const app = express();
app.use(express.json());

app.get('/news/related', async (req, res) => {
    const { category, excludeId } = req.query;
    const fallbackId = excludeId || '00000000-0000-0000-0000-000000000000';

    try {
        let result;

        if (category) {
            result = await pool.query(
                `SELECT * FROM news 
         WHERE category = $1 AND id != $2 
         ORDER BY date DESC 
         LIMIT 3`,
                [category, fallbackId]
            );
        }

        if (!result || result.rows.length === 0) {
            result = await pool.query(
                `SELECT * FROM news 
         WHERE id != $1
         ORDER BY date DESC 
         LIMIT 3`,
                [fallbackId]
            );
        } else if (result.rows.length < 3) {
            const remaining = 3 - result.rows.length;
            const existingIds = result.rows.map((r: { id: string }) => r.id);
            const excludeIds = [excludeId, ...existingIds].filter(Boolean);

            const filler = await pool.query(
                `SELECT * FROM news 
         WHERE id != ALL($1::uuid[])
         ORDER BY date DESC 
         LIMIT $2`,
                [excludeIds, remaining]
            );
            result.rows = [...result.rows, ...filler.rows];
        }

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch related articles' });
    }
});

// Sample articles for mocking
const sampleArticles = [
    { id: '1', title: 'Article 1', category: 'events', date: '2025-01-01' },
    { id: '2', title: 'Article 2', category: 'events', date: '2025-01-02' },
    { id: '3', title: 'Article 3', category: 'events', date: '2025-01-03' },
    { id: '4', title: 'Article 4', category: 'Stem Cell', date: '2025-01-04' },
    { id: '5', title: 'Article 5', category: 'Stem Cell', date: '2025-01-05' },
];

beforeEach(() => {
    jest.clearAllMocks();
});

describe('GET /news/related', () => {

    it('returns up to 3 articles in the same category', async () => {
        const categoryArticles = sampleArticles.filter(a => a.category === 'events');
        mockedPool.query = jest.fn().mockResolvedValueOnce({ rows: categoryArticles });

        const res = await request(app)
            .get('/news/related?category=events&excludeId=99');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(3);
        expect(res.body.every((a: { category: string }) => a.category === 'events')).toBe(true);
    });

    it('falls back to all articles when no category is provided', async () => {
        mockedPool.query = jest.fn().mockResolvedValueOnce({ rows: sampleArticles.slice(0, 3) });

        const res = await request(app)
            .get('/news/related');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(3);
        expect(mockedPool.query).toHaveBeenCalledTimes(1);
    });

    it('falls back to all articles when category returns no results', async () => {
        mockedPool.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] })          // category query returns nothing
            .mockResolvedValueOnce({ rows: sampleArticles.slice(0, 3) }); // fallback query

        const res = await request(app)
            .get('/news/related?category=nonexistent&excludeId=99');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(3);
        expect(mockedPool.query).toHaveBeenCalledTimes(2);
    });

    it('fills remaining spots from all articles when category has less than 3', async () => {
        const oneArticle = [sampleArticles[0]];
        const fillerArticles = [sampleArticles[3], sampleArticles[4]];

        mockedPool.query = jest.fn()
            .mockResolvedValueOnce({ rows: oneArticle })    // category query returns 1
            .mockResolvedValueOnce({ rows: fillerArticles }); // filler query returns 2

        const res = await request(app)
            .get('/news/related?category=events&excludeId=99');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(3);
        expect(mockedPool.query).toHaveBeenCalledTimes(2);
    });

    it('excludes the current article from results', async () => {
        const excludeId = '1';
        const articles = sampleArticles.filter(a => a.id !== excludeId).slice(0, 3);
        mockedPool.query = jest.fn().mockResolvedValueOnce({ rows: articles });

        const res = await request(app)
            .get(`/news/related?category=events&excludeId=${excludeId}`);

        expect(res.status).toBe(200);
        expect(res.body.every((a: { id: string }) => a.id !== excludeId)).toBe(true);
    });

    it('returns 500 when database throws an error', async () => {
        mockedPool.query = jest.fn().mockRejectedValueOnce(new Error('DB error'));

        const res = await request(app)
            .get('/news/related?category=events');

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'Failed to fetch related articles' });
    });

    it('returns empty array when no articles exist', async () => {
        mockedPool.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] })  // category query
            .mockResolvedValueOnce({ rows: [] }); // fallback query

        const res = await request(app)
            .get('/news/related?category=events');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(0);
    });

});