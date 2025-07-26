// services/GroupService.js

module.exports = (mysql) => {
  return {
    async getGroup(groupId) {
      const [rows] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
      return rows[0];
    },

    async getMembership(userId, groupId) {
      const [rows] = await mysql.query(
        'SELECT * FROM group_memberships WHERE user_id = ? AND group_id = ?',
        [userId, groupId]
      );
      return rows[0];
    },

    async joinGroup(userId, username, groupId) {
      const [existing] = await mysql.query(
        'SELECT * FROM group_memberships WHERE user_id = ? AND group_id = ?',
        [userId, groupId]
      );

      if (existing.length > 0) return existing[0]; // Already a member

      const status = 'active';
      await mysql.query(
        'INSERT INTO group_memberships (user_id, group_id, username, role, status) VALUES (?, ?, ?, ?, ?)',
        [userId, groupId, username, 'member', status]
      );

      return { userId, groupId, username, role: 'member', status };
    },

    async leaveGroup(userId, groupId) {
      await mysql.query(
        'DELETE FROM group_memberships WHERE user_id = ? AND group_id = ?',
        [userId, groupId]
      );
    },

    getPermissions(membership) {
      const role = membership?.role;
      switch (role) {
        case 'admin':
          return ['read', 'write', 'delete'];
        case 'moderator':
          return ['read', 'write'];
        case 'member':
        default:
          return ['read'];
      }
    }
  };
};
