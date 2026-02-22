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

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,   
  'http://localhost:3000',       // your local dev server (adjust port if needed)
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (e.g. curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));


app.use(express.json());

app.use(cookieParser());


const forACureEmail = process.env.EMAIL_USER
const forACurePassword = process.env.EMAIL_PASS

console.log("Email user:", forACureEmail);
console.log("Email pass:", forACurePassword ? "loaded" : "missing");

const resend = new Resend(process.env.RESEND_API_KEY);


// POST /contact route
app.post("/contact", async (req, res) => {
  const {email: senderEmail, message } = req.body;

  if ( !senderEmail || !message) {
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
  const {email: senderEmail } = req.body;

  if ( !senderEmail) {
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
  const {firstName, lastName, email: senderEmail, phone, message } = req.body;

  if ( !senderEmail || !message) {
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: 'Too many login attempts, try again later',
});


// POST /login route
app.post('/login', loginLimiter,async (req, res) => {
  const { username, password } = req.body;

  const validUsername = username === process.env.ADMIN_USERNAME;
  const validPassword = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH!
  );

  // Compare both before responding to avoid username enumeration
  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,      // JS can't access it
    secure: true,        // only sent over HTTPS
    sameSite: 'strict',  // protects against CSRF
    maxAge: 8 * 60 * 60 * 1000, // 8 hours in ms
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

// News

// GET /news — fetch all articles
app.get('/news', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// POST /news — create an article
app.post('/news', requireAdmin, async (req, res) => {
  const { title, date, desc, category, categoryType, image } = req.body;

  if (!title || !date || !desc || !category || !categoryType || !image) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO news (title, date, desc, category, slug, image)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, date, desc, category, categoryType, image]
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
  const { title, date, desc, category, categoryType, image } = req.body;

  try {
    const result = await pool.query(
      `UPDATE news SET title=$1, date=$2, desc=$3, category=$4, slug=$5, image=$6
       WHERE id=$7 RETURNING *`,
      [title, date, desc, category, categoryType, image, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update news item' });
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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));