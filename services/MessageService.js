const MessageService = (postgres) => {
  if (!postgres) {
    throw new Error('PostgreSQL connection is required');
  }

  return {
    // Get messages for a group with pagination
    async getMessages(groupId, options = {}) {
      try {
        const { limit = 50, offset = 0, includeDeleted = false } = options;
        
        let query = `
          SELECT 
            id,
            group_id,
            user_id,
            username,
            content,
            image_url,
            message_type,
            created_at as timestamp,
            deleted_at
          FROM messages 
          WHERE group_id = $1
        `;
        
        const params = [groupId];
        
        if (!includeDeleted) {
          query += ` AND deleted_at IS NULL`;
        }
        
        query += ` ORDER BY created_at ASC LIMIT $2 OFFSET $3`;
        params.push(limit, offset);
        
        const result = await postgres.query(query, params);
        
        return result.rows.map(row => ({
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        }));
      } catch (error) {
        console.error('Error getting messages:', error);
        throw new Error('Failed to retrieve messages: ' + error.message);
      }
    },

    // Get a specific message by ID
    async getMessage(messageId) {
      try {
        const result = await postgres.query(
          `SELECT 
            id,
            group_id,
            user_id,
            username,
            content,
            image_url,
            message_type,
            created_at as timestamp,
            deleted_at
          FROM messages 
          WHERE id = $1 AND deleted_at IS NULL`,
          [messageId]
        );
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        };
      } catch (error) {
        console.error('Error getting message:', error);
        throw new Error('Failed to retrieve message: ' + error.message);
      }
    },

    // Create a new message
    async createMessage(messageData) {
      try {
        const {
          groupId,
          userId,
          username,
          content = '',
          imageUrl = null,
          type = 'user'
        } = messageData;

        if (!groupId || !userId || !username) {
          throw new Error('Missing required fields: groupId, userId, or username');
        }

        if (!content.trim() && !imageUrl) {
          throw new Error('Message must have content or an image');
        }

        const result = await postgres.query(
          `INSERT INTO messages (
            group_id, user_id, username, content, image_url, message_type
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING 
            id,
            group_id,
            user_id,
            username,
            content,
            image_url,
            message_type,
            created_at as timestamp,
            deleted_at`,
          [groupId, userId, username, content.trim(), imageUrl, type]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        };
      } catch (error) {
        console.error('Error creating message:', error);
        throw new Error('Failed to create message: ' + error.message);
      }
    },

    // Create a system message
    async createSystemMessage({ groupId, content, type = 'system' }) {
      try {
        if (!groupId || !content) {
          throw new Error('Missing required fields: groupId or content');
        }

        const result = await postgres.query(
          `INSERT INTO messages (
            group_id, user_id, username, content, message_type
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING 
            id,
            group_id,
            user_id,
            username,
            content,
            message_type,
            created_at as timestamp,
            deleted_at`,
          [groupId, 'system', 'System', content, type]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        };
      } catch (error) {
        console.error('Error creating system message:', error);
        throw new Error('Failed to create system message: ' + error.message);
      }
    },

    // Soft delete a message
    async deleteMessage(messageId) {
      try {
        const result = await postgres.query(
          `UPDATE messages 
          SET deleted_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id`,
          [messageId]
        );

        if (result.rows.length === 0) {
          throw new Error('Message not found or already deleted');
        }

        return { success: true, messageId: result.rows[0].id };
      } catch (error) {
        console.error('Error deleting message:', error);
        throw new Error('Failed to delete message: ' + error.message);
      }
    },

    // Hard delete a message (permanent)
    async permanentDeleteMessage(messageId) {
      try {
        const result = await postgres.query(
          `DELETE FROM messages WHERE id = $1 RETURNING id`,
          [messageId]
        );

        if (result.rows.length === 0) {
          throw new Error('Message not found');
        }

        return { success: true, messageId: result.rows[0].id };
      } catch (error) {
        console.error('Error permanently deleting message:', error);
        throw new Error('Failed to permanently delete message: ' + error.message);
      }
    },

    // Handle user leaving group - anonymize their messages
    async handleUserLeft(userId, groupId) {
      try {
        await postgres.query(
          `UPDATE messages 
          SET username = 'Former Member'
          WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL`,
          [userId, groupId]
        );

        console.log(`Anonymized messages for user ${userId} in group ${groupId}`);
        return { success: true };
      } catch (error) {
        console.error('Error handling user left:', error);
        throw new Error('Failed to handle user leaving: ' + error.message);
      }
    },

    // Get message count for a group
    async getMessageCount(groupId, includeDeleted = false) {
      try {
        let query = `SELECT COUNT(*) as count FROM messages WHERE group_id = $1`;
        if (!includeDeleted) {
          query += ` AND deleted_at IS NULL`;
        }

        const result = await postgres.query(query, [groupId]);
        return parseInt(result.rows[0].count);
      } catch (error) {
        console.error('Error getting message count:', error);
        throw new Error('Failed to get message count: ' + error.message);
      }
    },

    // Get messages by user in a group
    async getUserMessages(userId, groupId, options = {}) {
      try {
        const { limit = 50, offset = 0 } = options;
        
        const result = await postgres.query(
          `SELECT 
            id,
            group_id,
            user_id,
            username,
            content,
            image_url,
            message_type,
            created_at as timestamp,
            deleted_at
          FROM messages 
          WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL
          ORDER BY created_at DESC 
          LIMIT $3 OFFSET $4`,
          [userId, groupId, limit, offset]
        );

        return result.rows.map(row => ({
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        }));
      } catch (error) {
        console.error('Error getting user messages:', error);
        throw new Error('Failed to get user messages: ' + error.message);
      }
    },

    // Search messages in a group
    async searchMessages(groupId, searchTerm, options = {}) {
      try {
        const { limit = 50, offset = 0 } = options;
        
        const result = await postgres.query(
          `SELECT 
            id,
            group_id,
            user_id,
            username,
            content,
            image_url,
            message_type,
            created_at as timestamp,
            deleted_at
          FROM messages 
          WHERE group_id = $1 
          AND deleted_at IS NULL
          AND (content ILIKE $2 OR username ILIKE $2)
          ORDER BY created_at DESC 
          LIMIT $3 OFFSET $4`,
          [groupId, `%${searchTerm}%`, limit, offset]
        );

        return result.rows.map(row => ({
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp,
          deletedAt: row.deleted_at
        }));
      } catch (error) {
        console.error('Error searching messages:', error);
        throw new Error('Failed to search messages: ' + error.message);
      }
    },

    // Get recent messages across all groups for a user
    async getRecentMessages(userId, options = {}) {
      try {
        const { limit = 20 } = options;
        
        const result = await postgres.query(
          `SELECT DISTINCT ON (m.group_id)
            m.id,
            m.group_id,
            m.user_id,
            m.username,
            m.content,
            m.image_url,
            m.message_type,
            m.created_at as timestamp
          FROM messages m
          WHERE m.group_id IN (
            SELECT DISTINCT group_id 
            FROM messages 
            WHERE user_id = $1 AND deleted_at IS NULL
          )
          AND m.deleted_at IS NULL
          ORDER BY m.group_id, m.created_at DESC
          LIMIT $2`,
          [userId, limit]
        );

        return result.rows.map(row => ({
          id: row.id,
          groupId: row.group_id,
          userId: row.user_id,
          username: row.username,
          content: row.content || '',
          imageUrl: row.image_url,
          type: row.message_type,
          timestamp: row.timestamp
        }));
      } catch (error) {
        console.error('Error getting recent messages:', error);
        throw new Error('Failed to get recent messages: ' + error.message);
      }
    },

    // Clean up old deleted messages (maintenance function)
    async cleanupDeletedMessages(daysOld = 30) {
      try {
        const result = await postgres.query(
          `DELETE FROM messages 
          WHERE deleted_at IS NOT NULL 
          AND deleted_at < NOW() - INTERVAL '${daysOld} days'
          RETURNING COUNT(*) as count`
        );

        const deletedCount = result.rows[0]?.count || 0;
        console.log(`Cleaned up ${deletedCount} old deleted messages`);
        return { success: true, deletedCount };
      } catch (error) {
        console.error('Error cleaning up deleted messages:', error);
        throw new Error('Failed to cleanup deleted messages: ' + error.message);
      }
    }
  };
};

module.exports = MessageService;
