import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const setup = async () => {
  console.log('Connecting to:', process.env.DATABASE_URL);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      category_type TEXT NOT NULL,
      slug TEXT NOT NULL,
      image TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Tables created');
  process.exit(0);
};

setup().catch(console.error);