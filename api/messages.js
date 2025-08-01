import { setCorsHeaders } from '../lib/cors';
import postgres from '../utils/postgress';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');
  
  const groupId = parseInt(req.query.groupId);
  const messageId = parseInt(req.query.messageId);
  const userId = parseInt(req.headers['x-user-id']);
  const username = req.headers['x-username'] || 'Anonymous';
  const role = req.headers['x-role'] || 'member';
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!groupId || isNaN(groupId)) return res.status(400).json({ error: 'Invalid groupId' });
  if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });

  try {
    switch (req.method) {
      case 'GET':
        const { rows } = await postgres.query('SELECT * FROM messages WHERE groupId = $1 ORDER BY timestamp DESC LIMIT 50', [groupId]);
        return res.json(rows);

      case 'POST':
        const { content, image, replyTo } = req.body;
        if (!content && !image) return res.status(400).json({ error: 'Content required' });
        const { rows: newMessage } = await postgres.query(
          'INSERT INTO messages (groupId, senderId, senderName, senderRole, content, image, replyTo, type, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *',
          [groupId, userId, username, role, content, image, replyTo, 'text']
        );
        return res.status(201).json(newMessage[0]);

      case 'DELETE':
        if (!messageId || isNaN(messageId)) return res.status(400).json({ error: 'Invalid messageId' });
        const deleteQuery = role === 'admin' ? 'DELETE FROM messages WHERE id = $1' : 'DELETE FROM messages WHERE id = $1 AND senderId = $2';
        const deleteParams = role === 'admin' ? [messageId] : [messageId, userId];
        const { rowCount } = await postgres.query(deleteQuery, deleteParams);
        return rowCount > 0 ? res.json({ message: 'Deleted' }) : res.status(404).json({ error: 'Not found' });

      default:
        return res.status(405).end();
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
}
