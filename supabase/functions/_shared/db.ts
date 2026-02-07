import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows
}

// Initialize the conversations table
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]',
      person_info JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Create index for faster phone number lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_conversations_phone
    ON conversations(phone_number)
  `)
}

// Get conversation by phone number
export async function getConversation(phoneNumber: string) {
  const rows = await query(
    'SELECT * FROM conversations WHERE phone_number = $1',
    [phoneNumber]
  )
  return rows[0] || null
}

// Create or update conversation
export async function saveConversation(
  phoneNumber: string,
  messages: any[],
  personInfo: any = {}
): Promise<void> {
  await pool.query(`
    INSERT INTO conversations (phone_number, messages, person_info, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (phone_number)
    DO UPDATE SET
      messages = $2,
      person_info = $3,
      updated_at = NOW()
  `, [phoneNumber, JSON.stringify(messages), JSON.stringify(personInfo)])
}

// Delete conversation
export async function deleteConversation(phoneNumber: string): Promise<void> {
  await pool.query(
    'DELETE FROM conversations WHERE phone_number = $1',
    [phoneNumber]
  )
}

export default pool
