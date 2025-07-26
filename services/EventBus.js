// services/MessageService.js

module.exports = (postgres) => {
  return {
    async createMessage({ groupId, userId, username, content, imageUrl }) {
      const result = await postgres.query(
        `INSERT INTO messages (group_id, user_id, username, content, image_url, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [groupId, userId, username, content, imageUrl]
      );
      return result.rows[0];
    },

    async createSystemMessage({ groupId, content, type = 'system' }) {
      const result = await postgres.query(
        `INSERT INTO messages (group_id, user_id, username, content, type, created_at)
         VALUES ($1, NULL, 'System', $2, $3, NOW()) RETURNING *`,
        [groupId, content, type]
      );
      return result.rows[0];
    },

    async getMessages(groupId, { limit = 50, before } = {}) {
      let query = `SELECT * FROM messages WHERE group_id = $1`;
      const params = [groupId];

      if (before) {
        query += ` AND created_at < $2`;
        params.push(before);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await postgres.query(query, params);
      return result.rows;
    },

    async getMessage(messageId) {
      const result = await postgres.query(
        'SELECT * FROM messages WHERE id = $1',
        [messageId]
      );
      return result.rows[0];
    },

    async deleteMessage(messageId) {
      await postgres.query('DELETE FROM messages WHERE id = $1', [messageId]);
    },

    async handleUserLeft(userId, groupId) {
      // optional: update messages or remove user’s presence if needed
    }
  };
};
