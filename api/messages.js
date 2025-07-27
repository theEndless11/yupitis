import { setCorsHeaders } from '../lib/cors';
import postgres from '../utils/postgress';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const groupId = parseInt(req.query.groupId);
  const userId = req.headers['x-user-id'];

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { rows } = await postgres.query('SELECT * FROM messages WHERE groupId = $1 ORDER BY timestamp DESC LIMIT 50', [groupId]);
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const { content, image } = req.body;
    const username = req.headers['x-username']; // Should be passed in header or token
    const role = req.headers['x-role'] || 'member';

    if (!content && !image) return res.status(400).json({ error: 'Message content required' });

    await postgres.query(
      'INSERT INTO messages (groupId, senderId, senderName, senderRole, content, image, type, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
      [groupId, userId, username, role, content, image, 'text']
    );

    return res.status(201).json({ message: 'Message sent' });
  }

  if (req.method === 'DELETE') {
    const messageId = parseInt(req.query.messageId);
    await postgres.query('DELETE FROM messages WHERE id = $1 AND senderId = $2', [messageId, userId]);
    return res.json({ message: 'Message deleted' });
  }

  return res.status(405).end();
}
