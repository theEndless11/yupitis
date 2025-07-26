// services/GroupService.js
module.exports = (mysql) => {
  if (!mysql) {
    throw new Error('MySQL connection is required for GroupService');
  }

  return {
    // Get a specific group by ID
    async getGroup(groupId) {
      try {
        const [rows] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
        return rows[0] || null;
      } catch (error) {
        console.error('Error in getGroup:', error);
        throw error;
      }
    },

    // Get all groups
    async getAllGroups() {
      try {
        const [rows] = await mysql.query('SELECT * FROM groups ORDER BY created_at DESC');
        return rows || [];
      } catch (error) {
        console.error('Error in getAllGroups:', error);
        throw error;
      }
    },

    // Get user's membership in a specific group
    async getMembership(userId, groupId) {
      try {
        const [rows] = await mysql.query(
          'SELECT * FROM group_memberships WHERE userId = ? AND groupId = ?',
          [userId, groupId]
        );
        return rows[0] || null;
      } catch (error) {
        console.error('Error in getMembership:', error);
        throw error;
      }
    },

    // Get all active memberships for a user
    async getUserMemberships(userId) {
      try {
        const [rows] = await mysql.query(
          `SELECT gm.*, g.name AS group_name, g.description AS group_description 
           FROM group_memberships gm 
           JOIN groups g ON gm.groupId = g.id 
           WHERE gm.userId = ? AND gm.status = 'active'
           ORDER BY gm.joined_at DESC`,
          [userId]
        );
        return rows || [];
      } catch (error) {
        console.error('Error in getUserMemberships:', error);
        throw error;
      }
    },

    // Get pending join requests for a user
    async getPendingRequests(userId) {
      try {
        const [rows] = await mysql.query(
          `SELECT pr.*, g.name AS group_name 
           FROM pending_requests pr 
           JOIN groups g ON pr.groupId = g.id 
           WHERE pr.userId = ? AND pr.status = 'pending'
           ORDER BY pr.requestedAt DESC`,
          [userId]
        );
        return rows || [];
      } catch (error) {
        console.error('Error in getPendingRequests:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
          console.warn('pending_requests table does not exist, returning empty array');
          return [];
        }
        throw error;
      }
    },

    // Join a group
    async joinGroup(userId, username, groupId) {
      try {
        const [existing] = await mysql.query(
          'SELECT * FROM group_memberships WHERE userId = ? AND groupId = ?',
          [userId, groupId]
        );

        if (existing.length > 0) {
          return existing[0]; // Already a member
        }

        const [groupRows] = await mysql.query(
          'SELECT requires_approval FROM groups WHERE id = ?',
          [groupId]
        );

        const group = groupRows[0];
        const status = group?.requires_approval ? 'pending' : 'active';
        const role = 'member';
        const joinedAt = new Date();

        await mysql.query(
          'INSERT INTO group_memberships (userId, groupId, username, role, status, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, groupId, username, role, status, joinedAt]
        );

        return {
          userId,
          groupId,
          username,
          role,
          status,
          joinedAt
        };
      } catch (error) {
        console.error('Error in joinGroup:', error);
        throw error;
      }
    },

    // Leave a group
    async leaveGroup(userId, groupId) {
      try {
        const [result] = await mysql.query(
          'DELETE FROM group_memberships WHERE userId = ? AND groupId = ?',
          [userId, groupId]
        );
        return result.affectedRows > 0;
      } catch (error) {
        console.error('Error in leaveGroup:', error);
        throw error;
      }
    },

    // Cancel a join request
    async cancelJoinRequest(requestId, userId) {
      try {
        try {
          const [result] = await mysql.query(
            'DELETE FROM join_requests WHERE id = ? AND userId = ?',
            [requestId, userId]
          );
          return result.affectedRows > 0;
        } catch (error) {
          if (error.code === 'ER_NO_SUCH_TABLE') {
            console.warn('join_requests table does not exist, trying to remove pending membership');
            const [result] = await mysql.query(
              'DELETE FROM group_memberships WHERE id = ? AND userId = ? AND status = "pending"',
              [requestId, userId]
            );
            return result.affectedRows > 0;
          }
          throw error;
        }
      } catch (error) {
        console.error('Error in cancelJoinRequest:', error);
        throw error;
      }
    },

    // Get user permissions based on their role
    getPermissions(membership) {
      if (!membership) return [];

      switch (membership.role) {
        case 'admin':
          return ['read', 'write', 'delete', 'manage_members', 'manage_group'];
        case 'moderator':
          return ['read', 'write', 'delete'];
        case 'member':
        default:
          return ['read', 'write'];
      }
    },

    // Create a new group
    async createGroup(name, description, createdBy) {
      try {
        const createdAt = new Date();
        const [result] = await mysql.query(
          'INSERT INTO groups (name, description, created_by, created_at) VALUES (?, ?, ?, ?)',
          [name, description, createdBy, createdAt]
        );

        const groupId = result.insertId;

        await mysql.query(
          'INSERT INTO group_memberships (userId, groupId, username, role, status, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
          [createdBy, groupId, 'Admin', 'admin', 'active', createdAt]
        );

        return {
          id: groupId,
          name,
          description,
          created_by: createdBy,
          created_at: createdAt
        };
      } catch (error) {
        console.error('Error in createGroup:', error);
        throw error;
      }
    },

    // Get all members in a group
    async getGroupMembers(groupId) {
      try {
        const [rows] = await mysql.query(
          'SELECT userId, username, role, status, joined_at FROM group_memberships WHERE groupId = ? ORDER BY joined_at ASC',
          [groupId]
        );
        return rows || [];
      } catch (error) {
        console.error('Error in getGroupMembers:', error);
        throw error;
      }
    }
  };
};

