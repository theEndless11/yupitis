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
        const { rows } = await postgres.query('SELECT Id as id, * FROM messages WHERE groupId = $1 ORDER BY timestamp DESC LIMIT 50', [groupId]);
        return res.json(rows);

      case 'POST':
        const { content, image, replyTo } = req.body;
        if (!content && !image) return res.status(400).json({ error: 'Content required' });
        const { rows: newMessage } = await postgres.query(
          'INSERT INTO messages (groupId, senderId, senderName, senderRole, content, image, replyTo, type, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING Id as id, *',
          [groupId, userId, username, role, content, image, replyTo, 'text']
        );
        return res.status(201).json(newMessage[0]);

      case 'PUT':
        // Edit message functionality
        if (!messageId || isNaN(messageId)) {
          return res.status(400).json({ error: 'Invalid messageId for editing' });
        }
        
        const { content: editContent } = req.body;
        if (!editContent || !editContent.trim()) {
          return res.status(400).json({ error: 'Content required for editing' });
        }
        
        // First check if the message exists and user has permission to edit
        const { rows: existingMessage } = await postgres.query(
          'SELECT * FROM messages WHERE Id = $1 AND groupId = $2',
          [messageId, groupId]
        );
        
        if (existingMessage.length === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }
        
        // Check if user is the sender or admin
        const message = existingMessage[0];
        const isOwner = message.senderId === userId || message.senderid === userId;
        const isAdmin = role === 'admin';
        
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ error: 'You can only edit your own messages' });
        }
        
        // Update the message
        const { rows: updatedMessage } = await postgres.query(
          'UPDATE messages SET content = $1, edited = true, editedAt = NOW() WHERE Id = $2 AND groupId = $3 RETURNING Id as id, *',
          [editContent.trim(), messageId, groupId]
        );
        
        return res.json(updatedMessage[0]);

      case 'DELETE':
        console.log('DELETE request received');
        console.log('messageId from query:', req.query.messageId);
        console.log('messageId parsed:', messageId);
        console.log('messageId isNaN:', isNaN(messageId));
        console.log('userId:', userId);
        if (!messageId || isNaN(messageId)) return res.status(400).json({ error: 'Invalid messageId' });
        console.log('About to execute DELETE query with Id:', messageId);
        const { rowCount } = await postgres.query('DELETE FROM messages WHERE Id = $1', [messageId]);
        console.log('Delete query executed, rowCount:', rowCount);
        return rowCount > 0 ? res.json({ message: 'Deleted' }) : res.status(404).json({ error: 'Not found' });

      default:
        return res.status(405).end();
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
}
