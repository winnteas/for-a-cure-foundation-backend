import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Resend } from "resend";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pool from './db';

dotenv.config();

const app = express();

app.set('trust proxy', 1);
app.use((req, res, next) => {
  console.log('Origin:', req.headers.origin);
  console.log('Method:', req.method);
  next();
});

const allowedOrigins = [
  'https://foracure.org.au',
  'https://www.foracure.org.au',
  'http://localhost:3000',
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));


app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const forACureEmail = process.env.EMAIL_USER;
const forACurePassword = process.env.EMAIL_PASS;

console.log("Email user:", forACureEmail);
console.log("Email pass:", forACurePassword ? "loaded" : "missing");

const resend = new Resend(process.env.RESEND_API_KEY);

// POST /contact route
app.post("/contact", async (req, res) => {
  const { email: senderEmail, message } = req.body;

  if (!senderEmail || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const response = await resend.emails.send({
      from: "For A Cure <onboarding@resend.dev>",
      to: process.env.EMAIL_USER ?? "",
      subject: `New Contact Form Message from ${senderEmail}`,
      text: `
New message from: ${senderEmail}

Message:
${message}
      `,
    });

    res.json({ success: true, id: response.data?.id });
  } catch (error) {
    console.error("Resend error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /subscribe route
app.post("/subscribe", async (req, res) => {
  const { email: senderEmail } = req.body;

  if (!senderEmail) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const response = await resend.emails.send({
      from: "For A Cure <onboarding@resend.dev>",
      to: process.env.EMAIL_USER ?? "",
      subject: `New Subscription from ${senderEmail}`,
      text: `
${senderEmail} would like to subscribe to the newsletter.
      `,
    });

    res.json({ success: true, id: response.data?.id });
  } catch (error) {
    console.error("Resend error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /team-up route
app.post("/team-up", async (req, res) => {
  const { firstName, lastName, email: senderEmail, phone, message } = req.body;

  if (!senderEmail || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const response = await resend.emails.send({
      from: "For A Cure <onboarding@resend.dev>",
      to: process.env.EMAIL_USER ?? "",
      subject: `New Team Up Message from ${senderEmail}`,
      text: `
      First Name: ${firstName}
      Last Name: ${lastName}
      Email: ${senderEmail}
      Phone: ${phone}
      Message: ${message}
      `,
    });

    res.json({ success: true, id: response.data?.id });
  } catch (error) {
    console.error("Resend error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, try again later',
});

// POST /login route
app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  const validUsername = username === process.env.ADMIN_USERNAME;
  const validPassword = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH!
  );

  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' }
  );

  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('token', token, {
    httpOnly: true,
    secure: true,          // backend is https
    sameSite: 'none',      // REQUIRED for cross-site (localhost -> render.com)
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ success: true });
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { role: string };
    if (payload.role !== 'admin') throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/verify', requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

// GET /news — fetch all articles
app.get('/news', async (req, res) => {
  try {
    const author = req.query.author;
    let result;
    if (author) {
      result = await pool.query('SELECT * FROM news WHERE author = $1 ORDER BY created_at DESC', [author]);
    } else {
      result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
    }
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// POST /news — create an article
app.post('/news', requireAdmin, async (req, res) => {
  const { title, date, description, category, slug, image, author } = req.body;

  if (!title || !date || !description || !category || !slug || !image || !author) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO news (title, date, description, category, slug, image, author)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, date, description, category, slug, image, author]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create news item' });
  }
});

// PUT /news/:id — update an article
app.put('/news/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, date, description, category, slug, image, author } = req.body;

  try {
    const result = await pool.query(
      `UPDATE news SET title=$1, date=$2, description=$3, category=$4, slug=$5, image=$6, author=$7
       WHERE id=$8 RETURNING *`,
      [title, date, description, category, slug, image, author, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update news item' });
  }
});


// GET /news/:id — fetch a single article
app.get('/news/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM news WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch news item' });
  }
});

// DELETE /news/:id — delete an article
app.delete('/news/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM news WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete news item' });
  }
});

// GET /news/related — fetch 3 related articles by category
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

    // If no category provided, no results, or less than 3, fill from all articles
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
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch related articles' });
  }
});

// GET /news/categories — fetch all unique categories
app.get('/news/categories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT category FROM news ORDER BY category ASC`
    );
    res.json(result.rows.map((row: { category: string }) => row.category));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));