import { setCorsHeaders } from '../lib/cors';
import postgres from '../utils/postgress';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const groupId = parseInt(req.query.groupId);
  const messageId = parseInt(req.query.messageId);
  const userId = parseInt(req.headers['x-user-id']);
  const username = req.headers['x-username'] || 'Anonymous';
  const role = req.headers['x-role'] || 'member';
  
  if (!groupId || isNaN(groupId)) return res.status(400).json({ error: 'Invalid groupId' });
  if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });
  
  try {
    switch (req.method) {
      case 'GET':
        // Get messages with reply details in a single query
        const { rows } = await postgres.query(`
          SELECT 
            m.Id as id,
            m.groupId,
            m.senderId,
            m.senderName,
            m.senderRole,
            m.content,
            m.image,
            m.type,
            m.timestamp,
            m.edited,
            m.editedAt,
            m.replyTo,
            CASE 
              WHEN m.replyTo IS NOT NULL THEN
                json_build_object(
                  'id', rm.Id,
                  'senderId', rm.senderId,
                  'senderName', rm.senderName,
                  'content', rm.content,
                  'timestamp', rm.timestamp
                )
              ELSE NULL
            END as replyToMessage
          FROM messages m
          LEFT JOIN messages rm ON m.replyTo = rm.Id
          WHERE m.groupId = $1 
          ORDER BY m.timestamp ASC 
          LIMIT 100
        `, [groupId]);
        
        return res.json(rows);

      case 'POST':
        const { content, image, replyTo } = req.body;
        
        if (!content?.trim() && !image) {
          return res.status(400).json({ error: 'Content or image required' });
        }
        
        // Validate replyTo message exists if provided
        let replyToData = null;
        if (replyTo) {
          const { rows: replyMessage } = await postgres.query(
            'SELECT Id, senderId, senderName, content FROM messages WHERE Id = $1 AND groupId = $2',
            [replyTo, groupId]
          );
          
          if (replyMessage.length === 0) {
            return res.status(400).json({ error: 'Reply message not found' });
          }
          replyToData = replyMessage[0];
        }
        
        // Insert new message
        const { rows: newMessage } = await postgres.query(`
          INSERT INTO messages (
            groupId, senderId, senderName, senderRole, 
            content, image, replyTo, type, timestamp
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) 
          RETURNING 
            Id as id, groupId, senderId, senderName, senderRole,
            content, image, type, timestamp, replyTo
        `, [groupId, userId, username, role, content?.trim() || null, image, replyTo, 'text']);
        
        // Add reply details to response if applicable
        const messageResponse = {
          ...newMessage[0],
          replyToMessage: replyToData ? {
            id: replyToData.id,
            senderId: replyToData.senderid,
            senderName: replyToData.sendername,
            content: replyToData.content
          } : null
        };
        
        return res.status(201).json(messageResponse);

      case 'PUT':
        if (!messageId || isNaN(messageId)) {
          return res.status(400).json({ error: 'Invalid messageId' });
        }
        
        const { content: editContent } = req.body;
        if (!editContent?.trim()) {
          return res.status(400).json({ error: 'Content required' });
        }
        
        // Check message exists and user permissions
        const { rows: existingMessage } = await postgres.query(
          'SELECT senderId, senderName FROM messages WHERE Id = $1 AND groupId = $2',
          [messageId, groupId]
        );
        
        if (existingMessage.length === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }
        
        const isOwner = existingMessage[0].senderid === userId;
        const isAdmin = role === 'admin';
        
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ error: 'Permission denied' });
        }
        
        // Update message
        const { rows: updatedMessage } = await postgres.query(`
          UPDATE messages 
          SET content = $1, edited = true, editedAt = NOW() 
          WHERE Id = $2 AND groupId = $3 
          RETURNING Id as id, content, edited, editedAt
        `, [editContent.trim(), messageId, groupId]);
        
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
